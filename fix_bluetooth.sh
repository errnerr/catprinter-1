#!/bin/bash

echo "=== Fixing Bluetooth Issues ==="

echo "1. Killing any existing catprinter processes..."
pkill -f catprinter 2>/dev/null || true

echo "2. Waiting for processes to terminate..."
sleep 2

echo "3. Restarting Bluetooth service..."
sudo systemctl restart bluetooth

echo "4. Waiting for Bluetooth to initialize..."
sleep 5

echo "5. Checking Bluetooth status..."
sudo hciconfig hci0

echo "=== Bluetooth Fix Complete ==="
echo "Try printing again now." 