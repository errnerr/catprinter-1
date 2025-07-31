package main

import (
    "context"
    "fmt"
    "image"
    "image/png"
    "log"
    "net/http"
    "os"
    "strings"
    "time"

    "github.com/go-ble/ble"
    "github.com/go-ble/ble/linux"
)

const (
    PRINTER_WIDTH       = 384
    PRINTER_WIDTH_BYTES = PRINTER_WIDTH / 8
    MIN_DATA_BYTES      = 90 * PRINTER_WIDTH_BYTES
)

type PrinterDaemon struct {
    device     ble.Device
    client     ble.Client
    controlChar *ble.Characteristic
    dataChar   *ble.Characteristic
    macAddr    string
    connected  bool
}

func NewPrinterDaemon(macAddr string) *PrinterDaemon {
    return &PrinterDaemon{
        macAddr:   macAddr,
        connected: false,
    }
}

func (pd *PrinterDaemon) Connect() error {
    // Create device once
    if pd.device == nil {
        d, err := linux.NewDevice()
        if err != nil {
            return fmt.Errorf("failed to create device: %v", err)
        }
        pd.device = d
        ble.SetDefaultDevice(d)
    }

    // Connect to printer
    ctx := ble.WithSigHandler(context.WithTimeout(context.Background(), 30*time.Second))
    client, err := ble.Dial(ctx, ble.NewAddr(pd.macAddr))
    if err != nil {
        return fmt.Errorf("failed to connect: %v", err)
    }

    // Discover characteristics
    prof, err := client.DiscoverProfile(true)
    if err != nil {
        client.CancelConnection()
        return fmt.Errorf("failed to discover profile: %v", err)
    }

    var controlChar, dataChar *ble.Characteristic
    for _, s := range prof.Services {
        for _, c := range s.Characteristics {
            if strings.HasSuffix(strings.ToLower(c.UUID.String()), "ae01") {
                controlChar = c
            }
            if strings.HasSuffix(strings.ToLower(c.UUID.String()), "ae03") {
                dataChar = c
            }
        }
    }

    if controlChar == nil || dataChar == nil {
        client.CancelConnection()
        return fmt.Errorf("could not find required characteristics")
    }

    pd.client = client
    pd.controlChar = controlChar
    pd.dataChar = dataChar
    pd.connected = true

    log.Printf("Connected to printer %s", pd.macAddr)
    return nil
}

func (pd *PrinterDaemon) ensureConnected() error {
    if pd.connected {
        // Test the connection with a simple write
        testCmd := createCommand(0xA1, []byte{0x00}) // Status request
        err := pd.client.WriteCharacteristic(pd.controlChar, testCmd, true)
        if err == nil {
            return nil // Connection is healthy
        }
        
        // Connection is broken, reset state
        log.Printf("Connection test failed, reconnecting...")
        pd.Disconnect()
    }
    
    // Try to connect with retries
    maxRetries := 3
    for i := 0; i < maxRetries; i++ {
        if err := pd.Connect(); err != nil {
            log.Printf("Connection attempt %d failed: %v", i+1, err)
            if i < maxRetries-1 {
                time.Sleep(2 * time.Second)
            }
        } else {
            return nil
        }
    }
    
    return fmt.Errorf("failed to connect after %d attempts", maxRetries)
}

func (pd *PrinterDaemon) writeWithRetry(char *ble.Characteristic, data []byte) error {
    maxRetries := 3
    for i := 0; i < maxRetries; i++ {
        err := pd.client.WriteCharacteristic(char, data, true)
        if err == nil {
            return nil
        }
        
        log.Printf("Write attempt %d failed: %v", i+1, err)
        
        if i < maxRetries-1 {
            // Try to reconnect before next attempt
            if reconnectErr := pd.ensureConnected(); reconnectErr != nil {
                return fmt.Errorf("failed to reconnect: %v", reconnectErr)
            }
            time.Sleep(1 * time.Second)
        }
    }
    
    return fmt.Errorf("failed to write after %d attempts", maxRetries)
}

func (pd *PrinterDaemon) Disconnect() {
    if pd.client != nil {
        pd.client.CancelConnection()
        pd.client = nil
    }
    pd.connected = false
    log.Printf("Disconnected from printer")
}

func (pd *PrinterDaemon) Stop() {
    pd.Disconnect()
    if pd.device != nil {
        pd.device.Stop()
        pd.device = nil
    }
}

func (pd *PrinterDaemon) PrintImage(imagePath string) error {
    // Always try to ensure we're connected
    if err := pd.ensureConnected(); err != nil {
        return fmt.Errorf("failed to connect: %v", err)
    }

    // Load and process image
    img, err := loadAndBinarizeImage(imagePath)
    if err != nil {
        return fmt.Errorf("failed to load image: %v", err)
    }
    buffer := encodeImageToBuffer(img)

    // Set intensity with retry
    err = pd.writeWithRetry(pd.controlChar, createCommand(0xA2, []byte{0xA0}))
    if err != nil {
        return fmt.Errorf("failed to write set intensity: %v", err)
    }
    time.Sleep(1 * time.Second)

    // Print request
    numRows := img.Bounds().Dy()
    err = pd.writeWithRetry(pd.controlChar, createCommand(0xA9, []byte{
        byte(numRows & 0xFF),
        byte((numRows >> 8) & 0xFF),
        0x30, 0x00,
    }))
    if err != nil {
        return fmt.Errorf("failed to write print request: %v", err)
    }
    time.Sleep(1 * time.Second)

    // Send image data
    for i := 0; i < len(buffer); i += PRINTER_WIDTH_BYTES {
        row := buffer[i : i+PRINTER_WIDTH_BYTES]
        for j := 0; j < PRINTER_WIDTH_BYTES; j += 20 {
            end := j + 20
            if end > PRINTER_WIDTH_BYTES {
                end = PRINTER_WIDTH_BYTES
            }
            chunk := row[j:end]
            err = pd.writeWithRetry(pd.dataChar, chunk)
            if err != nil {
                return fmt.Errorf("failed to write image data sub-chunk: %v", err)
            }
            time.Sleep(5 * time.Millisecond)
        }
    }

    // Flush after image data
    err = pd.writeWithRetry(pd.controlChar, createCommand(0xAD, []byte{0x00}))
    if err != nil {
        return fmt.Errorf("failed to write flush: %v", err)
    }

    log.Printf("Print job completed successfully")
    return nil
}

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: catprinter_daemon <printer-mac>")
        os.Exit(1)
    }

    macAddr := os.Args[1]
    daemon := NewPrinterDaemon(macAddr)
    defer daemon.Stop()

    // Start periodic connection health check
    go func() {
        ticker := time.NewTicker(30 * time.Second)
        defer ticker.Stop()
        
        for range ticker.C {
            if daemon.connected {
                // Test connection health
                testCmd := createCommand(0xA1, []byte{0x00})
                err := daemon.client.WriteCharacteristic(daemon.controlChar, testCmd, true)
                if err != nil {
                    log.Printf("Health check failed, connection may be broken: %v", err)
                    daemon.Disconnect()
                } else {
                    log.Printf("Connection health check passed")
                }
            }
        }
    }()

    // HTTP server for receiving print requests
    http.HandleFunc("/print", func(w http.ResponseWriter, r *http.Request) {
        if r.Method != "POST" {
            http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
            return
        }

        // Expect image path in request body
        imagePath := r.URL.Query().Get("image")
        if imagePath == "" {
            http.Error(w, "Missing image parameter", http.StatusBadRequest)
            return
        }

        if err := daemon.PrintImage(imagePath); err != nil {
            log.Printf("Print failed: %v", err)
            http.Error(w, fmt.Sprintf("Print failed: %v", err), http.StatusInternalServerError)
            return
        }

        w.WriteHeader(http.StatusOK)
        w.Write([]byte("Printed successfully"))
    })

    log.Printf("Starting printer daemon on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}

// Helper functions (same as before)
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
                    if r < 0x8000 && g < 0x8000 && bCol < 0x8000 {
                        b |= 1 << bit
                    }
                }
            }
            buffer = append(buffer, b)
        }
    }
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