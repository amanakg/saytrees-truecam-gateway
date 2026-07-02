# Truecam Gateway Deployment & Configuration Reference

This document details the configuration, deployment steps, systemd service management, and logging practices for the Enarxi Truecam Gateway system on the production VPS (`jcb`).

---

## 1. System Architecture Overview

The system runs a Node.js-based gateway that automates login and connection to Warner H5SDK surveillance cameras via a headless Puppeteer browser, intercepts raw binary video frame streams, feeds them into FFmpeg for zero-CPU copy encoding, and pushes them to MediaMTX as RTSP streams. The live streams are then played in a WebRTC dashboard.

### Port Mappings
* **Camera 2 Gateway (`server.js`)**:
  - SDK HTTP Server: `8000` (serves WASM/HTML for Puppeteer browser)
  - Dashboard HTTP Server: `9000` (serves the dual live surveillance camera dashboard UI)
  - WebSocket Server: `8080` (receives frames from the Puppeteer context)
* **Camera 1 Gateway (`server_cam1.js`)**:
  - SDK HTTP Server: `8001`
  - WebSocket Server: `8081`
* **MediaMTX WebRTC (WHEP) Server**:
  - WebRTC WHEP endpoint port: `8889` (runs on `168.144.84.199:8889`)

---

## 2. Production Directory Structure

The files are hosted on the VPS at `/opt/truecam/`:
```
/opt/truecam/
├── dashboard/
│   ├── index.html        # Dual live surveillance camera HTML UI
│   └── reader.js         # MediaMTX WebRTC WHEP reader client
├── gateway/
│   ├── server.js         # Main Camera 2 Gateway Server (handles ports 8000, 9000, 8080)
│   ├── server_cam1.js    # Camera 1 Gateway Server (handles ports 8001, 8081)
│   ├── gateway_cam1.log  # Local log for Camera 1 (auto-cleaned on restart)
│   └── gateway_cam2.log  # Local log for Camera 2 (auto-cleaned on restart)
└── sdk_dist/             # Static SDK asset files served by the gateway HTTP servers
```

---

## 3. Systemd Service Configuration (Worker Pool)

The worker pool runs as templated systemd background services on the VPS, allowing multiple worker processes to run under isolated unit instances.

### Service File Path
`/etc/systemd/system/truecam-worker@.service`

### Service Content
```ini
[Unit]
Description=Truecam H5SDK Stream Worker Pool - Worker %i
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/truecam/gateway
ExecStart=/usr/bin/node worker.js --workerId=worker%i
Restart=always
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=truecam-worker@%i

[Install]
WantedBy=multi-user.target
```

### Systemctl Management Commands
* **Start worker 1**: `systemctl start truecam-worker@1`
* **Stop worker 1**: `systemctl stop truecam-worker@1`
* **Enable worker 1 on boot**: `systemctl enable truecam-worker@1`
* **Restart worker 1**: `systemctl restart truecam-worker@1`
* **Check status**: `systemctl status truecam-worker@1`
* **Reload systemd configuration**: `systemctl daemon-reload`

---

## 4. How to View Logs

### A. Systemd Journal Logs (Stdout & Stderr)
To inspect execution history and real-time logs managed by systemd:
* **Tail logs for worker 1 in real-time**:
  ```bash
  journalctl -u truecam-worker@1.service -f
  ```
* **View last 100 lines**:
  ```bash
  journalctl -u truecam-worker@1.service -n 100 --no-pager
  ```
* **View scrollable logs**:
  ```bash
  journalctl -u truecam-worker@1.service
  ```

### B. Application-level Log Files
Detailed logs of both servers are saved in their respective logs inside `/opt/truecam/gateway/`:
* `gateway_cam1.log`
* `gateway_cam2.log`

---

## 5. Log Auto-Cleaning & Rotation

### Local Application Logs
The local application log files (`gateway_cam1.log` and `gateway_cam2.log`) are automatically cleared and truncated every time the Node.js service starts up, preventing unbounded disk usage:
```javascript
// From gateway server files:
const logFile = path.join(__dirname, 'gateway_cam2.log');
fs.writeFileSync(logFile, ''); // clears the file on startup
```

### Systemd Journal Logs
To clean up or limit the disk usage of the systemd journals (which capture the logs under `/var/log/journal/`):
* **Limit logs to a specific time range (e.g. delete logs older than 7 days)**:
  ```bash
  journalctl --vacuum-time=7d
  ```
* **Limit logs to a specific maximum size (e.g. keep only last 500MB of logs)**:
  ```bash
  journalctl --vacuum-size=500M
  ```
* **Permanent configuration**:
  Edit `/etc/systemd/journald.conf` and set:
  ```ini
  SystemMaxUse=500M
  ```
  Then restart journald using `systemctl restart systemd-journald`.

---

## 6. Graceful Shutdown Design

The gateway includes signal handling to catch `SIGTERM` and `SIGINT` (Ctrl+C). This allows systemd restarts to complete instantly (< 1s) instead of timing out at 90 seconds.

### Logic Flow during Shutdown:
1. Receives `SIGTERM` (sent by `systemctl stop/restart`) or `SIGINT`.
2. Sets `isShuttingDown = true` to disable reconnection triggers.
3. Clears all active timeouts/watchdog intervals (`startupTimeout`, `reconnectTimeout`, `watchdogInterval`).
4. Closes the HTTP servers (`sdkHttpServer.close()` and `dashboardHttpServer.close()`) to release bound ports.
5. Closes the WebSocket server (`wss.close()`) and disconnects all clients.
6. Terminates Puppeteer (`currentBrowser.close()`) to clean up Chrome and Crashpad helper processes.
7. Closes standard input (`stdin.end()`) and terminates active FFmpeg processes (`ffmpegProcess.kill('SIGTERM')`).
8. Node.js event loop empties, and the process exits cleanly with code `0`.
