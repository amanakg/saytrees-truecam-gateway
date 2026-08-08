# Truecam Gateway

Truecam Gateway is a headless, scalable bridging solution that intercepts and converts proprietary Tuya Web SDK streams (via P2P WebSockets) into standard RTSP video feeds using FFmpeg.

## Architecture

1. **Node.js Worker (`worker.js`)**: Orchestrates the headless environment and multiplexes multiple camera connections.
2. **Playwright (Headless Chromium)**: Runs the official Tuya Web SDK in memory-optimized isolated contexts, authenticating devices and negotiating P2P tunnels.
3. **SQLite Database**: A local registry (`gateway/registry/truecam.db`) that stores camera metadata (UUIDs, Secrets, Product IDs). Newly added cameras in the Tuya app are automatically synced to this registry.
4. **FFmpeg Pipe**: The intercepted raw H265/H264 frames and AAC audio data are extracted directly from the WASM decoder memory and piped via `stdin` to FFmpeg.
5. **MediaMTX**: An ultra-low latency RTSP server that receives the video from FFmpeg and serves it to local clients/NVRs.

## Key Features

- **Headless Playwright Integration**: Runs completely headless without breaking the strict Tuya WASM encryption mechanisms.
- **Auto-Discovery & Self-Healing**: Automatically discovers new cameras added to the Tuya app, saves their `productId`, and initiates streams. If a camera falls out of sync, the system self-heals it.
- **Proactive Refresh Mechanism**: Forces a graceful SDK state refresh every 8.5 minutes to prevent Tuya's strict 10-minute P2P connection timeout, ensuring 24/7 stream stability.
- **Auto-Dependency Installation**: Installing packages (`npm install`) automatically fetches the required Chromium binary dependencies.

## Deployment

To deploy this project to a fresh VPS or server, refer to the step-by-step deployment guide:
👉 **[VPS Deployment Guide](VPS_DEPLOYMENT_GUIDE.md)**
