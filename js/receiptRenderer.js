import { PRINTER_WIDTH } from './printer.js';

// Define character width constants
const RECEIPT_WIDTH_CHARS = 40; // Fixed receipt width in characters

/**
 * Formats the receipt lines and renders them to a canvas
 * @param {Object} receiptData - The receipt configuration data
 * @param {Array} items - Array of item objects with name and price
 * @param {number} fontSize - Font size to use
 * @param {number} lineHeight - Line height
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderReceipt(receiptData, items, fontSize = 18, lineHeight = 22) {
    // Generate receipt text lines
    const lines = generateReceiptText(receiptData, items);
    
    // Render to canvas
    const canvas = await renderToCanvas(lines, fontSize, lineHeight);
    return canvas;
}

/**
 * Formats a number as currency
 * @param {number} amount - The amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    return amount.toFixed(2);
}

/**
 * Centers text in a fixed width
 * @param {string} text - The text to center
 * @param {number} width - The width in characters
 * @returns {string} Centered text
 */
function centerText(text, width = RECEIPT_WIDTH_CHARS) {
    const padding = Math.max(0, width - text.length) / 2;
    return ' '.repeat(Math.floor(padding)) + text;
}

/**
 * Right-aligns text in a fixed width
 * @param {string} text - The text to right-align
 * @param {number} width - The width in characters
 * @returns {string} Right-aligned text
 */
function rightAlign(text, width = RECEIPT_WIDTH_CHARS) {
    const padding = Math.max(0, width - text.length);
    return ' '.repeat(padding) + text;
}

/**
 * Creates a line with label on left and value on right
 * @param {string} label - The label text
 * @param {string|number} value - The value to display
 * @returns {string} Formatted line
 */
function createLabelValueLine(label, value, width = RECEIPT_WIDTH_CHARS) {
    const valueStr = typeof value === 'number' ? `$${formatCurrency(value)}` : value;
    const spaces = width - label.length - valueStr.length;
    return label + ' '.repeat(Math.max(1, spaces)) + valueStr;
}

/**
 * Generates formatted lines for the receipt
 * @param {Object} data - Receipt configuration data
 * @param {Array} items - Line items
 * @returns {Array} Array of text lines
 */
function generateReceiptText(data, items) {
    const lines = [];
    const divider = '-'.repeat(RECEIPT_WIDTH_CHARS);
    
    // Header - centered
    lines.push(centerText(data.businessName));
    const addressLines = data.businessAddress.split('\n');
    addressLines.forEach(line => lines.push(centerText(line)));
    lines.push(centerText(data.businessPhone));
    lines.push('');
    
    // Transaction info - left aligned
    lines.push(`DATE: ${data.dateTime}`);
    lines.push(`ORDER #: ${data.transactionNumber}`);
    lines.push(`TABLE: ${data.tableNumber}    SERVER: ${data.serverName}`);
    lines.push(divider);
    
    // Items
    if (items && items.length > 0) {
        items.forEach(item => {
            if (!item.name || item.price == null) return;
            
            const name = item.name.trim();
            const price = parseFloat(item.price);
            
            // Use label-value alignment for consistent positioning
            lines.push(createLabelValueLine(name, price));
        });
    } else {
        lines.push("NO ITEMS");
    }
    
    lines.push(divider);
    
    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + parseFloat(item.price || 0), 0);
    const tax = subtotal * (data.taxRate / 100);
    const tip = parseFloat(data.tipAmount) || 0;
    const total = subtotal + tax + tip;
    
    // Format totals with exact right alignment
    lines.push(createLabelValueLine("SUBTOTAL:", subtotal));
    lines.push(createLabelValueLine(`TAX (${data.taxRate}%):`, tax));
    lines.push(createLabelValueLine("TIP:", tip));
    lines.push(divider);
    lines.push(createLabelValueLine("TOTAL:", total));
    lines.push('');
    
    // Payment section with proper alignment
    lines.push(`PAYMENT: ${data.paymentMethod}`);
    lines.push(createLabelValueLine("AMOUNT PAID:", data.amountPaid));
    
    const change = Math.max(0, data.amountPaid - total);
    lines.push(createLabelValueLine("CHANGE:", change));
    lines.push(divider);
    
    // Footer message - centered
    const footerLines = data.footerMessage.split('\n');
    footerLines.forEach(line => lines.push(centerText(line)));
    
    return lines;
}

/**
 * Renders text lines to a canvas using the dot matrix font
 * @param {Array} lines - Text lines
 * @param {number} fontSize - Font size in pixels
 * @param {number} lineHeight - Line height in pixels
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderToCanvas(lines, fontSize, lineHeight) {
    // Make sure font is loaded
    await document.fonts.load(`${fontSize}px DotMatrix`);
    
    // Create canvas with exact printer width
    const width = PRINTER_WIDTH;
    const height = lines.length * lineHeight + 20; // Add more margin to avoid content being cut off
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    
    // Fill background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    
    // Set text properties
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.font = `${fontSize}px DotMatrix`;
    
    // Calculate character width for alignment
    const charWidth = ctx.measureText('M').width;
    
    // Draw each line
    let y = 10; // Increased top margin
    
    for (const line of lines) {
        // Choose alignment based on content
        if (line.trim().startsWith('-'.repeat(5))) {
            // Divider line
            ctx.textAlign = 'left';
            ctx.fillText(line, 0, y);
        }
        else if (isHeader(line, lines) || isFooter(line, lines)) {
            // Header or footer - center align
            ctx.textAlign = 'center';
            ctx.fillText(line.trim(), width / 2, y);
        }
        else if (line.includes('$')) {
            // This is a line with a price - draw with precise positioning
            const dollarIndex = line.indexOf('$');
            const leftPart = line.substring(0, dollarIndex).trimEnd();
            const rightPart = line.substring(dollarIndex);
            
            // Draw left part aligned left
            ctx.textAlign = 'left';
            ctx.fillText(leftPart, 0, y);
            
            // Draw right part (price) aligned right
            ctx.textAlign = 'right';
            ctx.fillText(rightPart, width - 5, y);
        }
        else {
            // Regular line - left align
            ctx.textAlign = 'left';
            ctx.fillText(line, 0, y);
        }
        
        y += lineHeight;
    }
    
    return canvas;
}

/**
 * Helper to determine if line is part of header
 */
function isHeader(line, lines) {
    // First few lines are typically header
    const index = lines.indexOf(line);
    return index < 4;
}

/**
 * Helper to determine if line is part of footer
 */
function isFooter(line, lines) {
    // Look for the last divider
    const lastDividerIndex = lines.findLastIndex(l => l.startsWith('-'.repeat(5)));
    const index = lines.indexOf(line);
    return index > lastDividerIndex && !line.includes('$');
}

/**
 * Renders a text receipt to an HTML element
 * @param {Object} receiptData - Receipt data
 * @param {Array} items - Line items
 * @param {HTMLElement} container - Container element
 */
export function updateReceiptPreview(receiptData, items, container) {
    const lines = generateReceiptText(receiptData, items);
    
    // Clear container
    container.innerHTML = '';
    
    // Create a styled pre element for monospace rendering
    const preElement = document.createElement('pre');
    preElement.style.fontFamily = 'DotMatrix, monospace';
    preElement.style.margin = '0';
    preElement.style.padding = '10px 0';
    preElement.style.whiteSpace = 'pre';
    preElement.style.fontSize = '16px';
    preElement.style.width = '100%';
    preElement.style.textAlign = 'left';
    
    // Add each line to the pre element
    for (const line of lines) {
        preElement.appendChild(document.createTextNode(line + '\n'));
    }
    
    // Create a wrapper div to handle scrolling if needed
    const wrapperDiv = document.createElement('div');
    wrapperDiv.style.width = '100%';
    wrapperDiv.style.overflowX = 'auto';
    
    // Add the pre element to the wrapper
    wrapperDiv.appendChild(preElement);
    
    // Add the wrapper to the container
    container.appendChild(wrapperDiv);
}