# System Architecture & 8.5-Minute Refresh — Code Line Mapping Guide

This document maps every single step of the **TrueView Cloud to WebRTC Architecture** and the **8.5-Minute Proactive Refresh Mechanism** directly to the exact file paths and line numbers in the codebase.

---

## 🏛 Part 1: TrueView Cloud to WebRTC Streaming Architecture

| Step # | Architecture Step | File Path | Exact Line Numbers | Code Symbol / Method |
| :---: | :--- | :--- | :--- | :--- |
| **1** | **worker.js starts Headless Chrome** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L1035–L1085](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L1035-L1085) | `chromium.launch({ headless: true })` |
| **2** | **TrueView SDK Loads** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) <br> [`sdk_dist/`](file:///d:/Projects/truecam(main)/truecam/truecam/sdk_dist/) | [L264](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L264) <br> `sdk_dist/*` | `page.goto('http://localhost:8000/')`<br>`play.js`, `connector.js`, `mqtt.js` |
| **3** | **Authentication & Device List** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L267–L355](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L267-L355) | `page.evaluate()` login click & token check |
| **4** | **P2P Camera Connection** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L802–L950](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L802-L950) | `window.ConnectApi.ConnectDevice(uuid, secret)` |
| **5** | **Video Packets Ingestion** | UDP P2P Network | Encrypted P2P | H.264/H.265 frames from 4G Camera |
| **6** | **`onrecvframeex()` Callback** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) <br> [`sdk_dist/play.js`](file:///d:/Projects/truecam(main)/truecam/truecam/sdk_dist/play.js) | [L328](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L328) | `window.ConnectApi.onrecvframeex` |
| **7** | **Monkey Patch Interceptor** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L325–L350](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L325-L350) | Interceptor wrapper in `page.evaluate()` |
| **8** | **WebSocket Packet Dispatch** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L339](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L339) | `ws.send(data)` to `ws://localhost:8080` |
| **9** | **worker.js Receives Packets** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L498–L550](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L498-L550) | `socket.on('message', message => ...)` |
| **10** | **Send Packets to FFmpeg** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L545](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L545) | `this.ffmpegProcess.stdin.write(message)` |
| **11** | **FFmpeg Creates RTSP Stream** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L580–L610](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L580-L610) | `spawn(ffmpegPath, ffmpegArgs)` (`-c:v copy`) |
| **12** | **MediaMTX Ingests RTSP** | [`gateway/mediamtx.yml`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/mediamtx.yml) | Port `8554` | RTSP Server listener (`rtsp://127.0.0.1:8554/`) |
| **13** | **WebRTC / WHEP Conversion** | [`gateway/mediamtx.yml`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/mediamtx.yml) | Port `8889` | WHEP HTTP WebRTC Multiplexer |
| **14** | **server.js Discovery API** | [`gateway/api/server.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/api/server.js) | [L58–L87](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/api/server.js#L58-L87) | `GET /api/clients/:clientId/cameras` |
| **15** | **reader.js WHEP Handshake** | [`dashboard_main/reader.js`](file:///d:/Projects/truecam(main)/truecam/truecam/dashboard_main/reader.js) | [L75–L120](file:///d:/Projects/truecam(main)/truecam/truecam/dashboard_main/reader.js#L75-L120) | `MediaMTXWebRTCReader.connect()` |
| **16** | **Browser Displays Video** | [`dashboard_main/reader.js`](file:///d:/Projects/truecam(main)/truecam/truecam/dashboard_main/reader.js) | [L60–L70](file:///d:/Projects/truecam(main)/truecam/truecam/dashboard_main/reader.js#L60-L70) | `this.peerConnection.ontrack` -> `<video>` |

---

## ⏱ Part 2: TrueCam Gateway — 8.5-Minute Proactive Stream Refresh

| Feature / Component | File Path | Exact Line Numbers | Code Snippet / Detail |
| :--- | :--- | :--- | :--- |
| **Proactive Timer Setup** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L560–L572](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L560-L572) | `scheduleProactiveRefresh()` (`510,000ms`) |
| **In-Page Re-connection** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L802–L950](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L802-L950) | `connectCameraInPage()` executing `ConnectDevice()` |
| **Fallback Error Handling** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L567–L570](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L567-L570) | `catch (err) { this.triggerReconnect(); }` |
| **Emergency Watchdog (Safety Net)** | [`gateway/worker.js`](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js) | [L485–L497](file:///d:/Projects/truecam(main)/truecam/truecam/gateway/worker.js#L485-L497) | `setInterval` checking `idleTime > 15000` |

---

## 📜 Code Highlights

### 1. The 8.5-Minute Refresh Code Block ([worker.js: L511–L520](file:///d:/enarxi/Cam/truecam/gateway/worker.js#L511-L520))
```javascript
if (this.refreshTimer) clearTimeout(this.refreshTimer);

this.refreshTimer = setTimeout(async () => {
  this.log(`Proactive 8.5 min refresh triggered to avoid 10 min Tuya stream timeout. Executing seamless refresh...`);
  try {
    await this.connectCameraInPage();
  } catch (err) {
    this.error(`Seamless proactive refresh failed: ${err.message}. Fallback to standard reconnect...`);
    this.triggerReconnect();
  }
}, 8 * 60 * 1000 + 30 * 1000); // 8 minutes 30 seconds = 510,000ms
```

### 2. The Monkey Patch Code Block ([worker.js: L326–L349](file:///d:/enarxi/Cam/truecam/gateway/worker.js#L326-L349))
```javascript
const original = window.ConnectApi.onrecvframeex;
window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
  if (frametype === 1 || frametype === 2) {
    const ws = window.__wsConnections[api_conn.deviceid];
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (!ws.isInitSent) {
        ws.send(JSON.stringify({ type: 'init', enc: enc, width: width, height: height, fps: fps }));
        ws.isInitSent = true;
      }
      ws.send(data);
    }
  }
  original.apply(this, arguments);
};
```

### 3. FFmpeg Stdin Pipe & Zero-CPU Push ([worker.js: L547–L590](file:///d:/enarxi/Cam/truecam/gateway/worker.js#L547-L590))
```javascript
// Stdin write (L548):
this.ffmpegProcess.stdin.write(message);

// FFmpeg Spawn (L574-L590):
const ffmpegArgs = [
  '-fflags', '+genpts+discardcorrupt+nobuffer',
  '-use_wallclock_as_timestamps', '1',
  '-f', inputFormat,
  '-i', 'pipe:0',
  '-c:v', 'copy',
  '-f', 'rtsp',
  '-rtsp_transport', 'tcp',
  this.streamUrl
];
this.ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
```
