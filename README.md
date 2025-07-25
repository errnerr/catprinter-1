# Cat Printer CLI (Node.js + Go)

This project lets you print text messages to an MXW01 Cat Printer using a Node.js CLI and a Go BLE print worker.

## Requirements

- Node.js (v16+ recommended)
- Go (v1.18+ recommended)
- [canvas](https://www.npmjs.com/package/canvas) Node.js package
- [github.com/go-ble/ble](https://github.com/go-ble/ble) Go package
- DotMatrix and DotMatrixBold TTF fonts in `fonts/` directory
- MXW01 Cat Printer (or compatible)
- Linux or macOS (tested on Ubuntu)

## Setup

### 1. Clone the repository
```sh
git clone <this-repo-url>
cd <repo-directory>
```

### 2. Install Node.js dependencies
```sh
npm install canvas
```

### 3. Install Go and build the print worker
- [Install Go](https://go.dev/doc/install) (or see below):
  ```sh
  sudo apt install golang-go  # or use the official Go tarball for latest version
  ```
- Build the Go print worker:
  ```sh
  go build -o catprinter catprinter.go
  chmod +x catprinter
  ```

### 4. Install TTF Fonts
- Place `dotmatrix.ttf` and `dotmatrixbold.ttf` in the `fonts/` directory.
- These are required for the Node.js script to render text in the correct style.

### 5. Usage

Print a message to your Cat Printer:
```sh
node print.js <printer-mac-address> "Your message here"
```
- Example:
  ```sh
  node print.js 48:0F:57:12:30:9D "Hello, Cat Printer!"
  ```
- This will:
  1. Render the message as a PNG (rotated 180°, black text on white background)
  2. Call the Go print worker to send the image to your printer via BLE

### 6. Troubleshooting
- Make sure your printer is on and not connected to any other device.
- If you see BLE errors, try running as root or with BLE permissions:
  ```sh
  sudo ./catprinter debug-receipt.png <printer-mac-address>
  ```
- If the printout is blank or garbled, check the generated `debug-receipt.png` for correct orientation and contrast.

### 7. Customization
- You can adjust font size, line height, and intensity in the scripts.
- The Go print worker expects a 384px wide, 1-bit PNG image.

---

**Enjoy your Cat Printer!**
