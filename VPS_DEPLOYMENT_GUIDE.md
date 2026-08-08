# Truecam Gateway: VPS Deployment Guide

This guide covers the end-to-end process of installing and deploying the Truecam Gateway on a fresh Linux VPS (Ubuntu/Debian).

## 1. System Prerequisites

Install the required system dependencies: Node.js (v18+), FFmpeg, and Git.

```bash
# Update package list
sudo apt update && sudo apt upgrade -y

# Install FFmpeg and Git
sudo apt install -y ffmpeg git curl

# Install Node.js (v20 LTS recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
node -v
npm -v
ffmpeg -version
```

## 2. MediaMTX (RTSP Server) Setup

MediaMTX acts as the local RTSP server that the Gateway pipes its frames into.

```bash
# Download the latest MediaMTX release (adjust version/arch as needed)
cd /opt
sudo wget https://github.com/bluenviron/mediamtx/releases/download/v1.6.0/mediamtx_v1.6.0_linux_amd64.tar.gz

# Extract and clean up
sudo mkdir mediamtx
sudo tar -xvzf mediamtx_v1.6.0_linux_amd64.tar.gz -C mediamtx/
sudo rm mediamtx_v1.6.0_linux_amd64.tar.gz

# Start MediaMTX in the background (or optionally configure it as a systemd service)
cd /opt/mediamtx
nohup ./mediamtx > mediamtx.log 2>&1 &
```

## 3. Clone and Setup Truecam Gateway

```bash
# Create installation directory
sudo mkdir -p /opt/truecam
sudo chown -R $USER:$USER /opt/truecam
cd /opt/truecam

# Clone the repository
git clone git@github.com:Enarxi-Innovations-Private-Limited/truecam.git .

# Move to the gateway directory
cd gateway

# Install Node dependencies (this automatically triggers Playwright Chromium installation)
npm install
```

*Note: If Chromium fails to install via NPM, you can run `npx playwright install chromium` manually.*

## 4. Install Systemd Service for the Worker

Running the worker as a Systemd service ensures it starts on boot and restarts automatically if it crashes.

1. Create a new service file:
```bash
sudo nano /etc/systemd/system/truecam-worker@.service
```

2. Paste the following configuration:
```ini
[Unit]
Description=Truecam H5SDK Stream Worker Pool - Worker %i
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/truecam/gateway
Environment="NODE_ENV=production"
Environment="WORKER_ID=worker%i"
ExecStart=/usr/bin/node worker.js
Restart=always
RestartSec=10
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

3. Save and close the file (`Ctrl+O`, `Enter`, `Ctrl+X`).

## 5. Enable and Start the Worker

Reload systemd daemon, enable the service to start on boot, and start Worker 1.

```bash
# Reload daemon to recognize the new service
sudo systemctl daemon-reload

# Enable to start on boot
sudo systemctl enable truecam-worker@1.service

# Start the worker
sudo systemctl start truecam-worker@1.service

# Check live logs
journalctl -u truecam-worker@1.service -f --no-pager
```

## 6. Accessing the Streams

Once the worker successfully connects to the cameras and pipes data to FFmpeg, the streams will be available on your local MediaMTX server.

If your camera has a UUID like `367ABDWN1000346168`, the stream will typically be exposed as:
```text
rtsp://<vps-ip>:8554/live/cam_346168
```
*(The last 6 characters of the UUID are used to generate the stream name)*

## Troubleshooting

- **No cameras found in logs:** 
  The system pulls cameras automatically from your Tuya account. Ensure the camera is registered on the Tuya app under the account mapped in the gateway.
- **Camera is stuck "reconnecting":**
  This usually means the camera is physically powered off or offline from Wi-Fi. The Truecam Gateway will gracefully retry in the background indefinitely.
- **Stream is lagging or corrupt:**
  Ensure you have adequate VPS CPU resources. Running Playwright, WASM decoders, and FFmpeg simultaneously for multiple cameras requires a decently powered server (recommended minimum: 2 vCores, 4GB RAM).
