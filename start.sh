#!/bin/sh

echo "Starting Braveheart services..."

# Start tracker in background
echo "Starting tracker..."
node tracker.js &
TRACKER_PID=$!

# Wait a moment for tracker to initialize
sleep 2

# Start server in background
echo "Starting server..."
node server.js &
SERVER_PID=$!

# Health check loop
echo "Health checks enabled..."
while true; do
    sleep 30
    
    # Check if tracker is still running
    if ! kill -0 $TRACKER_PID 2>/dev/null; then
        echo "ERROR: Tracker process died! Restarting..."
        node tracker.js &
        TRACKER_PID=$!
    fi
    
    # Check if server is still running
    if ! kill -0 $SERVER_PID 2>/dev/null; then
        echo "ERROR: Server process died! Restarting..."
        node server.js &
        SERVER_PID=$!
    fi
done