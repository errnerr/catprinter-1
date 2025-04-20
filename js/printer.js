// Web Bluetooth Printer API for MXW01
import { logger } from './logger.js';

export const PRINTER_WIDTH = 384;
export const PRINTER_WIDTH_BYTES = PRINTER_WIDTH / 8;
export const MIN_DATA_BYTES = 90 * PRINTER_WIDTH_BYTES;
const MAIN_SERVICE_UUID = '0000ae30-0000-1000-8000-00805f9b34fb';
// Alternate UUID on macOS scanning
const MAIN_SERVICE_UUID_ALT = '0000af30-0000-1000-8000-00805f9b34fb';
const CONTROL_WRITE_UUID = '0000ae01-0000-1000-8000-00805f9b34fb';
const DATA_WRITE_UUID = '0000ae03-0000-1000-8000-00805f9b34fb';

const CommandIDs = { 
  GET_STATUS: 0xA1, 
  GET_BATTERY: 0xAB,
  PRINT: 0xA9, 
  PRINT_COMPLETE: 0xAA 
};
let notifyChar;
let pendingResolvers = new Map();
let lastKnownBatteryLevel = null;

// CRC8 (Dallas/Maxim variant, Polynomial 0x07, Init 0x00) Lookup Table from catprinter.cmds
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

// Encode a single row of boolean pixels (length PRINTER_WIDTH) into bytes
function encode1bppRow(rowBool) {
  logger.debug(`Encoding row of ${rowBool.length} pixels to ${PRINTER_WIDTH_BYTES} bytes`);
  if (rowBool.length !== PRINTER_WIDTH) {
    const error = `Row length must be ${PRINTER_WIDTH}, got ${rowBool.length}`;
    logger.error(error);
    throw new Error(error);
  }
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
  
  // Log first and last few bytes for debugging
  const firstBytes = Array.from(rowBytes.slice(0, 3)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
  const lastBytes = Array.from(rowBytes.slice(-3)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
  logger.debug(`Row encoded: First bytes: ${firstBytes}... Last bytes: ${lastBytes}`);
  
  return rowBytes;
}

// Prepare full image data buffer, pad to MIN_DATA_BYTES
function prepareImageDataBuffer(imageRowsBool) {
  const height = imageRowsBool.length;
  logger.info(`Preparing image data buffer for ${height} rows`, { 
    width: PRINTER_WIDTH, 
    bytesPerRow: PRINTER_WIDTH_BYTES,
    minBytes: MIN_DATA_BYTES 
  });
  
  let buffer = new Uint8Array(0);
  for (let y = 0; y < height; y++) {
    const rowBytes = encode1bppRow(imageRowsBool[y]);
    const newBuf = new Uint8Array(buffer.length + rowBytes.length);
    newBuf.set(buffer);
    newBuf.set(rowBytes, buffer.length);
    buffer = newBuf;
    
    if (y % 50 === 0 || y === height - 1) {
      logger.debug(`Processed row ${y+1}/${height} (${Math.round((y+1)/height*100)}%)`);
      logger.setProgress(Math.round((y+1)/height*50)); // First 50% of progress is encoding
    }
  }
  
  // Check if padding is needed
  if (buffer.length < MIN_DATA_BYTES) {
    logger.info(`Padding buffer to minimum size: ${buffer.length} -> ${MIN_DATA_BYTES} bytes`);
    const pad = new Uint8Array(MIN_DATA_BYTES - buffer.length);
    const newBuf = new Uint8Array(buffer.length + pad.length);
    newBuf.set(buffer);
    newBuf.set(pad, buffer.length);
    buffer = newBuf;
  }
  
  // Log buffer statistics
  logger.info(`Image buffer prepared`, {
    totalBytes: buffer.length,
    dataBytes: height * PRINTER_WIDTH_BYTES,
    paddingBytes: buffer.length - (height * PRINTER_WIDTH_BYTES)
  });
  
  return buffer;
}

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
  
  logger.debug(`Creating command 0x${cmdId.toString(16).toUpperCase()}`, { 
    payloadLength: len,
    crc: '0x' + crc.toString(16).padStart(2, '0')
  });
  
  return new Uint8Array([...cmd, crc, 0xFF]);
}

function cmdSetIntensity(intensity=0x5D) { 
  logger.debug(`Setting print intensity to 0x${intensity.toString(16).toUpperCase()}`);
  return createCommand(0xA2, Uint8Array.of(intensity)); 
}

function cmdPrintRequest(lines, mode=0) {
  logger.info(`Sending print request`, { lines, mode });
  const data = new Uint8Array(4);
  data[0] = lines & 0xFF;
  data[1] = (lines>>8)&0xFF;
  data[2] = 0x30;
  data[3] = mode;
  return createCommand(0xA9, data);
}

function cmdFlush() { 
  logger.debug(`Sending flush command`);
  return createCommand(0xAD, Uint8Array.of(0x00)); 
}

// notification handler
function handleNotification(event) {
  const data = new Uint8Array(event.target.value.buffer);
  
  if (data[0] !== 0x22 || data[1] !== 0x21) {
    logger.warn(`Ignoring unexpected notification format`);
    return;
  }
  
  const cmdId = data[2];
  const len = data[4] | (data[5] << 8);
  const payload = data.slice(6, 6 + len);
  
  logger.debug(`Received notification for command 0x${cmdId.toString(16).toUpperCase()}`, { 
    payloadLength: len
  });
  
  logger.hexDump(`Notification payload for command 0x${cmdId.toString(16).toUpperCase()}`, payload);
  
  const resolver = pendingResolvers.get(cmdId);
  if (resolver) {
    resolver(payload);
    pendingResolvers.delete(cmdId);
  } else {
    logger.warn(`No pending resolver for command 0x${cmdId.toString(16).toUpperCase()}`);
  }
}

// wait for a specific notification
function waitForNotification(cmdId, timeoutMs = 10000) {
  logger.debug(`Waiting for notification response to command 0x${cmdId.toString(16).toUpperCase()}`, {
    timeoutMs
  });
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResolvers.delete(cmdId);
      const error = `Timeout waiting for notification 0x${cmdId.toString(16)}`;
      logger.error(error);
      reject(new Error(error));
    }, timeoutMs);
    
    pendingResolvers.set(cmdId, (payload) => {
      clearTimeout(timer);
      logger.debug(`Notification for command 0x${cmdId.toString(16).toUpperCase()} resolved`);
      resolve(payload);
    });
  });
}

let device, server, controlChar, dataChar;

export async function connectPrinter() {
  logger.info('Connecting to MXW01 printer...');
  
  // Ensure Web Bluetooth API is available
  if (typeof navigator.bluetooth === 'undefined') {
    const error = 'Web Bluetooth API unavailable. Use Chrome/Edge on HTTPS or localhost.';
    logger.error(error);
    throw new Error(error);
  }
  
  if (device && device.gatt.connected) {
    logger.info('Already connected to printer');
    return;
  }
  
  logger.debug('Requesting Bluetooth device');
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [MAIN_SERVICE_UUID] },
        { services: [MAIN_SERVICE_UUID_ALT] }
      ],
      optionalServices: [MAIN_SERVICE_UUID, MAIN_SERVICE_UUID_ALT, CONTROL_WRITE_UUID, DATA_WRITE_UUID]
    });
    
    logger.info(`Printer found: "${device.name || 'Unknown device'}"`, {
      id: device.id
    });
  } catch (err) {
    logger.warn('Filter discovery failed, falling back to accept all devices', { error: err.message });
    
    // Fallback: allow user to pick any device, then connect to known services
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [MAIN_SERVICE_UUID, MAIN_SERVICE_UUID_ALT, CONTROL_WRITE_UUID, DATA_WRITE_UUID]
    });
    logger.info(`Selected device: "${device.name || 'Unknown device'}"`, { id: device.id });
  }
  
  logger.debug('Connecting to GATT server');
  server = await device.gatt.connect();
  logger.debug('GATT server connected');
  
  let svc;
  try {
    logger.debug(`Attempting to get primary service: ${MAIN_SERVICE_UUID}`);
    svc = await server.getPrimaryService(MAIN_SERVICE_UUID);
    logger.debug('Primary service obtained');
  } catch (e) {
    logger.warn(`Primary service not found with MAIN_SERVICE_UUID, trying alternate`, { error: e.message });
    svc = await server.getPrimaryService(MAIN_SERVICE_UUID_ALT);
    logger.debug('Primary service obtained (using alternate UUID)');
  }
  
  logger.debug('Getting control characteristic');
  controlChar = await svc.getCharacteristic(CONTROL_WRITE_UUID);
  
  logger.debug('Getting data characteristic');
  dataChar = await svc.getCharacteristic(DATA_WRITE_UUID);
  
  // Also get notify characteristic and start notifications
  logger.debug('Setting up notifications');
  notifyChar = await svc.getCharacteristic('0000ae02-0000-1000-8000-00805f9b34fb');
  await notifyChar.startNotifications();
  notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
  
  logger.success('Printer connected and ready');
}

export async function getBatteryLevel() {
  logger.info('Querying battery level');
  try {
    // First try using the direct battery command (AB)
    try {
      await controlChar.writeValue(createCommand(CommandIDs.GET_BATTERY, Uint8Array.of(0x00)));
      const batteryPayload = await waitForNotification(CommandIDs.GET_BATTERY, 5000);
      if (batteryPayload && batteryPayload.length > 0) {
        lastKnownBatteryLevel = batteryPayload[0];
        logger.info('Battery level retrieved using AB command', { level: lastKnownBatteryLevel });
        return lastKnownBatteryLevel;
      }
    } catch (e) {
      logger.warn('Failed to get battery with AB command, falling back to status command', { error: e.message });
    }
    
    // Fallback to status command (A1) which also includes battery level
    const statusResult = await getPrinterStatus();
    if (statusResult && statusResult.batteryLevel !== undefined) {
      lastKnownBatteryLevel = statusResult.batteryLevel;
      return lastKnownBatteryLevel;
    }
    
    // Return last known level if we have it
    if (lastKnownBatteryLevel !== null) {
      logger.warn('Using cached battery level', { level: lastKnownBatteryLevel });
      return lastKnownBatteryLevel;
    }
    
    const error = 'Failed to retrieve battery level';
    logger.error(error);
    throw new Error(error);
  } catch (error) {
    logger.error('Error querying battery level', { message: error.message });
    throw error;
  }
}

export async function getPrinterStatus() {
  if (!controlChar) {
    logger.error('Not connected to printer');
    throw new Error('Not connected to printer');
  }
  
  try {
    logger.debug('Requesting printer status');
    await controlChar.writeValue(createCommand(CommandIDs.GET_STATUS, Uint8Array.of(0x00)));
    const statusPayload = await waitForNotification(CommandIDs.GET_STATUS, 5000);
    
    if (!statusPayload) {
      logger.warn('No status response received');
      return null;
    }
    
    const result = {
      raw: statusPayload,
      isError: false,
      errorCode: null,
      batteryLevel: null,
      temperature: null,
      statusCode: null
    };
    
    // Extract information from payload
    if (statusPayload.length >= 7) {
      result.statusCode = statusPayload[6];
    }
    
    if (statusPayload.length >= 10) {
      result.batteryLevel = statusPayload[9];
    }
    
    if (statusPayload.length >= 11) {
      result.temperature = statusPayload[10];
    }
    
    if (statusPayload.length >= 13 && statusPayload[12] !== 0) {
      result.isError = true;
      if (statusPayload.length >= 14) {
        result.errorCode = statusPayload[13];
      }
    }
    
    logger.info('Printer status retrieved', result);
    return result;
  } catch (error) {
    logger.error('Error querying printer status', { message: error.message });
    throw error;
  }
}

// Simple helper to check if we are connected
export function isPrinterConnected() {
  return !!(device && device.gatt.connected);
}

// Get last known battery level without making a BLE request
export function getLastKnownBatteryLevel() {
  return lastKnownBatteryLevel;
}

export async function printImage(canvas) {
  logger.info('Starting print job');
  const startTime = Date.now();
  
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  
  logger.info('Canvas dimensions', { width, height });
  
  if (width !== PRINTER_WIDTH) {
    const error = `Canvas width ${width} != expected printer width ${PRINTER_WIDTH}`;
    logger.error(error);
    throw new Error(error);
  }
  
  // Build boolean rows by thresholding luminance
  logger.info('Converting image to 1-bit format');
  const imgData = ctx.getImageData(0, 0, width, height).data;
  const rowsBool = [];
  
  for (let y = 0; y < height; y++) {
    const row = new Array(width).fill(false);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * imgData[i] + 0.587 * imgData[i+1] + 0.114 * imgData[i+2];
      row[x] = lum < 128;
    }
    rowsBool.push(row);
    
    // Update progress every 10% or so
    if (y % Math.round(height/10) === 0) {
      logger.setProgress(Math.round(y/height*20)); // First 20% is image conversion
    }
  }
  
  // Rotate 180° (bottom-first) as per default Python behavior
  logger.info('Rotating image 180° for printing');
  const rotatedRows = rowsBool.reverse().map(row => row.slice().reverse());
  
  // Encode and pad
  const buffer = prepareImageDataBuffer(rotatedRows);
  
  // Calculate print statistics
  const stats = {
    imageWidth: width,
    imageHeight: height,
    bytesPerRow: PRINTER_WIDTH_BYTES,
    totalRows: height,
    totalBytes: buffer.length,
    chunkSize: PRINTER_WIDTH_BYTES,
    totalChunks: Math.ceil(buffer.length / PRINTER_WIDTH_BYTES)
  };
  
  logger.info('Print job statistics', stats);
  
  try {
    // 1) Set intensity
    logger.debug('Step 1: Set print intensity');
    await controlChar.writeValue(cmdSetIntensity());
    
    // 2) Request status (A1) and wait response
    logger.debug('Step 2: Request printer status');
    await controlChar.writeValue(createCommand(CommandIDs.GET_STATUS, Uint8Array.of(0x00)));
    const statusPayload = await waitForNotification(CommandIDs.GET_STATUS, 5000);
    
    logger.debug('Received status payload', { 
      length: statusPayload?.length || 0
    });
    
    if (!statusPayload) {
      logger.warn('No status response, proceeding anyway');
    } else if (statusPayload.length >= 13 && statusPayload[12] !== 0) {
      const errCode = statusPayload[13];
      const error = `Printer status error code: ${errCode}`;
      logger.error(error, { statusCode: errCode });
      throw new Error(error);
    } else {
      // Log printer status details
      let statusInfo = {};
      if (statusPayload.length >= 5) {
        statusInfo.voltage = statusPayload[4];
      }
      if (statusPayload.length >= 8) {
        statusInfo.temperature = statusPayload[5] | (statusPayload[6] << 8);
      }
      logger.info('Printer status OK', statusInfo);
    }
    
    // 3) Send print request (A9) and wait ack
    logger.debug('Step 3: Send print request');
    await controlChar.writeValue(cmdPrintRequest(height, 0));
    const printAck = await waitForNotification(CommandIDs.PRINT, 5000);
    
    if (!printAck || printAck[0] !== 0) {
      const error = 'Print request rejected: ' + (printAck ? printAck[0] : 'no response');
      logger.error(error);
      throw new Error(error);
    } else {
      logger.info('Print request accepted');
    }
    
    // 4) Transfer image data in chunks
    const chunkSize = PRINTER_WIDTH_BYTES; // 48 bytes per row
    let pos = 0;
    let chunkCount = 0;
    const totalChunks = Math.ceil(buffer.length / chunkSize);
    
    logger.info('Starting data transfer', {
      totalBytes: buffer.length,
      chunkSize,
      totalChunks
    });
    
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Transfer data chunks
    while (pos < buffer.length) {
      const chunk = buffer.slice(pos, pos + chunkSize);
      chunkCount++;
      
      logger.debug(`Sending chunk ${chunkCount}/${totalChunks}`, { 
        bytes: chunk.length,
        position: pos
      });
      
      await dataChar.writeValueWithoutResponse(chunk);
      pos += chunk.length;
      
      // Set progress for data transfer phase (50%-90%)
      logger.setProgress(50 + Math.round((pos / buffer.length) * 40));
      
      // Add small delay to prevent buffer overrun
      await sleep(15);
    }
    
    logger.success('Data transfer complete', {
      bytesSent: pos,
      chunksTransferred: chunkCount
    });
    
    // 5) Flush data
    logger.debug('Step 5: Sending flush command');
    await controlChar.writeValue(cmdFlush());
    
    // 6) Wait for print complete (AA)
    logger.debug('Step 6: Waiting for print completion notification');
    const complete = await waitForNotification(CommandIDs.PRINT_COMPLETE, 20000);
    
    if (!complete) {
      logger.warn('No print-complete notification received');
    } else {
      const printTime = (Date.now() - startTime) / 1000;
      logger.success('Print completed successfully', { 
        executionTime: printTime.toFixed(1) + 's',
        linesPerSecond: (height / printTime).toFixed(1)
      });
    }
    
    // Set progress to 100%
    logger.setProgress(100);
    
  } catch (error) {
    logger.error('Printing failed', { message: error.message });
    throw error;
  }
}
