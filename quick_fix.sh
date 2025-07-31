#!/bin/bash

echo "Quick Bluetooth Fix..."

# Kill any hanging processes
sudo pkill -f catprinter 2>/dev/null || true

# Restart Bluetooth service
sudo systemctl restart bluetooth

# Wait a moment
sleep 3

echo "Done! Try printing again." 