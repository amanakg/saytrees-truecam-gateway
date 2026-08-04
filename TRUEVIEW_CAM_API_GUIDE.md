# TrueView / TrueCam API Connection & Credentials Guide

This guide documents the API endpoints, streaming protocols, TrueView account credentials, and registered camera device details used to integrate and connect to live camera feeds.

---

## 1. TrueView Account Credentials & Device Registry

### Account Credentials
The Gateway service logs into the TrueView Cloud platform using these account credentials:

| Field | Value |
| :--- | :--- |
| **Account Email / Username** | `info@enarxi.com` |
| **Account Password** | `Camtest123@` |
| **Client ID** | `enarxi` |
| **Client API Key (`x-api-key`)** | `dummy_hash_for_testing` |

---

### Registered Camera Devices

#### Camera 1: Enarxi Cam 1
* **Device Nickname**: Enarxi Cam 1
* **Device UUID**: `367ABDWN1000346168`
* **Device Secret**: `08ce8ae8a9e468d2313c03c9e058a3c2`
* **Stream Name**: `devcamera1_hd`
* **Site Location**: Office Gate 1
* **WHEP WebRTC Stream URL**: `http://168.144.84.199:8889/live/devcamera1_hd/whep`
* **RTSP Stream URL**: `rtsp://168.144.84.199:8554/live/devcamera1_hd`

#### Camera 2: Enarxi Cam 2
* **Device Nickname**: Enarxi Cam 2
* **Device UUID**: `F14504WN1000345886`
* **Device Secret**: `1223093b8d7277ee7158841ae47d75a7`
* **Stream Name**: `devcamera2_hd`
* **Site Location**: Office Gate 2
* **WHEP WebRTC Stream URL**: `http://168.144.84.199:8889/live/devcamera2_hd/whep`
* **RTSP Stream URL**: `rtsp://168.144.84.199:8554/live/devcamera2_hd`

---

## 2. API Endpoints & Connectivity

### A. List Client Cameras & Metadata (REST API)

Returns all registered cameras for a tenant client, including current connection status, resolution, fps, codec, and WHEP stream URLs.

* **HTTP Method**: `GET`
* **Production Port**: `3000`
* **Testing Port**: `9001`
* **Endpoint Pattern**: `/api/clients/:clientId/cameras`
* **Full URL (Example)**: `http://168.144.84.199:3000/api/clients/enarxi/cameras`
* **Required Headers**: 
  * `x-api-key`: `dummy_hash_for_testing`
  * `Content-Type`: `application/json`

#### cURL Request Example:
```bash
curl -X GET "http://168.144.84.199:3000/api/clients/enarxi/cameras" \
     -H "x-api-key: dummy_hash_for_testing"
```

#### JavaScript `fetch()` Example:
```javascript
const response = await fetch('http://168.144.84.199:3000/api/clients/enarxi/cameras', {
  headers: {
    'x-api-key': 'dummy_hash_for_testing'
  }
});
const cameras = await response.json();
console.log(cameras);
```

#### Response Example:
```json
[
  {
    "id": "367ABDWN1000346168",
    "name": "Enarxi Cam 1",
    "streamName": "devcamera1_hd",
    "whepUrl": "http://168.144.84.199:8889/live/devcamera1_hd/whep",
    "status": "connected",
    "lastFrameAt": 1721824380,
    "metadata": {
      "codec": "h264",
      "resolution": "1920x1080",
      "fps": 25
    }
  },
  {
    "id": "F14504WN1000345886",
    "name": "Enarxi Cam 2",
    "streamName": "devcamera2_hd",
    "whepUrl": "http://168.144.84.199:8889/live/devcamera2_hd/whep",
    "status": "connected",
    "lastFrameAt": 1721824385,
    "metadata": {
      "codec": "h264",
      "resolution": "1920x1080",
      "fps": 25
    }
  }
]
```

---

### B. Live WebRTC Streaming Endpoint (WHEP)

Used by custom web dashboards and browser video players for real-time live playback.

* **HTTP Method**: `POST`
* **Port**: `8889` (MediaMTX WHEP WebRTC Port)
* **Endpoint Pattern**: `/live/:streamName/whep`
* **Full URL (Example)**: `http://168.144.84.199:8889/live/devcamera1_hd/whep`

#### HTML5 Video Player Integration (`MediaMTXWebRTCReader`):
```javascript
import { mountCameraPlayer } from './reader.js';

const videoElement = document.getElementById('myVideoElement');
const whepUrl = 'http://168.144.84.199:8889/live/devcamera1_hd/whep';

mountCameraPlayer(videoElement, whepUrl, {
  onLive: () => console.log('Stream is live!'),
  onError: (err) => console.error('Stream error:', err)
});
```

---

### C. RTSP Video Stream Endpoint

Used for raw media ingest, NVR recorders, OpenCV processing, or VLC playback.

* **Protocol**: RTSP over TCP
* **Port**: `8554` (MediaMTX RTSP Port)
* **URL Pattern**: `rtsp://<SERVER_IP>:8554/live/:streamName`
* **Examples**:
  * `rtsp://168.144.84.199:8554/live/devcamera1_hd`
  * `rtsp://168.144.84.199:8554/live/devcamera2_hd`

---

### D. Testing & Mock Camera Control Endpoints

Available on port `9001` to launch or stop simulated mock camera streams for testing load performance.

#### 1. Start Mock Cameras:
* **Endpoint**: `POST /api/test/mock_cameras`
* **URL**: `http://<SERVER_IP>:9001/api/test/mock_cameras`
* **Body**: `{"count": 5}`

#### 2. Stop Mock Cameras:
* **Endpoint**: `POST /api/test/stop_mock_cameras`
* **URL**: `http://<SERVER_IP>:9001/api/test/stop_mock_cameras`

---

## 3. Quick System Architecture Overview

```
 ┌──────────────────────┐
 │ Physical TrueCam     │
 └──────────┬───────────┘
            │ Proprietary Cloud P2P
 ┌──────────▼───────────┐
 │ TrueCam Cloud        │
 └──────────┬───────────┘
            │ Headless Puppeteer Login (info@enarxi.com / Camtest123@)
 ┌──────────▼───────────┐
 │ Gateway (worker.js)  ├──> Intercepts H.264/H.265 frames
 └──────────┬───────────┘
            │ Pipes to FFmpeg (-c:v copy)
 ┌──────────▼───────────┐
 │ MediaMTX Server      ├──> RTSP Stream (Port 8554)
 └──────────┬───────────┘
            │ WHEP Protocol
 ┌──────────▼───────────┐
 │ Frontend / API Client│<──> API Server (GET /api/clients/enarxi/cameras on Port 3000)
 └──────────────────────┘
```

---

## 4. Running the API Server & Gateway Services

To start the tenant API server and the gateway worker:

1. **Start the API Server**:
   ```bash
   cd gateway/api
   node server.js
   ```
   * Main API runs on `http://localhost:3000`
   * Testing API runs on `http://localhost:9001`

2. **Start the Gateway Worker**:
   ```bash
   cd gateway
   node worker.js
   ```

3. **Seed Database (if needed)**:
   ```bash
   cd gateway/registry
   node seed_from_existing.js
   ```
