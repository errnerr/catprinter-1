import { connectPrinter, printImage, getBatteryLevel, isPrinterConnected, getLastKnownBatteryLevel } from './printer.js';
import { renderReceipt, updateReceiptPreview } from './receiptRenderer.js';
import { logger, setupLoggerUI } from './logger.js';
import * as imageProcessor from './imageProcessor.js';

// === DOM Elements ===
// Mode toggle
const receiptModeBtn = document.getElementById('receiptModeBtn');
const imageModeBtn = document.getElementById('imageModeBtn');
const receiptModeContent = document.getElementById('receiptModeContent');
const imageModeContent = document.getElementById('imageModeContent');

// Battery indicator elements
const batteryIndicator = document.getElementById('batteryIndicator');
const batteryLevel = document.getElementById('batteryLevel');
const batteryIcon = document.querySelector('.battery-icon');

// Receipt Mode Elements
// Business info
const businessNameInput = document.getElementById('businessName');
const businessAddressInput = document.getElementById('businessAddress');
const businessPhoneInput = document.getElementById('businessPhone');
// Transaction info
const tableNumberInput = document.getElementById('tableNumber');
const serverNameInput = document.getElementById('serverName');
const transactionNumberInput = document.getElementById('transactionNumber');
const taxRateInput = document.getElementById('taxRate');
const dateTimeField = document.getElementById('dateTimeField');
// Items
const itemsListContainer = document.getElementById('itemsList');
const newItemNameInput = document.getElementById('newItemName');
const newItemPriceInput = document.getElementById('newItemPrice');
const addItemBtn = document.getElementById('addItemBtn');
// Payment
const tipAmountInput = document.getElementById('tipAmount');
const paymentMethodSelect = document.getElementById('paymentMethod');
const amountPaidInput = document.getElementById('amountPaid');
const changeAmountDisplay = document.getElementById('changeAmount');
// Footer
const footerMessageInput = document.getElementById('footerMessage');
// Buttons
const connectReceiptBtn = document.getElementById('connectReceiptBtn');
const printReceiptBtn = document.getElementById('printReceiptBtn');
const resetBtn = document.getElementById('resetBtn');
// Receipt preview
const receiptPreview = document.getElementById('receiptPreview');
const receiptContainer = document.getElementById('receiptContainer');
const receiptSummary = document.getElementById('receiptSummary');

// Image Mode Elements
const imageUploadInput = document.getElementById('imageUpload');
const ditherMethodSelect = document.getElementById('ditherMethod');
const thresholdValueInput = document.getElementById('thresholdValue');
const thresholdDisplay = document.getElementById('thresholdDisplay');
const imageInvertInput = document.getElementById('imageInvert');
const imageWidthInput = document.getElementById('imageWidth');
const autoscaleImageInput = document.getElementById('autoscaleImage');
const imagePaddingInput = document.getElementById('imagePadding');
const connectImageBtn = document.getElementById('connectImageBtn');
const resetImageBtn = document.getElementById('resetImageBtn');
const printImageBtn = document.getElementById('printImageBtn');
const imagePreview = document.getElementById('imagePreview');
const imagePreviewMessage = document.getElementById('imagePreviewMessage');
const imageSummary = document.getElementById('imageSummary');

// Logger UI elements
const logWrapper = document.getElementById('logWrapper');
const clearLogBtn = document.getElementById('clearLogBtn');
const printProgressBar = document.getElementById('printProgressBar');

// === Data Store ===
let items = [];
let currentDateTime = new Date().toLocaleString();
let currentMode = 'receipt'; // 'receipt' or 'image'

// === Battery Level Timer ===
let batteryCheckIntervalId = null;
const BATTERY_CHECK_INTERVAL = 30000; // 30 seconds

// === Initialize ===
function init() {
    updateDateTime();
    setInterval(updateDateTime, 60000); // Update time every minute
    renderItemsList();
    updateReceiptView();
    
    // Add event listeners for real-time updates
    const allReceiptInputs = document.querySelectorAll('#receiptModeContent input, #receiptModeContent textarea, #receiptModeContent select');
    allReceiptInputs.forEach(input => {
        input.addEventListener('input', updateReceiptView);
    });
    
    // Initialize logger UI
    initLoggerUI();
    
    // Initialize mode toggle
    setupModeToggle();
    
    // Set up image mode listeners
    setupImageModeListeners();
    
    // Set up connect buttons
    setupConnectButtons();
    
    // Initialize print buttons (disabled by default)
    updatePrintButtonState();
}

// Initialize the logger UI
function initLoggerUI() {
    // Set up the logger UI
    setupLoggerUI(logWrapper, printProgressBar);
    
    // Add clear log button event listener
    clearLogBtn.addEventListener('click', () => {
        logger.clear();
        logger.info('Log cleared');
    });
    
    // Add initial log entries
    logger.info('Printer Tool initialized');
    logger.info('Printer configuration', {
        printerWidth: 384,
        printerWidthBytes: 48,
        minDataBytes: 4320
    });
    
    // Log detailed protocol information
    logger.data('Printer Protocol', `MXW01 Thermal Printer Protocol Summary:

1. Connect via Bluetooth LE to service UUID: 0000ae30-0000-1000-8000-00805f9b34fb
2. Communication happens through three characteristics:
   - Control write: 0000ae01-0000-1000-8000-00805f9b34fb
   - Notification: 0000ae02-0000-1000-8000-00805f9b34fb
   - Data write: 0000ae03-0000-1000-8000-00805f9b34fb

3. Command format: 0x22 0x21 [CMD] 0x00 [LEN_L] [LEN_H] [PAYLOAD...] [CRC8] 0xFF
4. Print process:
   a. Set intensity (0xA2)
   b. Request status (0xA1)
   c. Send print request (0xA9)
   d. Transfer data in chunks
   e. Flush data (0xAD)
   f. Wait for print complete notification (0xAA)

5. Image encoding:
   - 1-bit monochrome (black/white)
   - 384 pixels wide (48 bytes)
   - Rows are sent sequentially
   - Image is rotated 180° before sending`);
}

// Setup mode toggle functionality
function setupModeToggle() {
    receiptModeBtn.addEventListener('click', () => {
        setActiveMode('receipt');
    });
    
    imageModeBtn.addEventListener('click', () => {
        setActiveMode('image');
    });
    
    // Initialize with receipt mode active
    setActiveMode('receipt');
}

// Set the active mode (receipt or image)
function setActiveMode(mode) {
    currentMode = mode;
    
    // Update button states
    receiptModeBtn.classList.toggle('active', mode === 'receipt');
    imageModeBtn.classList.toggle('active', mode === 'image');
    
    // Update content visibility
    receiptModeContent.classList.toggle('active', mode === 'receipt');
    imageModeContent.classList.toggle('active', mode === 'image');
    
    // Log mode change
    logger.info(`Switched to ${mode} mode`);
    
    // Update UI specific to the mode
    if (mode === 'receipt') {
        updateReceiptView();
    } else {
        updateImagePreview();
    }
    
    // Change printing status style based on mode
    document.documentElement.style.setProperty('--printing-status-color', 
        mode === 'receipt' ? '#3182ce' : '#c53030');
}

// Setup image mode event listeners
function setupImageModeListeners() {
    // Image upload
    imageUploadInput.addEventListener('change', handleImageUpload);
    
    // Dither method change
    ditherMethodSelect.addEventListener('change', () => {
        imageProcessor.updateSettings({ ditherMethod: ditherMethodSelect.value });
        updateImagePreview();
    });
    
    // Threshold value change
    thresholdValueInput.addEventListener('input', () => {
        const threshold = parseInt(thresholdValueInput.value);
        thresholdDisplay.textContent = threshold;
        imageProcessor.updateSettings({ threshold });
        updateImagePreview();
    });
    
    // Invert toggle
    imageInvertInput.addEventListener('change', () => {
        imageProcessor.updateSettings({ invert: imageInvertInput.checked });
        updateImagePreview();
    });
    
    // Width change
    imageWidthInput.addEventListener('change', () => {
        let width = parseInt(imageWidthInput.value);
        if (width < 1) width = 1;
        if (width > 384) width = 384;
        imageWidthInput.value = width;
        imageProcessor.updateSettings({ width });
        updateImagePreview();
    });
    
    // Auto-scale toggle
    autoscaleImageInput.addEventListener('change', () => {
        imageProcessor.updateSettings({ autoscale: autoscaleImageInput.checked });
        updateImagePreview();
    });
    
    // Padding change
    imagePaddingInput.addEventListener('change', () => {
        let padding = parseInt(imagePaddingInput.value);
        if (padding < 0) padding = 0;
        if (padding > 100) padding = 100;
        imagePaddingInput.value = padding;
        imageProcessor.updateSettings({ padding });
        updateImagePreview();
    });
    
    // Reset image settings
    resetImageBtn.addEventListener('click', resetImageSettings);
    
    // Print image
    printImageBtn.addEventListener('click', printProcessedImage);
}

// Handle image upload
async function handleImageUpload() {
    try {
        if (!imageUploadInput.files || !imageUploadInput.files[0]) {
            return;
        }
        
        const file = imageUploadInput.files[0];
        logger.info(`Processing uploaded image: ${file.name}`, {
            type: file.type,
            size: `${Math.round(file.size / 1024)} KB`
        });
        
        // Show loading state
        imagePreviewMessage.textContent = 'Loading image...';
        imagePreview.style.display = 'none';
        
        // Load the image
        await imageProcessor.loadImage(file);
        
        // Update the preview
        updateImagePreview();
        
    } catch (err) {
        logger.error('Error uploading image', { message: err.message });
        imagePreviewMessage.textContent = `Error: ${err.message}`;
    }
}

// Update the image preview
function updateImagePreview() {
    const canvas = imageProcessor.processImage();
    
    if (!canvas) {
        imagePreview.style.display = 'none';
        imagePreviewMessage.style.display = 'block';
        imagePreviewMessage.textContent = 'No image loaded';
        imageSummary.innerHTML = '';
        return;
    }
    
    // Display processed image
    imagePreview.width = canvas.width;
    imagePreview.height = canvas.height;
    const ctx = imagePreview.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    
    imagePreview.style.display = 'block';
    imagePreviewMessage.style.display = 'none';
    
    // Update image summary
    updateImageSummary();
}

// Update the image summary panel
function updateImageSummary() {
    const summary = imageProcessor.getImageSummary();
    if (!summary) {
        imageSummary.innerHTML = '';
        return;
    }
    
    imageSummary.innerHTML = `
    <div class="summary-section">
        <div class="summary-row">
            <span>Original Size:</span> <span>${summary.originalWidth} × ${summary.originalHeight} px</span>
        </div>
        <div class="summary-row">
            <span>Print Size:</span> <span>${summary.processedWidth} × ${summary.processedHeight} px</span>
        </div>
        <div class="summary-row">
            <span>Aspect Ratio:</span> <span>${summary.aspectRatio}</span>
        </div>
    </div>
    <div class="summary-section">
        <div class="summary-row">
            <span>Dithering:</span> <span>${summary.ditherMethod}</span>
        </div>
        <div class="summary-row">
            <span>Threshold:</span> <span>${summary.threshold}</span>
        </div>
        <div class="summary-row">
            <span>Inverted:</span> <span>${summary.invert ? 'Yes' : 'No'}</span>
        </div>
    </div>`;
}

// Reset image settings
function resetImageSettings() {
    const settings = imageProcessor.resetSettings();
    
    // Update UI to match reset settings
    ditherMethodSelect.value = settings.ditherMethod;
    thresholdValueInput.value = settings.threshold;
    thresholdDisplay.textContent = settings.threshold;
    imageInvertInput.checked = settings.invert;
    imageWidthInput.value = settings.width;
    autoscaleImageInput.checked = settings.autoscale;
    imagePaddingInput.value = settings.padding;
    
    // Update preview
    updateImagePreview();
    logger.info('Image settings reset to defaults');
}

// Print the processed image
async function printProcessedImage() {
    const canvas = imageProcessor.processImage();
    
    if (!canvas) {
        logger.warn('No image to print');
        showPrintingStatus('No image to print', 'error');
        setTimeout(() => hidePrintingStatus(), 3000);
        return;
    }
    
    try {
        // Check if printer is connected
        if (!isPrinterConnected()) {
            logger.warn('Printer not connected');
            showPrintingStatus('Please connect to printer first', 'error');
            setTimeout(() => hidePrintingStatus(), 3000);
            return;
        }
        
        // Show printing status
        showPrintingStatus('Printing image...');
        
        // Log print job starting
        logger.info('Starting new print job');
        
        // Print the image
        await printImage(canvas);
        
        // Show success message
        showPrintingStatus('Image printed successfully!', 'success');
        setTimeout(() => hidePrintingStatus(), 3000);
    } catch (err) {
        console.error('Print error:', err);
        logger.error('Print error', { message: err.message });
        showPrintingStatus(`Error: ${err.message}`, 'error');
        setTimeout(() => hidePrintingStatus(), 5000);
    }
}

// === Connection and Battery Status ===
function setupConnectButtons() {
    // Add event listeners to both connect buttons
    connectReceiptBtn.addEventListener('click', handleConnectPrinter);
    connectImageBtn.addEventListener('click', handleConnectPrinter);
}

function updatePrintButtonState() {
    const connected = isPrinterConnected();
    
    // Update print buttons
    printReceiptBtn.disabled = !connected;
    printImageBtn.disabled = !connected;
    
    if (connected) {
        printReceiptBtn.classList.remove('btn-secondary');
        printReceiptBtn.classList.add('btn-primary');
        printImageBtn.classList.remove('btn-secondary');
        printImageBtn.classList.add('btn-primary');
    } else {
        printReceiptBtn.classList.remove('btn-primary');
        printReceiptBtn.classList.add('btn-secondary');
        printImageBtn.classList.remove('btn-primary');
        printImageBtn.classList.add('btn-secondary');
    }
    
    // Update connect buttons
    const buttonText = connected ? 'Reconnect' : 'Connect Printer';
    connectReceiptBtn.textContent = buttonText;
    connectImageBtn.textContent = buttonText;
    
    // Start or stop battery check based on connection status
    if (connected && !batteryCheckIntervalId) {
        startBatteryCheck();
    } else if (!connected && batteryCheckIntervalId) {
        stopBatteryCheck();
    }
}

async function handleConnectPrinter() {
    try {
        showPrintingStatus('Connecting to printer...');
        logger.info('Connecting to printer');
        await connectPrinter();
        
        // Update battery immediately after connection
        await updateBatteryStatus();
        
        // Start periodic battery check
        startBatteryCheck();
        
        // Update print button state
        updatePrintButtonState();
        
        showPrintingStatus('Printer connected successfully!', 'success');
        setTimeout(() => hidePrintingStatus(), 3000);
    } catch (err) {
        console.error('Connection error:', err);
        logger.error('Connection error', { message: err.message });
        showPrintingStatus(`Error: ${err.message}`, 'error');
        setTimeout(() => hidePrintingStatus(), 5000);
    }
}

function startBatteryCheck() {
    if (batteryCheckIntervalId) {
        clearInterval(batteryCheckIntervalId);
    }
    
    batteryCheckIntervalId = setInterval(async () => {
        if (isPrinterConnected()) {
            try {
                await updateBatteryStatus();
            } catch (error) {
                logger.warn('Failed to update battery status', { error: error.message });
            }
        } else {
            stopBatteryCheck();
        }
    }, BATTERY_CHECK_INTERVAL);
    
    logger.debug('Battery check interval started', { intervalMs: BATTERY_CHECK_INTERVAL });
}

function stopBatteryCheck() {
    if (batteryCheckIntervalId) {
        clearInterval(batteryCheckIntervalId);
        batteryCheckIntervalId = null;
        logger.debug('Battery check interval stopped');
    }
}

async function updateBatteryStatus() {
    try {
        let level;
        
        if (isPrinterConnected()) {
            // If connected, try to get fresh battery level
            level = await getBatteryLevel();
        } else {
            // If not connected, use last known level
            level = getLastKnownBatteryLevel();
        }
        
        if (level !== null) {
            updateBatteryIndicator(level);
        }
    } catch (error) {
        logger.warn('Error getting battery level', { message: error.message });
    }
}

function updateBatteryIndicator(level) {
    // Update the UI to display battery level
    if (level === null) {
        batteryIndicator.style.display = 'none';
        return;
    }
    
    batteryIndicator.style.display = 'flex';
    
    // Show percentage
    batteryLevel.textContent = `${level}%`;
    
    // Set color based on level
    if (level < 20) {
        batteryLevel.className = 'battery-level low';
        batteryIcon.innerHTML = '🔋';
    } else if (level < 50) {
        batteryLevel.className = 'battery-level medium';
        batteryIcon.innerHTML = '🔋';
    } else {
        batteryLevel.className = 'battery-level high';
        batteryIcon.innerHTML = '🔋';
    }
    
    logger.debug('Battery indicator updated', { level });
}

// === Item Management ===
function addItem() {
    const name = newItemNameInput.value.trim();
    const price = parseFloat(newItemPriceInput.value) || 0;
    
    if (name) {
        items.push({ name, price });
        newItemNameInput.value = '';
        newItemPriceInput.value = '';
        newItemNameInput.focus();
        renderItemsList();
        updateReceiptView();
    }
}

function deleteItem(index) {
    items.splice(index, 1);
    renderItemsList();
    updateReceiptView();
}

function renderItemsList() {
    itemsListContainer.innerHTML = '';
    
    items.forEach((item, index) => {
        const itemRow = document.createElement('div');
        itemRow.className = 'item-row';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'item-name';
        nameSpan.textContent = item.name;
        
        const priceSpan = document.createElement('span');
        priceSpan.className = 'item-price';
        priceSpan.textContent = `$${item.price.toFixed(2)}`;
        
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'item-delete';
        deleteBtn.textContent = '×';
        deleteBtn.onclick = () => deleteItem(index);
        
        itemRow.appendChild(nameSpan);
        itemRow.appendChild(priceSpan);
        itemRow.appendChild(deleteBtn);
        
        itemsListContainer.appendChild(itemRow);
    });
}

// === Calculations ===
function calculateTotals() {
    // Calculate subtotal from items
    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.price || 0), 0);
    const taxRate = parseFloat(taxRateInput.value) || 0;
    const tax = subtotal * (taxRate / 100);
    const tip = parseFloat(tipAmountInput.value) || 0;
    const total = subtotal + tax + tip;
    const amountPaid = parseFloat(amountPaidInput.value) || 0;
    const change = Math.max(0, amountPaid - total);
    
    // Update change display
    changeAmountDisplay.textContent = `$${change.toFixed(2)}`;
    
    return { subtotal, tax, tip, total, change };
}

function updateDateTime() {
    currentDateTime = new Date().toLocaleString();
    dateTimeField.textContent = currentDateTime;
    updateReceiptView(); // Refresh receipt preview with new time
}

// === Receipt Management ===
function getReceiptData() {
    calculateTotals(); // Make sure calculations are up to date
    
    return {
        businessName: businessNameInput.value,
        businessAddress: businessAddressInput.value,
        businessPhone: businessPhoneInput.value,
        tableNumber: tableNumberInput.value,
        serverName: serverNameInput.value,
        transactionNumber: transactionNumberInput.value,
        taxRate: parseFloat(taxRateInput.value) || 0,
        dateTime: currentDateTime,
        tipAmount: parseFloat(tipAmountInput.value) || 0,
        paymentMethod: paymentMethodSelect.value,
        amountPaid: parseFloat(amountPaidInput.value) || 0,
        footerMessage: footerMessageInput.value
    };
}

function updateReceiptView() {
    const receiptData = getReceiptData();
    showBitmapPreview(receiptData, items);
    updateReceiptSummary();
}

// Updated function for a preview that fits on screen
async function showBitmapPreview(receiptData, items) {
    const canvas = await renderReceipt(receiptData, items);
    const previewContainer = document.getElementById('receiptPreview');
    
    // Clear current preview
    previewContainer.innerHTML = '';
    
    // Set up canvas for display
    canvas.style.width = '100%';  
    canvas.style.height = 'auto';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    
    previewContainer.appendChild(canvas);
}

// Create a detailed but compact receipt summary panel
function updateReceiptSummary() {
    const { subtotal, tax, tip, total, change } = calculateTotals();
    const receiptData = getReceiptData();
    
    receiptSummary.innerHTML = `
    <div class="summary-section">
        <div class="summary-row">
            <span>Items:</span> <span>${items.length}</span>
        </div>
        <div class="summary-row">
            <span>Server:</span> <span>${receiptData.serverName}</span>
        </div>
        <div class="summary-row">
            <span>Table:</span> <span>${receiptData.tableNumber}</span>
        </div>
    </div>
    <div class="summary-section">
        <div class="summary-row">
            <span>Subtotal:</span> <span>$${subtotal.toFixed(2)}</span>
        </div>
        <div class="summary-row">
            <span>Tax:</span> <span>$${tax.toFixed(2)}</span>
        </div>
        <div class="summary-row">
            <span>Tip:</span> <span>$${tip.toFixed(2)}</span>
        </div>
        <div class="summary-row summary-total">
            <span>Total:</span> <span>$${total.toFixed(2)}</span>
        </div>
    </div>
    <div class="summary-section">
        <div class="summary-row">
            <span>${receiptData.paymentMethod}:</span> <span>$${receiptData.amountPaid.toFixed(2)}</span>
        </div>
        <div class="summary-row">
            <span>Change:</span> <span>$${change.toFixed(2)}</span>
        </div>
    </div>`;
}

function resetForm() {
    // Confirm before resetting
    if (confirm('Reset all receipt data? This will clear all items and reset to default values.')) {
        items = [];
        
        // Reset to default values
        businessNameInput.value = 'MY RESTAURANT';
        businessAddressInput.value = '123 MAIN STREET\nCITY, STATE 12345';
        businessPhoneInput.value = '(555) 123-4567';
        tableNumberInput.value = '12';
        serverNameInput.value = 'ALICE';
        transactionNumberInput.value = '1234';
        taxRateInput.value = '8.25';
        tipAmountInput.value = '0.00';
        paymentMethodSelect.value = 'CREDIT';
        amountPaidInput.value = '0.00';
        footerMessageInput.value = 'THANK YOU FOR DINING WITH US\nPLEASE COME AGAIN\nWWW.MYRESTAURANT.COM';
        
        renderItemsList();
        updateReceiptView();
    }
}

// === Printing ===
async function printReceipt() {
    try {
        // Check if printer is connected
        if (!isPrinterConnected()) {
            logger.warn('Printer not connected');
            showPrintingStatus('Please connect to printer first', 'error');
            setTimeout(() => hidePrintingStatus(), 3000);
            return;
        }
        
        // Show printing status
        showPrintingStatus('Printing receipt...');
        
        // Log print job starting
        logger.info('Starting new print job');
        
        // Get receipt data and render to canvas
        const receiptData = getReceiptData();
        const canvas = await renderReceipt(receiptData, items);
        
        logger.info('Receipt rendered', {
            width: canvas.width,
            height: canvas.height,
            items: items.length
        });
        
        // Print the image
        await printImage(canvas);
        
        // Show success message
        showPrintingStatus('Receipt printed successfully!', 'success');
        setTimeout(() => hidePrintingStatus(), 3000);
    } catch (err) {
        console.error('Print error:', err);
        logger.error('Print error', { message: err.message });
        showPrintingStatus(`Error: ${err.message}`, 'error');
        setTimeout(() => hidePrintingStatus(), 5000);
    }
}

// === UI Feedback ===
function showPrintingStatus(message, type = 'info') {
    // Create status bar if it doesn't exist
    let statusBar = document.querySelector('.printing-status');
    
    if (!statusBar) {
        statusBar = document.createElement('div');
        statusBar.className = 'printing-status';
        document.body.appendChild(statusBar);
    }
    
    // Set color based on current mode and status type
    if (type === 'info') {
        statusBar.style.backgroundColor = currentMode === 'receipt' ? '#3182ce' : '#c53030';
    } else if (type === 'success') {
        statusBar.style.backgroundColor = '#2f855a';
    } else if (type === 'error') {
        statusBar.style.backgroundColor = '#c53030';
    }
    
    statusBar.textContent = message;
    statusBar.className = `printing-status ${type} active`;
}

function hidePrintingStatus() {
    const statusBar = document.querySelector('.printing-status');
    if (statusBar) {
        statusBar.classList.remove('active');
    }
}

// === Event Listeners ===
addItemBtn.addEventListener('click', addItem);
newItemNameInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
        addItem();
        newItemPriceInput.focus();
    }
});
newItemPriceInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') addItem();
});
printReceiptBtn.addEventListener('click', printReceipt);
resetBtn.addEventListener('click', resetForm);
amountPaidInput.addEventListener('input', calculateTotals);
tipAmountInput.addEventListener('input', calculateTotals);

// Initialize the app
init();