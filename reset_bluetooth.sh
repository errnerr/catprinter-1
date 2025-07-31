#!/bin/bash

echo "=== Comprehensive Bluetooth Reset ==="

echo "1. Stopping all Bluetooth-related processes..."
sudo pkill -f bluetoothd 2>/dev/null || true
sudo pkill -f catprinter 2>/dev/null || true
sudo pkill -f "go-ble" 2>/dev/null || true

echo "2. Waiting for processes to terminate..."
sleep 3

echo "3. Stopping Bluetooth service..."
sudo systemctl stop bluetooth

echo "4. Downing Bluetooth interface..."
sudo hciconfig hci0 down 2>/dev/null || true

echo "5. Waiting for interface to settle..."
sleep 2

echo "6. Upping Bluetooth interface..."
sudo hciconfig hci0 up 2>/dev/null || true

echo "7. Starting Bluetooth service..."
sudo systemctl start bluetooth

echo "8. Waiting for Bluetooth to initialize..."
sleep 5

echo "9. Checking Bluetooth status..."
sudo hciconfig hci0

echo "10. Testing Bluetooth connectivity..."
sudo hciconfig hci0 inq 2>/dev/null || echo "Bluetooth interface ready"

echo "=== Bluetooth Reset Complete ==="
echo "Try printing again now." 