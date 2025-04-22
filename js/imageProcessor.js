// Image processor for MXW01 printer
import { logger } from './logger.js';
import { PRINTER_WIDTH } from './printer.js';

// Image processing settings
let currentImage = null;
let imageProcessingSettings = {
    ditherMethod: 'floydSteinberg',
    threshold: 128,
    invert: false,
    width: PRINTER_WIDTH,
    autoscale: true,
    padding: 10,
    rotation: 0 // Rotation in degrees (0, 90, 180, 270)
};

// Cache for processed images to avoid re-processing when only preview needs updating
let processedImageCache = null;

// Load and prepare an image from a file or URL
export async function loadImage(fileOrUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            logger.info(`Image loaded: ${img.width}x${img.height}px`);
            currentImage = img;
            processedImageCache = null;
            resolve(img);
        };
        
        img.onerror = (err) => {
            logger.error('Failed to load image', { error: err.message });
            reject(new Error('Failed to load image'));
        };
        
        if (typeof fileOrUrl === 'string') {
            // Load from URL
            img.src = fileOrUrl;
        } else if (fileOrUrl instanceof File) {
            // Load from File object
            const reader = new FileReader();
            reader.onload = (e) => { img.src = e.target.result; };
            reader.onerror = (e) => { reject(new Error('Failed to read file')); };
            reader.readAsDataURL(fileOrUrl);
        } else {
            reject(new Error('Invalid input: expected File or URL string'));
        }
    });
}

// Update processing settings
export function updateSettings(settings) {
    const oldSettings = {...imageProcessingSettings};
    imageProcessingSettings = {...imageProcessingSettings, ...settings};
    
    // Check if any settings that affect the processing have changed
    const processingChanged = 
        oldSettings.ditherMethod !== imageProcessingSettings.ditherMethod ||
        oldSettings.threshold !== imageProcessingSettings.threshold ||
        oldSettings.invert !== imageProcessingSettings.invert ||
        oldSettings.rotation !== imageProcessingSettings.rotation;
    
    if (processingChanged) {
        processedImageCache = null;
    }
    
    logger.debug('Image processing settings updated', imageProcessingSettings);
    return imageProcessingSettings;
}

// Get current processing settings
export function getSettings() {
    return {...imageProcessingSettings};
}

// Process the image with current settings and return a canvas
export function processImage() {
    if (!currentImage) {
        logger.warn('No image loaded for processing');
        return null;
    }
    
    if (processedImageCache) {
        logger.debug('Using cached processed image');
        return processedImageCache;
    }
    
    logger.info('Processing image', imageProcessingSettings);
    
    // Create output canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // Calculate dimensions
    let destWidth = imageProcessingSettings.width;
    let destHeight;
    
    // Adjust dimensions based on rotation
    const rotation = imageProcessingSettings.rotation;
    const isRotated90or270 = (rotation === 90 || rotation === 270);
    
    if (imageProcessingSettings.autoscale) {
        // Scale maintaining aspect ratio, taking rotation into account
        const aspectRatio = isRotated90or270 ? 
            (currentImage.width / currentImage.height) : 
            (currentImage.height / currentImage.width);
        destHeight = Math.round(destWidth * aspectRatio);
    } else {
        // Use original dimensions but cap at printer width
        destWidth = Math.min(currentImage.width, PRINTER_WIDTH);
        destHeight = currentImage.height;
        
        // Swap dimensions if rotated by 90 or 270 degrees
        if (isRotated90or270) {
            [destWidth, destHeight] = [destHeight, destWidth];
            // Ensure we don't exceed printer width
            if (destWidth > PRINTER_WIDTH) {
                const scale = PRINTER_WIDTH / destWidth;
                destWidth = PRINTER_WIDTH;
                destHeight = Math.round(destHeight * scale);
            }
        }
    }
    
    // Add padding
    const padding = imageProcessingSettings.padding;
    
    // Set canvas dimensions based on rotation
    if (isRotated90or270) {
        canvas.width = destWidth;
        canvas.height = destHeight + (padding * 2);
    } else {
        canvas.width = destWidth;
        canvas.height = destHeight + (padding * 2);
    }
    
    // Draw with padding
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Apply rotation transformation
    ctx.save();
    
    // Move to the center of the image area
    ctx.translate(destWidth / 2, padding + destHeight / 2);
    
    // Rotate by the specified angle
    ctx.rotate((rotation * Math.PI) / 180);
    
    // Draw image centered, taking into account rotation
    if (isRotated90or270) {
        ctx.drawImage(
            currentImage,
            0, 0, currentImage.width, currentImage.height,
            -destHeight / 2, -destWidth / 2, destHeight, destWidth
        );
    } else {
        ctx.drawImage(
            currentImage,
            0, 0, currentImage.width, currentImage.height,
            -destWidth / 2, -destHeight / 2, destWidth, destHeight
        );
    }
    
    // Restore the context
    ctx.restore();
    
    // Apply image processing
    applyImageProcessing(canvas, imageProcessingSettings);
    
    // Cache for reuse
    processedImageCache = canvas;
    
    logger.info('Image processed', {
        width: canvas.width,
        height: canvas.height,
        method: imageProcessingSettings.ditherMethod,
        rotation: imageProcessingSettings.rotation
    });
    
    return canvas;
}

// Apply image processing effects to canvas
function applyImageProcessing(canvas, settings) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Convert to grayscale first
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Luminance formula
        let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Apply inversion if needed
        if (settings.invert) {
            luminance = 255 - luminance;
        }
        
        data[i] = data[i + 1] = data[i + 2] = luminance;
    }
    
    // Apply dithering or thresholding
    switch (settings.ditherMethod) {
        case 'threshold':
            applyThreshold(imageData, settings.threshold);
            break;
        case 'floydSteinberg':
            applyFloydSteinberg(imageData, settings.threshold);
            break;
        case 'atkinson':
            applyAtkinson(imageData, settings.threshold);
            break;
        case 'halftone':
            applyHalftone(imageData, settings.threshold);
            break;
        case 'none':
            // Just use the grayscale
            break;
        default:
            applyThreshold(imageData, settings.threshold);
    }
    
    ctx.putImageData(imageData, 0, 0);
}

// Simple threshold
function applyThreshold(imageData, threshold) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const v = data[i] < threshold ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
    }
}

// Floyd-Steinberg dithering
function applyFloydSteinberg(imageData, threshold) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const luminance = new Array(width * height);
    
    // Extract luminance
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const idx = (i * width + j) * 4;
            luminance[i * width + j] = data[idx];
        }
    }
    
    // Apply Floyd-Steinberg dithering
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const idx = i * width + j;
            const oldPixel = luminance[idx];
            const newPixel = oldPixel < threshold ? 0 : 255;
            luminance[idx] = newPixel;
            
            const error = oldPixel - newPixel;
            
            if (j + 1 < width) {
                luminance[idx + 1] += error * 7 / 16;
            }
            if (i + 1 < height) {
                if (j - 1 >= 0) {
                    luminance[(i + 1) * width + j - 1] += error * 3 / 16;
                }
                luminance[(i + 1) * width + j] += error * 5 / 16;
                if (j + 1 < width) {
                    luminance[(i + 1) * width + j + 1] += error * 1 / 16;
                }
            }
        }
    }
    
    // Apply result back to image data
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const idx = (i * width + j) * 4;
            const v = luminance[i * width + j];
            data[idx] = data[idx + 1] = data[idx + 2] = v;
        }
    }
}

// Atkinson dithering
function applyAtkinson(imageData, threshold) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const luminance = new Array(width * height);
    
    // Extract luminance
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const idx = (i * width + j) * 4;
            luminance[i * width + j] = data[idx];
        }
    }
    
    // Apply Atkinson dithering
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const idx = i * width + j;
            const oldPixel = luminance[idx];
            const newPixel = oldPixel < threshold ? 0 : 255;
            luminance[idx] = newPixel;
            
            const error = Math.floor((oldPixel - newPixel) / 8);
            
            if (j + 1 < width) luminance[idx + 1] += error;
            if (j + 2 < width) luminance[idx + 2] += error;
            
            if (i + 1 < height) {
                if (j - 1 >= 0) luminance[(i + 1) * width + j - 1] += error;
                luminance[(i + 1) * width + j] += error;
                if (j + 1 < width) luminance[(i + 1) * width + j + 1] += error;
            }
            
            if (i + 2 < height) {
                luminance[(i + 2) * width + j] += error;
            }
        }
    }
    
    // Apply result back to image data
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const idx = (i * width + j) * 4;
            const v = luminance[i * width + j];
            data[idx] = data[idx + 1] = data[idx + 2] = v;
        }
    }
}

// Halftone dithering using a 4x4 Bayer matrix
function applyHalftone(imageData, threshold) {
    const width = imageData.width;
    const data = imageData.data;
    
    // 4x4 Bayer matrix
    const bayerMatrix = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5]
    ];
    
    // Normalize matrix (0-255)
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            bayerMatrix[i][j] = Math.floor(bayerMatrix[i][j] * 255 / 16);
        }
    }
    
    for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const i = y % 4;
            const j = x % 4;
            
            // Apply threshold with Bayer matrix
            const threshold = bayerMatrix[i][j];
            data[idx] = data[idx + 1] = data[idx + 2] = (data[idx] < threshold) ? 0 : 255;
        }
    }
}

// Generate image summary information
export function getImageSummary() {
    if (!currentImage) return null;
    
    const canvas = processImage();
    if (!canvas) return null;
    
    return {
        originalWidth: currentImage.width,
        originalHeight: currentImage.height,
        processedWidth: canvas.width,
        processedHeight: canvas.height,
        aspectRatio: (currentImage.width / currentImage.height).toFixed(2),
        ditherMethod: imageProcessingSettings.ditherMethod,
        threshold: imageProcessingSettings.threshold,
        invert: imageProcessingSettings.invert,
        rotation: imageProcessingSettings.rotation
    };
}

// Reset to default settings
export function resetSettings() {
    imageProcessingSettings = {
        ditherMethod: 'floydSteinberg',
        threshold: 128,
        invert: false,
        width: PRINTER_WIDTH,
        autoscale: true,
        padding: 10,
        rotation: 0
    };
    processedImageCache = null;
    return {...imageProcessingSettings};
}

// Clear loaded image
export function clearImage() {
    currentImage = null;
    processedImageCache = null;
}