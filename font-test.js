const path = require('path');
const { registerFont, createCanvas } = require('canvas');

const fontPath = path.join(__dirname, 'fonts', 'dotmatrix.ttf');
console.log('[DEBUG] Attempting to load font from:', fontPath);
try {
  registerFont(fontPath, { family: 'DotMatrix' });
  console.log('[DEBUG] DotMatrix font loaded from dotmatrix.ttf');
} catch (e) {
  console.error('[ERROR] Failed to load DotMatrix font:', e);
  console.warn('[WARN] DotMatrix font not loaded, using system monospace font.');
}

const canvas = createCanvas(384, 100);
const ctx = canvas.getContext('2d');
ctx.font = '18px DotMatrix, monospace';
ctx.fillText('Font test', 10, 50);

const fs = require('fs');
const out = fs.createWriteStream('font-test.png');
const stream = canvas.createPNGStream();
stream.pipe(out);
out.on('finish', () => console.log('Saved font-test.png'));