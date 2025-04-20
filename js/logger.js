// Printer Logger Module
const LOG_MAX_ENTRIES = 500;

class PrinterLogger {
  constructor() {
    this.logs = [];
    this.listeners = [];
    this.maxEntries = LOG_MAX_ENTRIES;
  }

  // Log a message with specified level
  log(level, message, data = null) {
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 9),
      timestamp: new Date(),
      level,
      message,
      data
    };

    this.logs.push(entry);
    
    // Trim logs if they exceed max length
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(-this.maxEntries);
    }
    
    // Notify listeners
    this.notifyListeners(entry);
    
    return entry;
  }

  // Helper methods for different log levels
  info(message, data = null) {
    return this.log('info', message, data);
  }

  success(message, data = null) {
    return this.log('success', message, data);
  }

  warn(message, data = null) {
    return this.log('warn', message, data);
  }

  error(message, data = null) {
    return this.log('error', message, data);
  }

  debug(message, data = null) {
    return this.log('debug', message, data);
  }

  data(message, data = null) {
    return this.log('data', message, data);
  }

  // Hex dump of binary data
  hexDump(message, buffer, bytesPerLine = 16) {
    if (!(buffer instanceof Uint8Array)) {
      buffer = new Uint8Array(buffer);
    }
    
    let lines = [];
    for (let i = 0; i < buffer.length; i += bytesPerLine) {
      const chunk = buffer.slice(i, i + bytesPerLine);
      const hex = Array.from(chunk)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      const ascii = Array.from(chunk)
        .map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
        .join('');
      
      lines.push(`${i.toString(16).padStart(4, '0')}: ${hex.padEnd(bytesPerLine * 3, ' ')} ${ascii}`);
    }
    
    this.data(message, lines.join('\n'));
  }

  // Set progress (0-100)
  setProgress(percentage) {
    this.notifyProgress(Math.min(100, Math.max(0, percentage)));
  }

  // Clear all logs
  clear() {
    this.logs = [];
    this.notifyListeners({ type: 'clear' });
  }

  // Add listener for log updates
  addListener(callback) {
    if (typeof callback === 'function' && !this.listeners.includes(callback)) {
      this.listeners.push(callback);
    }
    return () => this.removeListener(callback);
  }

  // Remove a listener
  removeListener(callback) {
    const index = this.listeners.indexOf(callback);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  // Notify all listeners of a new log entry
  notifyListeners(entry) {
    this.listeners.forEach(listener => {
      try {
        listener(entry);
      } catch (e) {
        console.error('Error in log listener:', e);
      }
    });
  }

  // Notify progress change
  notifyProgress(percentage) {
    this.listeners.forEach(listener => {
      try {
        listener({ type: 'progress', percentage });
      } catch (e) {
        console.error('Error in progress listener:', e);
      }
    });
  }

  // Get all logs
  getLogs() {
    return [...this.logs];
  }
}

// Create and export singleton instance
export const logger = new PrinterLogger();

// Format a log entry for display
export function formatLogEntry(entry) {
  // Format timestamp as HH:MM:SS.mmm
  const ts = entry.timestamp;
  const time = ts.toTimeString().split(' ')[0] + '.' + 
               ts.getMilliseconds().toString().padStart(3, '0');

  let content = '';
  
  if (entry.level === 'data' && entry.data) {
    content = `<div class="log-message log-${entry.level}">${entry.message}</div>
               <pre class="log-data">${entry.data}</pre>`;
  } else {
    content = `<div class="log-message log-${entry.level}">${entry.message}${
      entry.data ? ` - ${JSON.stringify(entry.data)}` : ''
    }</div>`;
  }
  
  return `<div class="log-entry" data-id="${entry.id}">
    <div class="log-time">${time}</div>
    ${content}
  </div>`;
}

// Connect the logger to the DOM
export function setupLoggerUI(logWrapperElement, progressBarElement) {
  if (!logWrapperElement) {
    throw new Error('Log wrapper element not found');
  }

  // Handler for new log entries
  logger.addListener(entry => {
    if (entry.type === 'clear') {
      logWrapperElement.innerHTML = '';
      return;
    }
    
    if (entry.type === 'progress' && progressBarElement) {
      progressBarElement.style.width = `${entry.percentage}%`;
      return;
    }
    
    // Skip if not a log entry
    if (!entry.timestamp) return;
    
    // Add new log entry to UI
    const html = formatLogEntry(entry);
    logWrapperElement.insertAdjacentHTML('beforeend', html);
    
    // Scroll to bottom
    logWrapperElement.scrollTop = logWrapperElement.scrollHeight;
  });

  // Return the connected logger instance
  return logger;
}