package main

import (
    "context"
    "fmt"
    "image"
    "image/png"
    "log"
    "os"
    "time"
    "strings"

    "github.com/go-ble/ble"
    "github.com/go-ble/ble/linux"
)

const (
    PRINTER_WIDTH       = 384
    PRINTER_WIDTH_BYTES = PRINTER_WIDTH / 8
    MIN_DATA_BYTES      = 90 * PRINTER_WIDTH_BYTES
    CONTROL_WRITE_UUID  = "0000ae01-0000-1000-8000-00805f9b34fb"
    DATA_WRITE_UUID     = "0000ae03-0000-1000-8000-00805f9b34fb"
)

func main() {
    if len(os.Args) < 3 {
        fmt.Println("Usage: catprinter <image.png> <printer-mac>")
        os.Exit(1)
    }
    imgPath := os.Args[1]
    macAddr := os.Args[2]

    img, err := loadAndBinarizeImage(imgPath)
    if err != nil {
        log.Fatalf("Failed to load image: %v", err)
    }
    buffer := encodeImageToBuffer(img)

    d, err := linux.NewDevice()
    if err != nil {
        log.Fatalf("Can't create device : %s", err)
    }
    ble.SetDefaultDevice(d)

    ctx := ble.WithSigHandler(context.WithTimeout(context.Background(), 60*time.Second))
    client, err := ble.Dial(ctx, ble.NewAddr(macAddr))
    if err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }
    defer client.CancelConnection()

    // Find characteristics
    prof, err := client.DiscoverProfile(true)
    if err != nil {
        log.Fatalf("Failed to discover profile: %v", err)
    }
    var controlChar, dataChar *ble.Characteristic
    for _, s := range prof.Services {
        for _, c := range s.Characteristics {
            fmt.Printf("Service: %s\n  Characteristic: %s - Properties: %d\n", s.UUID.String(), c.UUID.String(), c.Property)
            if strings.HasSuffix(strings.ToLower(c.UUID.String()), "ae01") {
                controlChar = c
            }
            if strings.HasSuffix(strings.ToLower(c.UUID.String()), "ae03") {
                dataChar = c
            }
        }
    }
    if controlChar == nil || dataChar == nil {
        log.Fatalf("Could not find required characteristics")
    }

    // Set intensity
    fmt.Println("Writing set intensity...")
    err = client.WriteCharacteristic(controlChar, createCommand(0xA2, []byte{0xA0}), true)
    if err != nil {
        log.Fatalf("Failed to write set intensity: %v", err)
    }
    fmt.Println("Set intensity written.")
    time.Sleep(1 * time.Second)

    // Print request
    fmt.Println("Writing print request...")
    numRows := img.Bounds().Dy()
    err = client.WriteCharacteristic(controlChar, createCommand(0xA9, []byte{
        byte(numRows & 0xFF),
        byte((numRows >> 8) & 0xFF),
        0x30, 0x00,
    }), true)
    if err != nil {
        log.Fatalf("Failed to write print request: %v", err)
    }
    fmt.Println("Print request written.")
    time.Sleep(1 * time.Second)

    // Send image data
    fmt.Println("Sending image data...")
    for i := 0; i < len(buffer); i += PRINTER_WIDTH_BYTES {
        row := buffer[i : i+PRINTER_WIDTH_BYTES]
        for j := 0; j < PRINTER_WIDTH_BYTES; j += 20 {
            end := j + 20
            if end > PRINTER_WIDTH_BYTES {
                end = PRINTER_WIDTH_BYTES
            }
            chunk := row[j:end]
            fmt.Printf("Writing sub-chunk (len=%d)\n", len(chunk))
            err = client.WriteCharacteristic(dataChar, chunk, true)
            if err != nil {
                log.Fatalf("Failed to write image data sub-chunk: %v", err)
            }
            time.Sleep(5 * time.Millisecond)
        }
    }
    fmt.Println("Image data sent.")

    // Flush after image data
    fmt.Println("Writing flush command...")
    err = client.WriteCharacteristic(controlChar, createCommand(0xAD, []byte{0x00}), true)
    if err != nil {
        log.Fatalf("Failed to write flush: %v", err)
    }
    fmt.Println("Flush written after image data.")
    fmt.Println("Print job sent!")
}

func loadAndBinarizeImage(path string) (image.Image, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()
    img, err := png.Decode(f)
    if err != nil {
        return nil, err
    }
    // Assume image is already 1-bit, 384px wide. If not, preprocess in Node.js.
    return img, nil
}

func encodeImageToBuffer(img image.Image) []byte {
    bounds := img.Bounds()
    width := bounds.Dx()
    height := bounds.Dy()
    buffer := make([]byte, 0, height*PRINTER_WIDTH_BYTES)
    for y := 0; y < height; y++ {
        for xByte := 0; xByte < PRINTER_WIDTH_BYTES; xByte++ {
            var b byte
            for bit := 0; bit < 8; bit++ {
                x := xByte*8 + bit
                if x < width {
                    r, g, bCol, _ := img.At(x, y).RGBA()
                    // If pixel is black, set bit (LSB-first)
                    if r < 0x8000 && g < 0x8000 && bCol < 0x8000 {
                        b |= 1 << bit
                    }
                }
            }
            buffer = append(buffer, b)
        }
    }
    // Pad to minimum size
    for len(buffer) < MIN_DATA_BYTES {
        buffer = append(buffer, 0)
    }
    return buffer
}

func createCommand(cmdId byte, payload []byte) []byte {
    header := []byte{0x22, 0x21, cmdId, 0x00, byte(len(payload)), byte(len(payload) >> 8)}
    crc := calculateCRC8(payload)
    return append(append(header, payload...), crc, 0xFF)
}

func calculateCRC8(data []byte) byte {
    table := [256]byte{
        0x00,0x07,0x0E,0x09,0x1C,0x1B,0x12,0x15,0x38,0x3F,0x36,0x31,0x24,0x23,0x2A,0x2D,
        0x70,0x77,0x7E,0x79,0x6C,0x6B,0x62,0x65,0x48,0x4F,0x46,0x41,0x54,0x53,0x5A,0x5D,
        0xE0,0xE7,0xEE,0xE9,0xFC,0xFB,0xF2,0xF5,0xD8,0xDF,0xD6,0xD1,0xC4,0xC3,0xCA,0xCD,
        0x90,0x97,0x9E,0x99,0x8C,0x8B,0x82,0x85,0xA8,0xAF,0xA6,0xA1,0xB4,0xB3,0xBA,0xBD,
        0xC7,0xC0,0xC9,0xCE,0xDB,0xDC,0xD5,0xD2,0xFF,0xF8,0xF1,0xF6,0xE3,0xE4,0xED,0xEA,
        0xB7,0xB0,0xB9,0xBE,0xAB,0xAC,0xA5,0xA2,0x8F,0x88,0x81,0x86,0x93,0x94,0x9D,0x9A,
        0x27,0x20,0x29,0x2E,0x3B,0x3C,0x35,0x32,0x1F,0x18,0x11,0x16,0x03,0x04,0x0D,0x0A,
        0x57,0x50,0x59,0x5E,0x4B,0x4C,0x45,0x42,0x6F,0x68,0x61,0x66,0x73,0x74,0x7D,0x7A,
        0x89,0x8E,0x87,0x80,0x95,0x92,0x9B,0x9C,0xB1,0xB6,0xBF,0xB8,0xAD,0xAA,0xA3,0xA4,
        0xF9,0xFE,0xF7,0xF0,0xE5,0xE2,0xEB,0xEC,0xC1,0xC6,0xCF,0xC8,0xDD,0xDA,0xD3,0xD4,
        0x69,0x6E,0x67,0x60,0x75,0x72,0x7B,0x7C,0x51,0x56,0x5F,0x58,0x4D,0x4A,0x43,0x44,
        0x19,0x1E,0x17,0x10,0x05,0x02,0x0B,0x0C,0x21,0x26,0x2F,0x28,0x3D,0x3A,0x33,0x34,
        0x4E,0x49,0x40,0x47,0x52,0x55,0x5C,0x5B,0x76,0x71,0x78,0x7F,0x6A,0x6D,0x64,0x63,
        0x3E,0x39,0x30,0x37,0x22,0x25,0x2C,0x2B,0x06,0x01,0x08,0x0F,0x1A,0x1D,0x14,0x13,
        0xAE,0xA9,0xA0,0xA7,0xB2,0xB5,0xBC,0xBB,0x96,0x91,0x98,0x9F,0x8A,0x8D,0x84,0x83,
        0xDE,0xD9,0xD0,0xD7,0xC2,0xC5,0xCC,0xCB,0xE6,0xE1,0xE8,0xEF,0xFA,0xFD,0xF4,0xF3,
    }
    crc := byte(0)
    for _, b := range data {
        crc = table[(crc^b)&0xFF]
    }
    return crc
}