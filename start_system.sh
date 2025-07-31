#!/bin/bash

echo "=== Starting Cat Printer System ==="

# Kill any existing processes
pkill -f catprinter_daemon 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true

# Wait for processes to terminate
sleep 2

# Set capabilities for the daemon
sudo setcap 'cap_net_raw,cap_net_admin+eip' ./catprinter_daemon

# Start the daemon in the background
echo "Starting printer daemon..."
./catprinter_daemon 48:0F:57:12:30:9D &
DAEMON_PID=$!

# Wait for daemon to start
sleep 3

# Start the web server
echo "Starting web server..."
node server.js &
SERVER_PID=$!

echo "System started!"
echo "Daemon PID: $DAEMON_PID"
echo "Server PID: $SERVER_PID"
echo "Web interface: http://localhost:3000"
echo "Daemon API: http://localhost:8080"

# Wait for either process to exit
wait $DAEMON_PID $SERVER_PID

echo "System stopped." 