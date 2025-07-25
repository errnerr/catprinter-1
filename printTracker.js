const fs = require('fs');
const path = require('path');

const TRACKER_FILE = path.join(__dirname, 'print-tracker.json');

function getCurrentDate() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD format
}

function shouldPrintDate() {
  try {
    console.log('Checking print date tracker...');
    console.log('Tracker file path:', TRACKER_FILE);
    
    if (!fs.existsSync(TRACKER_FILE)) {
      // First time ever - create file and return true
      const currentDate = getCurrentDate();
      console.log('Tracker file does not exist, creating with date:', currentDate);
      fs.writeFileSync(TRACKER_FILE, JSON.stringify({ lastPrintDate: currentDate }));
      return true;
    }
    
    const data = JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
    const currentDate = getCurrentDate();
    console.log('Last print date:', data.lastPrintDate);
    console.log('Current date:', currentDate);
    
    if (data.lastPrintDate !== currentDate) {
      // Different day - update and return true
      console.log('Different day detected, updating tracker');
      fs.writeFileSync(TRACKER_FILE, JSON.stringify({ lastPrintDate: currentDate }));
      return true;
    }
    
    // Same day - return false
    console.log('Same day, not printing date');
    return false;
  } catch (error) {
    console.error('Error checking print date:', error);
    return false; // Default to not printing date on error
  }
}

module.exports = { shouldPrintDate }; 