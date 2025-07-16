#!/usr/bin/env node

// MXW01 Cat Printer CLI for Raspberry Pi
// Usage: node print.js "Your message here"

const path = require('path');
const { registerFont, createCanvas } = require('canvas');

// Register DotMatrix font if available
const fontPath = path.join(__dirname, 'fonts', 'dotmatrix.ttf');
console.log('[DEBUG] Attempting to load font from:', fontPath);
try {
  registerFont(fontPath, { family: 'DotMatrix' });
  console.log('[DEBUG] DotMatrix font loaded from dotmatrix.ttf');
} catch (e) {
  console.error('[ERROR] Failed to load DotMatrix font:', e);
  console.warn('[WARN] DotMatrix font not loaded, using system monospace font.');
}

const noble = require('@abandonware/noble');

const MAIN_SERVICE_UUID = '0000ae30-0000-1000-8000-00805f9b34fb';
const CONTROL_WRITE_UUID = '0000ae01-0000-1000-8000-00805f9b34fb';
const DATA_WRITE_UUID = '0000ae03-0000-1000-8000-00805f9b34fb';

const PRINTER_WIDTH = 384;
const PRINTER_WIDTH_BYTES = PRINTER_WIDTH / 8;
const MIN_DATA_BYTES = 90 * PRINTER_WIDTH_BYTES;

// CRC8 (Dallas/Maxim variant, Polynomial 0x07, Init 0x00)
const CRC8_TABLE = [
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
  0xDE,0xD9,0xD0,0xD7,0xC2,0xC5,0xCC,0xCB,0xE6,0xE1,0xE8,0xEF,0xFA,0xFD,0xF4,0xF3
];

function calculateCRC8(data) {
  let crc = 0;
  for (let b of data) crc = CRC8_TABLE[(crc ^ b) & 0xFF];
  return crc;
}

function createCommand(cmdId, payload) {
  const len = payload.length;
  const header = [0x22,0x21,cmdId & 0xFF,0x00,len & 0xFF,(len>>8)&0xFF];
  const cmd = new Uint8Array(header.concat(Array.from(payload)));
  const crc = calculateCRC8(payload);
  return new Uint8Array([...cmd, crc, 0xFF]);
}

function encode1bppRow(rowBool) {
  if (rowBool.length !== PRINTER_WIDTH) throw new Error(`Row length must be ${PRINTER_WIDTH}`);
  const rowBytes = new Uint8Array(PRINTER_WIDTH_BYTES);
  for (let byteIndex = 0; byteIndex < PRINTER_WIDTH_BYTES; byteIndex++) {
    let byteVal = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (rowBool[byteIndex * 8 + bit]) {
        byteVal |= 1 << bit;
      }
    }
    rowBytes[byteIndex] = byteVal;
  }
  return rowBytes;
}

function prepareImageDataBuffer(imageRowsBool) {
  const height = imageRowsBool.length;
  let buffer = new Uint8Array(0);
  for (let y = 0; y < height; y++) {
    const rowBytes = encode1bppRow(imageRowsBool[y]);
    const newBuf = new Uint8Array(buffer.length + rowBytes.length);
    newBuf.set(buffer);
    newBuf.set(rowBytes, buffer.length);
    buffer = newBuf;
  }
  if (buffer.length < MIN_DATA_BYTES) {
    const pad = new Uint8Array(MIN_DATA_BYTES - buffer.length);
    const newBuf = new Uint8Array(buffer.length + pad.length);
    newBuf.set(buffer);
    newBuf.set(pad, buffer.length);
    buffer = newBuf;
  }
  return buffer;
}

function textToImageRows(text) {
  // Render multi-line text to a canvas, using DotMatrix or monospace font
  const fontSize = 18;
  const lineHeight = 22;
  const lines = text.split(/\r?\n/);
  const canvas = createCanvas(PRINTER_WIDTH, lines.length * lineHeight + 20);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.textBaseline = 'top';
  ctx.font = `${fontSize}px DotMatrix, monospace`;
  let y = 10;
  for (const line of lines) {
    ctx.textAlign = 'left';
    ctx.fillText(line, 0, y);
    y += lineHeight;
  }

  // Save debug PNG
  try {
    const fs = require('fs');
    const out = fs.createWriteStream('debug-receipt.png');
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', () => console.log('[DEBUG] Saved debug-receipt.png'));
  } catch (e) {
    console.warn('[WARN] Could not save debug-receipt.png:', e);
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rows = [];
  for (let y = 0; y < canvas.height; y++) {
    const row = [];
    for (let x = 0; x < PRINTER_WIDTH; x++) {
      const idx = (y * PRINTER_WIDTH + x) * 4;
      const r = imageData.data[idx];
      row.push(r < 128);
    }
    rows.push(row);
  }
  // Remove empty rows at the bottom
  while (rows.length && rows[rows.length - 1].every(v => !v)) rows.pop();
  return rows;
}

async function connectAndPrint(deviceName, message) {
  return new Promise((resolve, reject) => {
    console.log('[DEBUG] Waiting for Bluetooth adapter state...');
    noble.on('stateChange', async (state) => {
      console.log('[DEBUG] Adapter state:', state);
      if (state === 'poweredOn') {
        try {
          console.log('[DEBUG] Starting scan for all BLE devices...');
          noble.startScanning([], false);
        } catch (err) {
          reject(err);
        }
      } else {
        noble.stopScanning();
        reject(new Error('Bluetooth adapter not powered on.'));
      }
    });

    noble.on('discover', async (peripheral) => {
      const name = peripheral.advertisement && peripheral.advertisement.localName ? peripheral.advertisement.localName : '(no name)';
      console.log(`${peripheral.address}: ${name}`);
      if (name === deviceName) {
        noble.stopScanning();
        try {
          console.log('[DEBUG] Connecting to peripheral...');
          await peripheral.connectAsync();
          console.log('[DEBUG] Connected! Discovering services/characteristics...');
          const services = await peripheral.discoverServicesAsync([]);
          for (const service of services) {
            console.log(`[DEBUG] Service: ${service.uuid}`);
            const chars = await service.discoverCharacteristicsAsync([]);
            for (const char of chars) {
              const props = char.properties ? char.properties.join(',') : '';
              console.log(`  [DEBUG] Characteristic: ${char.uuid} [${props}]`);
            }
          }
          // Find the correct service by short UUID
          const service = services.find(s => s.uuid.slice(-4) === 'ae30');
          if (!service) throw new Error('Printer service (ae30) not found');
          const chars = await service.discoverCharacteristicsAsync([]);
          const dataChar = chars.find(c => c.uuid.slice(-4) === 'ae03');
          const controlChar = chars.find(c => c.uuid.slice(-4) === 'ae01');
          const notifyChar = chars.find(c => c.uuid.slice(-4) === 'ae02');
          if (!dataChar || !controlChar) throw new Error('Printer characteristics not found');

          if (notifyChar) {
            await notifyChar.subscribeAsync();
            console.log('[DEBUG] Subscribed to notifications on ae02');
          }

          // Render text to image rows and prepare buffer
          console.log('[DEBUG] Rendering text and preparing image buffer...');
          const imageRows = textToImageRows(message);
          const imageBuffer = prepareImageDataBuffer(imageRows);

          // Send print command (set intensity, send data, print request)
          console.log('[DEBUG] Sending set intensity command...');
          await controlChar.writeAsync(createCommand(0xA2, Uint8Array.of(0x5D)), false); // Set intensity

          // Send image data in 244-byte chunks with delay
          console.log('[DEBUG] Sending image data...');
          for (let i = 0; i < imageBuffer.length; i += 244) {
            const chunk = imageBuffer.slice(i, i + 244);
            await dataChar.writeAsync(chunk, false);
            await new Promise(res => setTimeout(res, 50)); // 50ms delay
          }

          // Print request: number of lines = imageRows.length
          console.log('[DEBUG] Sending print request...');
          await controlChar.writeAsync(createCommand(0xA9, new Uint8Array([
            imageRows.length & 0xFF,
            (imageRows.length >> 8) & 0xFF,
            0x30, // fixed
            0x00  // mode
          ])), false);

          // Wait for a notification from ae02 before disconnecting
          console.log('[DEBUG] Waiting for notification from ae02...');
          let notificationReceived = false;
          if (notifyChar) {
            const onNotify = (data) => {
              notificationReceived = true;
              console.log('[DEBUG] Notification received from ae02:', data.toString('hex'));
            };
            notifyChar.on('data', onNotify);
            // Wait up to 3 seconds for a notification
            for (let i = 0; i < 30 && !notificationReceived; i++) {
              await new Promise(res => setTimeout(res, 100));
            }
            notifyChar.removeListener('data', onNotify);
          }

          console.log('[DEBUG] Print command sent. Disconnecting...');
          await peripheral.disconnectAsync();
          resolve();
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

async function main() {
  const [deviceName, ...msgParts] = process.argv.slice(2);
  const message = msgParts.join(' ');
  if (!deviceName || !message) {
    console.error('Usage: node print.js <printer-name> "Your message here"');
    process.exit(1);
  }
  console.log('Connecting to printer named', deviceName);
  console.log('Printing:', message);
  try {
    await connectAndPrint(deviceName, message);
    console.log('Print successful!');
    process.exit(0);
  } catch (err) {
    console.error('Print failed:', err.message);
    process.exit(1);
  }
}

main(); 