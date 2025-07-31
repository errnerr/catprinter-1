const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const floydSteinberg = require('floyd-steinberg');

const app = express();
const PORT = 3000;

// Replace with your printer's MAC address
const PRINTER_MAC = '48:0F:57:12:30:9D';

// Function to apply Floyd-Steinberg dithering to an image buffer
async function applyDithering(imageBuffer) {
  try {
    // Convert buffer to sharp image
    const image = sharp(imageBuffer);
    
    // Get image metadata
    const metadata = await image.metadata();
    
    // Resize to printer width and convert to grayscale
    const processedImage = await image
      .resize(384, null, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Create ImageData-like object for Floyd-Steinberg
    const imageData = {
      width: processedImage.info.width,
      height: processedImage.info.height,
      data: processedImage.data
    };
    
    // Apply Floyd-Steinberg dithering
    const ditheredImage = floydSteinberg(imageData);
    
    // Convert back to PNG with proper bit depth
    const ditheredBuffer = Buffer.from(ditheredImage.data);
    
    // Create new sharp image from dithered data
    const finalImage = sharp(ditheredBuffer, {
      raw: {
        width: ditheredImage.width,
        height: ditheredImage.height,
        channels: 1
      }
    });
    
    // Convert to PNG
    return await finalImage.png().toBuffer();
  } catch (error) {
    console.error('Error applying dithering:', error);
    // Fallback to original processing if dithering fails
    return await sharp(imageBuffer)
      .resize(384, null, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .grayscale()
      .threshold(128)
      .png()
      .toBuffer();
  }
}

// Simple print queue to prevent conflicts
let isPrinting = false;
let printQueue = [];

// Function to process print queue
async function processPrintQueue() {
  if (isPrinting || printQueue.length === 0) return;
  
  isPrinting = true;
  const { imagePath, macAddr, res } = printQueue.shift();
  
  try {
    console.log('Starting print job...');
    const printProcess = spawn('./catprinter', [imagePath, macAddr]);
    
    printProcess.stdout.on('data', (data) => {
      console.log(`[catprinter stdout]: ${data}`);
    });
    printProcess.stderr.on('data', (data) => {
      console.error(`[catprinter stderr]: ${data}`);
    });

    printProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Print job completed successfully');
        res.status(200).send('Printed!');
      } else {
        console.error(`catprinter failed with code ${code}`);
        
        // Check if it's a Bluetooth error and attempt recovery
        if (code === 1) {
          console.log('Detected Bluetooth error - device may be busy');
          console.log('Attempting automatic Bluetooth reset...');
          
          // Try to reset Bluetooth automatically
          const resetProcess = spawn('sudo', ['systemctl', 'restart', 'bluetooth']);
          resetProcess.on('close', (resetCode) => {
            console.log('Bluetooth reset result:', resetCode);
            
            // Add a longer delay for Bluetooth errors
            setTimeout(() => {
              isPrinting = false;
              processPrintQueue(); // Process next item
            }, 15000); // 15 second delay for Bluetooth errors
          });
          return;
        }
        
        res.status(500).send('Print failed');
      }
      
      // Add delay before next print job
      setTimeout(() => {
        isPrinting = false;
        processPrintQueue(); // Process next item
      }, 3000); // 3 second delay between jobs
    });
    
    printProcess.on('error', (err) => {
      console.error('Failed to start catprinter:', err);
      res.status(500).send('Print failed');
      
      // Add delay before next print job
      setTimeout(() => {
        isPrinting = false;
        processPrintQueue(); // Process next item
      }, 3000); // 3 second delay between jobs
    });
  } catch (error) {
    console.error('Error in print queue:', error);
    res.status(500).send('Print failed');
    
    // Add delay before next print job
    setTimeout(() => {
      isPrinting = false;
      processPrintQueue(); // Process next item
    }, 3000); // 3 second delay between jobs
  }
}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '10mb' }));

app.get("/bootstrap.min.css", (req, res) => {
     res.sendFile(path.join(__dirname, "bootstrap.min.css"));
});

app.get("/favicon.png", (req, res) => {
  res.sendFile(path.join(__dirname, "favicon.png"));
});

// Serve the static HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle the print form
app.post('/print', async (req, res) => {
  const message = req.body.message || '';
  const imageData = req.body.imageData; // Base64 image data
  
  if (!message.trim() && !imageData) {
    return res.status(400).send('No message or image provided');
  }
  
  console.log('Received print request:', { message: message.trim(), hasImage: !!imageData });

  if (imageData && !message.trim()) {
    // Image only - save base64 to file and print
    console.log('Processing uploaded image');
    
    // Check the image format from the data URL
    const formatMatch = imageData.match(/^data:image\/([^;]+);base64,/);
    const imageFormat = formatMatch ? formatMatch[1] : 'unknown';
    console.log('Detected image format:', imageFormat);
    
    // Remove data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    console.log('Base64 data length:', base64Data.length);
    
    try {
      // Save base64 image to file
      const imageBuffer = Buffer.from(base64Data, 'base64');
      console.log('Image buffer size:', imageBuffer.length);
      
      // Check if it's HEIC format
      const isHeic = imageData.includes('image/heic') || imageData.includes('image/heif');
      console.log('Is HEIC format:', isHeic);
      
      if (isHeic) {
        console.log('Converting HEIC to PNG...');
        // Save as HEIC first
        fs.writeFileSync('temp.heic', imageBuffer);
        console.log('Saved temp.heic, size:', fs.statSync('temp.heic').size);
        
        // Convert HEIC to PNG
        const pngBuffer = await heicConvert({
          buffer: imageBuffer,
          format: 'PNG',
          quality: 0.8
        });
        
        console.log('HEIC conversion result size:', pngBuffer.length);
        
        // Process the PNG with Floyd-Steinberg dithering
        const processedBuffer = await applyDithering(pngBuffer);
        
        console.log('HEIC processing result size:', processedBuffer.length);
        fs.writeFileSync('debug-receipt.png', processedBuffer);
        console.log('Saved debug-receipt.png, size:', fs.statSync('debug-receipt.png').size);
        
        // Clean up temp file
        if (fs.existsSync('temp.heic')) {
          fs.unlinkSync('temp.heic');
        }
      } else if (imageFormat === 'jpeg' || imageFormat === 'jpg') {
        // Convert JPEG to PNG with Floyd-Steinberg dithering
        console.log('Converting JPEG to PNG with dithering...');
        const pngBuffer = await applyDithering(imageBuffer);
        
        console.log('JPEG conversion result size:', pngBuffer.length);
        fs.writeFileSync('debug-receipt.png', pngBuffer);
        console.log('Saved debug-receipt.png, size:', fs.statSync('debug-receipt.png').size);
      } else {
        // Direct PNG save with Floyd-Steinberg dithering
        console.log('Processing PNG format with dithering...');
        const processedBuffer = await applyDithering(imageBuffer);
        
        console.log('PNG processing result size:', processedBuffer.length);
        fs.writeFileSync('debug-receipt.png', processedBuffer);
        console.log('Saved debug-receipt.png, size:', fs.statSync('debug-receipt.png').size);
      }
      
      // Check the first few bytes to verify PNG format
      const fileBuffer = fs.readFileSync('debug-receipt.png');
      const header = fileBuffer.slice(0, 8).toString('hex');
      console.log('File header (hex):', header);
      console.log('Expected PNG header: 89504e470d0a1a0a');
      console.log('Is valid PNG:', header === '89504e470d0a1a0a');
      
      // Send print request to daemon
      const daemonUrl = `http://localhost:8080/print?image=debug-receipt.png`;
      
      fetch(daemonUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
      .then(response => {
        if (response.ok) {
          console.log('Print job completed successfully');
          res.status(200).send('Printed!');
        } else {
          console.error('Daemon print failed:', response.status);
          res.status(500).send('Print failed');
        }
      })
      .catch(error => {
        console.error('Daemon request failed:', error);
        res.status(500).send('Print failed');
      });
    } catch (error) {
      console.error('Error processing image:', error);
      res.status(500).send('Error processing image');
    }
  } else {
    // Text only or text + image - use the existing print.js workflow
    const printProcess = spawn('node', ['print.js', PRINTER_MAC, message]);

    printProcess.stdout.on('data', (data) => {
      console.log(`[print.js stdout]: ${data}`);
    });
    printProcess.stderr.on('data', (data) => {
      console.error(`[print.js stderr]: ${data}`);
    });

    printProcess.on('close', (code) => {
      if (code === 0) {
        res.status(200).send('Printed!');
      } else {
        res.status(500).send('Print failed');
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`Cat Printer web server running at http://localhost:${PORT}`);
});
