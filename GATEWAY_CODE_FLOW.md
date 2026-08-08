# TrueCam Gateway Architecture & Code Walkthrough

This document explains the end-to-end architecture of how live footage from the physical cameras makes its way to the custom dashboard, with references to the exact files and functions that power each step.

## System Diagram

```mermaid
flowchart TD
    subgraph "TrueCam Ecosystem"
        Cam["Physical Camera"] -->|"Proprietary Protocol"| Cloud["TrueCam Cloud Servers"]
    end

    subgraph "Your VPS (Gateway Server)"
        Cloud -->|"Video Chunks"| Browser["Headless Chrome (Playwright)"]
        
        Browser -->|"WebSocket"| Worker["Node.js worker.js"]
        
        Worker -->|"Stdin"| FFmpeg["FFmpeg Process"]
        
        FFmpeg -->|"RTSP Push"| MediaMTX["MediaMTX Server"]
    end

    subgraph "End User"
        MediaMTX -->|"WHEP (WebRTC)"| UI["Custom Dashboard UI"]
    end
```

## Step 1: Physical Camera to TrueCam Cloud
**Scope:** Outside of our system

When the physical camera is turned on, it doesn't stream directly to the VPS. Instead, it securely connects to TrueCam's proprietary cloud servers and streams the live video data there using its internal firmware. We have no direct access to this connection.

## Step 2: The Headless Browser (Playwright)
**File:** `gateway/worker.js`  
**Function:** `AccountPage.initPageForDevice()`

To access the proprietary video stream without an official API, the VPS runs a background script called `worker.js`. 
- `worker.js` creates an `AccountPage` instance for each TrueCam account email.
- It launches a high-performance Google Chrome instance using **Playwright Chromium** (`chromium.launch({ headless: true })`) and navigates to the local SDK host (`http://localhost:8000/`).
- Using injected JavaScript (`page.evaluate`), it automatically logs into the TrueCam account by filling in the username and password fields.

## Step 3: Intercepting the Frames (The "Monkey Patch")
**File:** `gateway/worker.js`  
**Function:** `AccountPage.initPage()` (The Interceptor Injection)

Because TrueCam does not provide an RTSP stream natively, we have to extract the video manually. We do this by "monkey patching" the official TrueCam Web SDK (WASM module).
- We overwrite the SDK's internal drawing function: `window.ConnectApi.onrecvframeex`.
- When a raw H.264 or H.265 video chunk arrives from the cloud, our custom function intercepts it *before* it is drawn to the screen.
- It copies the raw frame data and sends it over a local WebSocket to our Node.js backend.
- Finally, it calls the original drawing function so the SDK thinks everything is normal and doesn't crash.

## Step 4: Routing Frames to Node.js
**File:** `gateway/worker.js`  
**Function:** `CameraBridge.setupWebSocketServer()` & `CameraBridge.connectCameraInPage()`

- **The Sender:** In `connectCameraInPage()`, a WebSocket is opened inside the hidden browser (`ws = new WebSocket(...)`). This is the channel the interceptor uses to send the stolen frames back home.
- **The Receiver:** In Node.js, `setupWebSocketServer()` spins up a local WebSocket listener. It acts as the catcher's mitt for every single incoming frame (`socket.on('message')`).

## Step 5: FFmpeg Creates the RTSP Stream
**File:** `gateway/worker.js`  
**Function:** `CameraBridge.startFfmpeg()`

Once Node.js receives the raw frames, they are immediately piped into FFmpeg.
- `startFfmpeg()` spawns an OS-level `ffmpeg` process with flags like `-c:v copy` to ensure the frames are repackaged into an RTSP stream without heavy CPU-intensive re-encoding.
- Node.js constantly writes the incoming WebSocket messages directly into FFmpeg's standard input: `this.ffmpegProcess.stdin.write(message)`.
- FFmpeg packages the data and outputs an RTSP stream to a local URL (e.g., `rtsp://127.0.0.1:8554/live/devcamera1_hd`).

## Step 6: MediaMTX Receives the RTSP Stream
**File:** `gateway/mediamtx.yml`

FFmpeg pushes the RTSP stream to **MediaMTX**, an open-source media server running as a background service on the VPS. MediaMTX requires zero custom code; it acts purely as a fast multiplexer, instantly translating the incoming RTSP stream into modern formats like WebRTC.

## Step 7: Dashboard Watches via WebRTC (WHEP)
**Files:** `dashboard_main/index.html` & `dashboard_main/reader.js`

Instead of relying on clunky, high-latency RTSP players, the custom dashboard uses WebRTC for ultra-low latency.
- `index.html` constructs a WHEP URL pointing to MediaMTX's WebRTC port (e.g., `http://168.144.84.199:8889/live/devcamera1_hd/whep`).
- `reader.js` uses the `MediaMTXWebRTCReader` class to establish a standard `RTCPeerConnection` (the same underlying technology powering Zoom and Google Meet) via an HTTP POST request.
- The browser binds the incoming WebRTC video track directly to the HTML `<video>` element, providing near-instantaneous live playback.

---

## Resilience & Auto-Recovery
**Files:** `gateway/worker.js`, `sdk_dist/play.js`, and `dashboard_main/app.js`

Because the system relies on intercepting closed ecosystems and bypassing third-party limits, it has several highly-tuned self-healing mechanisms:

- **8.5-Minute Recurring Proactive Stream Refresh:** Tuya Cloud intentionally kills P2P streams after 10 minutes. To counter this, `worker.js` executes `scheduleProactiveRefresh()` every **8.5 minutes (8m 30s / 510,000ms)**. This pre-emptively renews the session token in the browser context while maintaining an active FFmpeg pipe, guaranteeing continuous 24/7 streaming without stream cuts or blackouts.
- **Tuya Web SDK Memory Leak Fixes:** The official Tuya SDK (`play.js`) has two major memory leaks:
  - **JS Leak:** It fails to garbage collect closed sessions (`sessionList`). We modified the SDK to bypass object creation if the session already exists, and we forcefully delete Chromium's cache (`/tmp/playwright_cache_worker_*`) on worker boot to ensure the patched SDK is always loaded.
  - **WASM Leak (`Error code:-15`):** Even with the JS array fixed, Tuya's proprietary C++ WASM binary slowly leaks internal connection objects every time a stream recovers. Once it hits its hardcoded array limit (~128 connections, which takes about 21 hours of continuous uptime), it throws `Error code:-15`. Our interceptor instantly detects this and triggers a graceful worker reboot (`process.exit(1)`). This perfectly clears the C++ memory heap, causing only a tiny 6-second stream pause once a day!
- **Graceful Error Handling (`Error code:-13`):** If a camera goes offline or its tokens rotate, the worker simply logs a warning and allows the 10-second watchdog to infinitely retry the connection in the background. This ensures that a single offline camera will never crash the shared worker, allowing healthy cameras to continue streaming flawlessly.
- **Seamless Frontend Swapping:** On the dashboard (`app.js`), if MediaMTX detects a stream drop, the UI does not just go black. Instead, it creates a *hidden* secondary video player (`newVideo`). It repeatedly tries to reconnect in the background. Once the stream is successfully recovered and the new video element fires `timeupdate` (proving a frame was rendered), the UI instantly swaps the hidden player to the front and destroys the old one, resulting in a completely seamless recovery experience.
