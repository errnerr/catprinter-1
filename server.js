const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3000;

// Replace with your printer's MAC address
const PRINTER_MAC = '48:0F:57:12:30:9D';

app.use(bodyParser.urlencoded({ extended: false }));

// Serve the static HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle the print form
app.post('/print', (req, res) => {
  const message = req.body.message || '';
  if (!message.trim()) {
    return res.status(400).send('No message provided');
  }
  console.log('Received print request:', message);

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
});

app.listen(PORT, () => {
  console.log(`Cat Printer web server running at http://localhost:${PORT}`);
});
