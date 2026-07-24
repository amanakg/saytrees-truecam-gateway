# Why We Set an 8.5-Minute (8:30) Proactive Stream Refresh Timer

This document explains the technical rationale, architectural necessity, and implementation details behind the **8.5-minute (8 minutes 30 seconds)** proactive stream refresh mechanism in the TrueCam Gateway.

---

## 1. The Core Problem: Tuya Cloud's Hard 10-Minute Timeout

Physical cellular / 4G cameras stream live video via **Tuya Cloud / TrueView P2P servers**. To prevent excessive bandwidth consumption and server overload, Tuya Cloud enforces a **hardcoded 10-minute session limit** on all live P2P video streams.

### What Happens Without an 8.5-Minute Refresh?

```
 0:00 min                   8:30 min                   10:00 min
 ┌─────────────────────────────┬───────────────────────────┐
 │ Stream Active (Normal)      │ Stream Running            │ 💥 Tuya Cloud kills P2P stream!
 └─────────────────────────────┴───────────────────────────┘
                                                           │
                                                           ▼ (10s - 20s Inactivity Watchdog)
                                                           │ ❄️ Video Freezes & Black Screen on Dashboard
                                                           ▼ 
                                                           🔄 Emergency Reconnection (Noticeable Lag)
```

If the gateway waits for the 10-minute mark:
1. **Abrupt Server Disconnect**: Tuya Cloud abruptly closes the UDP socket at exactly 10:00.
2. **Buffer Starvation**: `onrecvframeex()` stops receiving frames.
3. **Stream Freeze**: FFmpeg stdin receives zero bytes, MediaMTX starves, and the user's dashboard video freezes on a static frame.
4. **Delayed Emergency Recovery**: The system has to rely on the 15-20 second inactivity watchdog to detect the freeze, kill FFmpeg, restart Puppeteer tabs, and re-establish P2P (causing a **15–30 second visible black screen** for end users).

---

## 2. The Solution: Proactive 8.5-Minute Refresh

Instead of reactively waiting for the connection to crash at 10 minutes, the gateway schedules a **proactive refresh at 8 minutes and 30 seconds (8.5 minutes)**.

```
 0:00 min                   8:30 min                   10:00 min (Never Reached!)
 ┌─────────────────────────────┬───────────────────────────┐
 │ Stream Active (Normal)      │ ⚡ Proactive Refresh!      │ Tuya 10m timeout avoided!
 └─────────────────────────────┴─────────────┬─────────────┘
                                             │
                                             ▼
                              Sends ConnectDevice() in background
                                             │
                                             ▼
                             Seamless frame transition (0s blackout)
```

### Why Exactly 8.5 Minutes (8 mins 30 secs)?

1. **Safe Margin (90 Seconds Ahead)**: 8.5 minutes gives the system a generous 90-second safety window before Tuya's 10-minute hard drop.
2. **Accounts for Network Latency**: Cellular 4G connections may take 2–5 seconds to perform P2P handshakes. Initiating at 8:30 ensures the new connection completes well before the old one is terminated.
3. **Zero Visual Blackouts**: Re-issuing `ConnectDevice(uuid, secret)` while the page is still active updates the SDK's internal P2P session in place. FFmpeg continues receiving frames with zero disruption on the user dashboard.

---

## 3. Exact Code Implementation in `worker.js`

**File Location:** [`gateway/worker.js`](file:///d:/enarxi/Cam/truecam/gateway/worker.js#L511-L520) (Class: `CameraBridge`)

```javascript
// Triggered once the first frame of a session arrives
if (this.refreshTimer) clearTimeout(this.refreshTimer);

this.refreshTimer = setTimeout(async () => {
  this.log(`Proactive 8.5 min refresh triggered to avoid 10 min Tuya stream timeout. Executing seamless refresh...`);
  try {
    // Silently re-issue P2P connection inside Puppeteer browser tab
    await this.connectCameraInPage();
  } catch (err) {
    this.error(`Seamless proactive refresh failed: ${err.message}. Fallback to standard reconnect...`);
    this.triggerReconnect();
  }
}, 8 * 60 * 1000 + 30 * 1000); // 8 minutes 30 seconds = 510,000 milliseconds
```

---

## 4. Key Benefits Summary

| Feature | Without 8.5m Refresh (Reactive) | With 8.5m Refresh (Proactive) |
| :--- | :--- | :--- |
| **Stream Drop Behavior** | Abrupt disconnection by Tuya at 10:00 | Pre-empted seamlessly at 8:30 |
| **Dashboard Experience** | 15-30 second frozen frame / black screen | Smooth continuous video playback |
| **FFmpeg Process Impact** | Process starves and gets killed/spawned | Process stays alive with continuous stdin stream |
| **CPU / Resource Usage** | High CPU spikes during emergency reconnects | Low, steady background execution |
