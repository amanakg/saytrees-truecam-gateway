// worker.js
// Parameterized, shared-browser worker pool for Truecam cameras
// Refactored for Single Page Multi-Camera Architecture

const ws = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./registry/db');

// Parse command line arguments
const args = {};
process.argv.slice(2).forEach(val => {
  const parts = val.split('=');
  if (parts.length === 2 && parts[0].startsWith('--')) {
    args[parts[0].substring(2)] = parts[1];
  }
});

const workerId = args.workerId || 'worker1';
const baseWsPort = parseInt(args.baseWsPort, 10) || 8080;

console.log(`[Worker:${workerId}] Booting worker pool (Single Page Multi-Camera)...`);

// Locate directories
let sdkPath = path.join(__dirname, '..', 'sdk_dist');
if (!fs.existsSync(sdkPath)) {
  sdkPath = path.join(__dirname, 'sdk_dist');
}
const dashboardPath = path.join(__dirname, '..', 'dashboard');

// Helper to serve files
function serveFile(filePath, res, isSdk = false) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('File not found');
    }
    const ext = path.extname(filePath);
    let contentType = 'text/html';
    if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.wasm') contentType = 'application/wasm';

    const headers = { 'Content-Type': contentType };
    if (isSdk) {
      headers['Cross-Origin-Opener-Policy'] = 'same-origin';
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }

    res.writeHead(200, headers);
    res.end(content);
  });
}

// Global servers - only bind if not already running on host
let sdkHttpServer = null;
let globalWsServer = null;

function startHttpServers() {
  sdkHttpServer = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
    serveFile(filePath, res, true);
  });

  sdkHttpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Worker:${workerId}] Port 8000 already in use, assuming another worker is serving SDK static files.`);
    } else {
      console.error(`[Worker:${workerId}] SDK Server error:`, err.message);
    }
  });

  sdkHttpServer.listen(8000, () => {
    console.log(`[Worker:${workerId}] Web SDK served at http://localhost:8000/`);
  });

  globalWsServer = new ws.Server({ port: baseWsPort });
  globalWsServer.on('connection', (socket, req) => {
    try {
      const url = new URL(req.url, `http://localhost`);
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        socket.close();
        return;
      }
      const bridge = activeBridges.find(b => b.deviceId === deviceId);
      if (bridge) {
        bridge.handleWebSocketConnection(socket);
      } else {
        console.warn(`[GlobalWS] Rejected connection for unknown device: ${deviceId}`);
        socket.close();
      }
    } catch (e) {
      socket.close();
    }
  });
  console.log(`[Worker:${workerId}] Unified WebSocket IPC Server listening on port ${baseWsPort}`);
}

// Locate FFmpeg path dynamically
function getFfmpegPath() {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }
  const localExe = path.join(__dirname, 'ffmpeg.exe');
  if (fs.existsSync(localExe)) {
    return localExe;
  }
  if (process.platform === 'linux') {
    return 'ffmpeg';
  }
  try {
    const wingetDir = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Admin\\AppData\\Local', 'Microsoft/WinGet/Packages');
    if (fs.existsSync(wingetDir)) {
      const dirs = fs.readdirSync(wingetDir);
      const ffmpegDir = dirs.find(d => d.includes('Gyan.FFmpeg'));
      if (ffmpegDir) {
        const binPath = path.join(wingetDir, ffmpegDir, 'ffmpeg-8.1.2-full_build/bin/ffmpeg.exe');
        if (fs.existsSync(binPath)) return binPath;
      }
    }
  } catch (e) { }

  return 'ffmpeg';
}

const ffmpegPath = getFfmpegPath();
console.log(`[Worker:${workerId}] Using FFmpeg binary: ${ffmpegPath}`);

/**
 * AccountPage manages a single shared page for a specific account email.
 * This multiplexes all cameras for this account into one V8/WASM context.
 */
class AccountPage {
  constructor(accountEmail, accountPassword, browser) {
    this.accountEmail = accountEmail;
    this.accountPassword = accountPassword;
    this.browser = browser;
    this.pages = new Map(); // deviceId -> Page
    this.initPromises = new Map(); // deviceId -> Promise<Page>
    this.injectLocks = new Map(); // deviceId -> Promise
  }

  async runSerializedInjection(deviceId, injectionFn) {
    if (typeof deviceId === 'function') {
      injectionFn = deviceId;
    }
    this.globalInjectLock = this.globalInjectLock || Promise.resolve();
    return new Promise((resolve, reject) => {
      this.globalInjectLock = this.globalInjectLock.then(async () => {
        try {
          await injectionFn();
          resolve();
        } catch (e) {
          reject(e);
        }
        // Enforce 5s stagger between camera P2P connection attempts to prevent Tuya Cloud rate-limiting
        await new Promise(r => setTimeout(r, 5000));
      });
    });
  }

  async getReadyPage(deviceId) {
    if (!deviceId) deviceId = '__default_sync__';
    let page = this.pages.get(deviceId);
    if (page && !page.isClosed()) {
      return page;
    }
    if (!this.initPromises.has(deviceId)) {
      this.initPromises.set(deviceId, this.initPageForDevice(deviceId));
    }
    page = await this.initPromises.get(deviceId);
    return page;
  }

  async initPageForDevice(deviceId) {
    console.log(`[AccountPage:${this.accountEmail}] Initializing dedicated page tab for device ${deviceId}...`);
    try {
      const page = await this.browser.newPage();

      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      page.on('console', async (msg) => {
        const text = msg.text();
        console.log(`[Browser] ${text}`);

        // Detect conn list growth — Tuya SDK leaks internal connection objects.
        // If the count exceeds 20, the WASM heap is likely corrupt; force a page reload.
        const connListMatch = text.match(/conn list is\s+(\d+)/);
        if (connListMatch) {
          const connCount = parseInt(connListMatch[1], 10);
          if (connCount > 20) {
            console.error(`[Worker Fatal] Tuya SDK conn list has grown to ${connCount} (memory leak). Forcing shared page reload to flush WASM state...`);
            // Avoid re-entrant reloads
            if (!this.isReloading) {
              this.reloadPage().catch(e => console.error(`[AccountPage] reloadPage error: ${e.message}`));
            }
            return;
          }
        }

        // Per-device -13 tracking: extract device ID from the log line
        if (text.includes('Error code:-13')) {
          const m = text.match(/\[logs\]\[p2p\]([A-Z0-9]+) Connect failed/);
          const failingDeviceId = m ? m[1] : null;
          console.error(`[Worker Warning] Tuya SDK reported an error for a camera (${text}). The connection will automatically retry, but this may indicate the camera is offline or its token rotated.`);

          if (failingDeviceId) {
            const bridge = activeBridges.find(b => b.deviceId === failingDeviceId);
            if (bridge) {
              bridge.consecutiveP2pFailures++;
              console.warn(`[${failingDeviceId}] Consecutive P2P -13 failures: ${bridge.consecutiveP2pFailures}`);
              // After 15 back-to-back -13 errors the WASM P2P state for this device is
              // stuck. A soft re-inject won't fix it — only a full page reload will.
              if (bridge.consecutiveP2pFailures >= 15) {
                if (bridge.hasEverConnected) {
                  console.error(`[${failingDeviceId}] 15 consecutive -13 failures on an active camera. Forcing full page reload to reset Tuya WASM state...`);
                  bridge.consecutiveP2pFailures = 0;
                  if (!this.isReloading) {
                    this.reloadPage().catch(e => console.error(`[AccountPage] reloadPage error: ${e.message}`));
                  }
                } else {
                  console.warn(`[${failingDeviceId}] Camera offline. Skipping page reload to protect other active cameras.`);
                }
              }
            }
          }
        } else if (text.includes('Error code:-15')) {
          console.error(`[Worker Fatal] Tuya WASM SDK reached maximum internal connections (${text}). Forcing worker restart to flush C++ memory leak and self-heal!`);
          process.exit(1);
        }

        // Any successful SDK login resets the -13 counter for that device
        if (text.includes('Connect succeeded') || text.includes('login succeeded')) {
          const m = text.match(/\[logs\]\[p2p\]([A-Z0-9]+)(Connect|login)/);
          if (m) {
            const successDeviceId = m[1];
            const bridge = activeBridges.find(b => b.deviceId === successDeviceId);
            if (bridge && bridge.consecutiveP2pFailures > 0) {
              console.log(`[${successDeviceId}] P2P succeeded — resetting consecutive failure counter.`);
              bridge.consecutiveP2pFailures = 0;
            }
          }
        }
      });
      page.on('pageerror', (err) => {
        console.error(`[Browser Error] ${err.toString()}`);
      });
      page.on('dialog', async (dialog) => {
        console.log(`[Browser Dialog] ${dialog.message()}`);
        await dialog.accept();
      });

      // Block unnecessary resources to save RAM
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'font', 'stylesheet'].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });
      await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded' });

      console.log(`[AccountPage:${this.accountEmail}][${deviceId}] Running login sequence...`);
      await page.evaluate(async ({ acc, pwd }) => {
        // STEP 1: The page loads with a hardcoded access_token that works for the device list API.
        // Call getDeviceList NOW (before login) while the hardcoded token is still active.
        // This populates the dropdown correctly. The fresh login token causes decryption issues.
        console.log('[Browser] Step 1: Fetching device list with existing hardcoded token...');
        try {
          const res = await window.ConnectApi.getDeviceList();
          if (res && res.data && res.data.data && res.data.data.list && res.data.data.list.length > 0) {
            const select = document.getElementById('dev_id');
            if (select) {
              select.innerHTML = res.data.data.list.map(device => {
                const p = device.deviceParams;
                return `<option value="${p.productId}:${p.deviceUuid}:${p.deviceSecret}">${p.deviceUuid}</option>`;
              }).join('');
            }
            window.__deviceList = res.data.data.list.map(d => d.deviceParams);
            console.log(`[Browser] Step 1 OK: Dropdown populated with ${res.data.data.list.length} device(s).`);
          } else {
            console.log('[Browser] Step 1: getDeviceList returned no devices (hardcoded token may be expired). Will retry after login.');
          }
        } catch (e) {
          console.log('[Browser] Step 1: getDeviceList failed:', e && e.message);
        }

        // STEP 2: Now do the real login to get a fresh token for P2P camera connections.
        window.access_token = null;
        document.getElementById('login-account').value = acc;
        document.getElementById('login-password').value = pwd;
        document.getElementById('loginBtn').click();

        await new Promise((resolve, reject) => {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            if (window.access_token) {
              clearInterval(interval);
              resolve();
            } else if (attempts > 60) {
              clearInterval(interval);
              reject(new Error("Timeout waiting for access_token"));
            }
          }, 500);
        });

        // STEP 3: If the dropdown is still empty after login (hardcoded token was expired),
        // try getDeviceList again with the fresh token as a fallback.
        const dropdownCount = document.getElementById('dev_id') ? document.getElementById('dev_id').options.length : 0;
        if (dropdownCount === 0) {
          console.log('[Browser] Step 3: Dropdown still empty, retrying getDeviceList with fresh token...');
          try {
            const res = await window.ConnectApi.getDeviceList();
            if (res && res.data && res.data.data && res.data.data.list && res.data.data.list.length > 0) {
              const select = document.getElementById('dev_id');
              if (select) {
                select.innerHTML = res.data.data.list.map(device => {
                  const p = device.deviceParams;
                  return `<option value="${p.productId}:${p.deviceUuid}:${p.deviceSecret}">${p.deviceUuid}</option>`;
                }).join('');
              }
              window.__deviceList = res.data.data.list.map(d => d.deviceParams);
              console.log(`[Browser] Step 3 OK: Dropdown populated with ${res.data.data.list.length} device(s).`);
            }
          } catch (e) {
            console.log('[Browser] Step 3 failed:', e && e.message);
          }
        }

        // Override rendering APIs to prevent the SDK from allocating canvas buffers
        // This saves 20-80MB per page since we don't need to display video visually.
        CanvasRenderingContext2D.prototype.drawImage = function () { };
        CanvasRenderingContext2D.prototype.putImageData = function () { };
        CanvasRenderingContext2D.prototype.createImageData = function () { return { data: { set: function () { } } }; };
        window.requestAnimationFrame = () => { };
        HTMLCanvasElement.prototype.getContext = function () {
          return {
            drawImage() { },
            putImageData() { },
            createImageData() { return { data: { set: function () { } } }; },
            clearRect() { },
            fillRect() { }
          };
        };

        // Install Global Multiplexed Interceptor
        window.__wsConnections = window.__wsConnections || {};

        const interceptorInterval = setInterval(() => {
          if (window.ConnectApi && window.ConnectApi.onrecvframeex && !window.ConnectApi.onrecvframeex.toString().includes('__wsConnections')) {
            const original = window.ConnectApi.onrecvframeex;
            window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
              console.log(`[Browser] Frame received! deviceId=${api_conn.deviceid}, frametype=${frametype}, len=${datalen}, res=${width}x${height}, enc=${enc}`);
              if (frametype === 1 || frametype === 2) {
                // Look up the correct WebSocket based on api_conn.deviceid
                const ws = window.__wsConnections[api_conn.deviceid];
                if (ws && ws.readyState === WebSocket.OPEN) {
                  if (!ws.isInitSent) {
                    const initPayload = JSON.stringify({ type: 'init', enc: enc, width: width, height: height, fps: fps });
                    console.log(`[Browser] Sending init payload: ${initPayload}`);
                    ws.send(initPayload);
                    ws.isInitSent = true;
                    console.log(`[Browser] Sent init for ${api_conn.deviceid}`);
                  }
                  ws.send(data);
                } else {
                  console.log(`[Browser] WS not ready for ${api_conn.deviceid}`);
                }
              }
              original.apply(this, arguments);
            };
            console.log('[Browser] Global Multiplexed Interceptor installed (or re-installed).');
          }
        }, 100);
      }, { acc: this.accountEmail, pwd: this.accountPassword });

      // Auto-sync is deferred to after the 8s WASM wait (see below)

      console.log(`[AccountPage:${this.accountEmail}] Waiting 8s for Tuya WASM SDK to finish internal initialization...`);
      await new Promise(r => setTimeout(r, 8000));

      // NOW call getDeviceList - WASM is fully initialized, decryption works correctly
      console.log(`[AccountPage:${this.accountEmail}][${deviceId}] Fetching device list after WASM init...`);
      await page.evaluate(async () => {
        let devices = [];
        let attempts = 0;
        while (attempts < 5) {
          attempts++;
          try {
            const res = await window.ConnectApi.getDeviceList();
            if (res && res.data && res.data.data && res.data.data.list && res.data.data.list.length > 0) {
              devices = res.data.data.list.map(d => d.deviceParams);
              const select = document.getElementById('dev_id');
              if (select) {
                select.innerHTML = res.data.data.list.map(device => {
                  const p = device.deviceParams;
                  return `<option value="${p.productId}:${p.deviceUuid}:${p.deviceSecret}">${p.deviceUuid}</option>`;
                }).join('');
              }
              console.log(`[Browser] Device dropdown populated with ${devices.length} device(s).`);
              break;
            } else {
              console.log(`[Browser] getDeviceList returned empty list, attempt ${attempts}/5. Retrying in 2s...`);
              await new Promise(r => setTimeout(r, 2000));
            }
          } catch (err) {
            console.error('[Browser] getDeviceList failed:', err && err.message);
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        window.__deviceList = devices;
      });


      // Auto-sync newly found cameras to registry (now that __deviceList is populated)
      const deviceList = await page.evaluate(() => window.__deviceList || []);
      if (deviceList.length > 0) {
        console.log(`[AccountPage:${this.accountEmail}][${deviceId}] Found ${deviceList.length} cameras. Auto-syncing to registry...`);
        for (const dev of deviceList) {
          if (!dev.deviceUuid || !dev.deviceSecret) continue;
          const existing = db.getDevice(dev.deviceUuid);
          if (!existing) {
            console.log(`[AccountPage] Found new camera: ${dev.deviceUuid}. Registering...`);
            const streamName = `cam_${dev.deviceUuid.slice(-6).toLowerCase()}`;
            try {
              db.upsertDevice({
                deviceId: dev.deviceUuid,
                deviceSecret: dev.deviceSecret,
                nickname: dev.nickname || `Camera_${dev.deviceUuid.slice(-6)}`,
                clientId: 'enarxi',
                accountEmail: this.accountEmail,
                accountPasswordRef: this.accountPassword,
                streamName: streamName,
                workerId: workerId,
                productId: dev.productId, // Auto-capture productId for new cameras
                status: 'offline'
              });
              console.log(`[AccountPage] Registered new camera ${dev.deviceUuid} mapped to stream: live/${streamName}`);
            } catch (e) {
              console.error(`[AccountPage] Failed to register camera ${dev.deviceUuid}:`, e.message);
            }
          }
        }
      }

      console.log(`[AccountPage:${this.accountEmail}][${deviceId}] Dedicated page tab is ready!`);
      this.pages.set(deviceId, page);
      return page;
    } catch (err) {
      this.initPromises.delete(deviceId);
      throw err;
    }
  }

  async close(deviceId) {
    if (deviceId && this.pages.has(deviceId)) {
      const page = this.pages.get(deviceId);
      if (page && !page.isClosed()) {
        try { await page.close(); } catch (e) { }
      }
      this.pages.delete(deviceId);
      this.initPromises.delete(deviceId);
    } else {
      for (const [id, page] of this.pages) {
        if (page && !page.isClosed()) {
          try { await page.close(); } catch (e) { }
        }
      }
      this.pages.clear();
      this.initPromises.clear();
    }
  }

  async reloadPage(deviceId) {
    if (!deviceId) deviceId = '__default_sync__';
    console.log(`[AccountPage:${this.accountEmail}] Recreating page tab for ${deviceId} to reset SDK state...`);
    await this.close(deviceId);
    return this.getReadyPage(deviceId);
  }
}

/**
 * CameraBridge handles routing a single camera's stream to FFmpeg.
 * It does NOT own a browser page. It uses the AccountManager to send commands.
 */
class CameraBridge {
  constructor(device, wsPort, accountManager) {
    this.deviceId = device.device_id;
    this.deviceSecret = device.device_secret;
    this.productId = device.product_id || null; // Tuya productId for constructing formattedDevId
    this.nickname = device.nickname || device.device_id;
    this.accountEmail = device.account_email;
    this.accountPassword = device.account_password_ref;
    this.streamUrl = `rtsp://127.0.0.1:8554/live/${device.stream_name}`;
    this.wsPort = wsPort;
    this.accountManager = accountManager;

    this.wss = null;
    this.ffmpegProcess = null;
    this.watchdogInterval = null;
    this.lastFrameTime = 0;
    this.lastDbUpdateTime = 0;
    this.reconnectTimeout = null;
    this.isStopping = false;
    this.isReconnecting = false;

    // Track consecutive P2P -13 failures for this specific device
    this.consecutiveP2pFailures = 0;
    this.hasEverConnected = false;
    this.reconnectAttempts = 0;
    this.circuitBreakerStrikes = 0;
    // Track how many frames we received after the last connect (used to reset the -13 counter)
    this.framesReceivedSinceConnect = 0;
    this.refreshTimer = null;

    this.logPrefix = `[${this.nickname}][Port:${this.wsPort}]`;
  }

  log(...args) { console.log(`${this.logPrefix}`, ...args); }
  warn(...args) { console.warn(`${this.logPrefix} [WARN]`, ...args); }
  error(...args) { console.error(`${this.logPrefix} [ERROR]`, ...args); }

  async start() {
    this.log('Starting bridge controller...');
    db.updateStatus(this.deviceId, 'connecting');

    await this.connectCameraInPage();
  }

  handleWebSocketConnection(socket) {
    if (this.activeSocket) {
      try { this.activeSocket.close(); } catch (e) { }
    }
    this.activeSocket = socket;
    this.log('Browser SDK routed WS connection established! Waiting for frames...');
    this.lastFrameTime = Date.now();
    this.firstMessageLogged = false; // Reset on each new connection
    // Do NOT set status='connected' here. Wait for the first frame.

    // Reset isInitSent on the new WS so FFmpeg gets the init payload after reconnect
    socket.isInitSent = false;

    if (this.watchdogInterval) clearInterval(this.watchdogInterval);

    this.watchdogInterval = setInterval(() => {
      const idleTime = Date.now() - this.lastFrameTime;
      // Two-tier watchdog: 20s grace period for first frame, 15s during active stream
      const threshold = this.ffmpegProcess ? 15000 : 20000;
      if (idleTime > threshold) {
        this.warn(`Stream idle for ${idleTime / 1000}s. Triggering reconnect...`);
        clearInterval(this.watchdogInterval);
        this.watchdogInterval = null;

        this.killFfmpeg();
        this.triggerReconnect();
      }
    }, 1000);

    socket.on('message', (message) => {
      this.lastFrameTime = Date.now();
      if (!this.firstMessageLogged) {
        this.firstMessageLogged = true;
        this.log(`First message received! Type: ${typeof message}, IsBuffer: ${Buffer.isBuffer(message)}, Byte0: ${message[0]}`);
        db.updateStatus(this.deviceId, 'connected', new Date().toISOString()); // Officially connected!
        // Reset the counters — we're actually getting frames now
        this.consecutiveP2pFailures = 0;
        this.reconnectAttempts = 0;
        this.circuitBreakerStrikes = 0;
        this.hasEverConnected = true;

        this.scheduleProactiveRefresh();

        if (Buffer.isBuffer(message)) {
          this.log(`First 20 bytes: ${message.slice(0, 20).toString('hex')}`);
          this.log(`Stringified: ${message.toString('utf8').substring(0, 100)}`);
        }
      }

      if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 123)) {
        try {
          const initData = JSON.parse(message.toString());
          if (initData.type === 'init') {
            this.log('Received frame metadata:', initData);
            this.lastFrameTime = Date.now();
            const codec = (initData.enc || 'unknown').toLowerCase() === 'h265' ? 'hevc' : (initData.enc || 'unknown').toLowerCase();
            const resolution = initData.width && initData.height ? `${initData.width}x${initData.height}` : 'unknown';
            const fps = initData.fps || 0;
            db.updateMetadata(this.deviceId, codec, resolution, fps);
            // Start/continue FFmpeg pipeline
            this.startFfmpeg(initData);
            // Re-schedule the 8.5 minute proactive refresh timer for the next cycle (17m, 25.5m, etc.)
            this.scheduleProactiveRefresh();
          }
        } catch (e) { }
        return;
      }

      if (this.ffmpegProcess && this.ffmpegProcess.stdin.writable) {
        this.lastFrameTime = Date.now();
        this.ffmpegProcess.stdin.write(message);

        const now = Date.now();
        if (now - this.lastDbUpdateTime > 30000) {
          db.updateStatus(this.deviceId, 'connected', new Date().toISOString());
          this.lastDbUpdateTime = now;
        }
      }
    });

    socket.on('close', () => {
      if (this.activeSocket === socket) {
        this.log('Browser SDK page disconnected WS.');
        this.cleanupSession();
        this.triggerReconnect();
      }
    });
  }

  scheduleProactiveRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      this.log(`Proactive 8.5 min refresh triggered to avoid 10 min Tuya stream timeout. Executing seamless refresh...`);
      try {
        await this.connectCameraInPage();
      } catch (err) {
        this.error(`Seamless proactive refresh failed: ${err.message}. Fallback to standard reconnect...`);
        this.triggerReconnect();
      }
    }, 8 * 60 * 1000 + 30 * 1000); // 8 minutes 30 seconds (510,000 ms)
  }

  startFfmpeg(initData) {
    // If FFmpeg is already active and healthy, keep the stdin pipe open for seamless zero-lag streaming
    if (this.ffmpegProcess && !this.ffmpegProcess.killed && this.ffmpegProcess.stdin && this.ffmpegProcess.stdin.writable) {
      this.log(`FFmpeg pipeline already active for RTSP: ${this.streamUrl}. Continuing seamless stream handover.`);
      return;
    }

    this.killFfmpeg();
    const isH265 = initData.enc && (initData.enc.includes('265') || initData.enc.includes('hevc'));
    const inputFormat = isH265 ? 'hevc' : 'h264';

    this.log(`Launching FFmpeg with format: ${inputFormat} -> RTSP: ${this.streamUrl}`);

    const ffmpegArgs = [
      '-y',
      '-fflags', '+genpts+discardcorrupt+nobuffer',
      '-flags', 'low_delay',
      '-strict', 'experimental',
      '-use_wallclock_as_timestamps', '1',
      '-analyzeduration', '2000000',
      '-probesize', '1000000',
      '-f', inputFormat,
      '-i', 'pipe:0',
      '-c:v', 'copy',
      '-max_muxing_queue_size', '1024',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      '-timeout', '5000000',
      this.streamUrl
    ];

    this.ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    this.ffmpegProcess.stdin.on('error', (err) => {
      // Ignore EPIPE errors which happen if FFmpeg dies and we try to write to it
      if (err.code !== 'EPIPE' && err.code !== 'EOF') {
        this.error(`FFmpeg stdin error: ${err.message}`);
      }
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      this.log(`[FFmpeg] ${data.toString().trim()}`);
    });

    this.ffmpegProcess.on('error', (err) => {
      this.error(`FFmpeg process failed to spawn: ${err.message}`);
      this.ffmpegProcess = null;
      this.triggerReconnect();
    });

    this.ffmpegProcess.on('close', (code) => {
      this.warn(`FFmpeg process exited (code=${code})`);
      if (this.ffmpegProcess) {
        this.ffmpegProcess = null;
        this.triggerReconnect();
      }
    });
  }

  killFfmpeg() {
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.stdin.end();
        this.ffmpegProcess.kill('SIGKILL');
      } catch (e) { }
      this.ffmpegProcess = null;
    }
  }

  cleanupSession() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.killFfmpeg();
  }

  async disconnectCameraInPage(devId) {
    if (!this.accountManager) return;
    try {
      const page = await this.accountManager.getReadyPage(this.deviceId);
      if (page) {
        await this.accountManager.runSerializedInjection(this.deviceId, async () => {
          await page.evaluate(async (devId) => {
            console.log(`[Worker Debug] disconnectCameraInPage running for ${devId}`);
            if (window.__wsConnections && window.__wsConnections[devId]) {
              try {
                window.__wsConnections[devId].close();
                delete window.__wsConnections[devId];
              } catch (e) { }
            }
            if (typeof Player !== 'undefined' && typeof Player.DisConnectDevice !== 'undefined') {
              try {
                if (typeof GetSessionById !== 'undefined' && typeof ConnectApi !== 'undefined' && typeof ConnectApi.close_stream !== 'undefined') {
                  let session = GetSessionById(devId);
                  if (session) {
                    console.log(`[Worker Debug] Found session in disconnectCameraInPage. Closing stream...`);
                    ConnectApi.close_stream(session, 0, 1);
                    console.log(`[Worker Debug] Waiting 1500ms for WASM to cleanly close stream before killing socket...`);
                    await new Promise(r => setTimeout(r, 1500));
                  } else {
                    console.log(`[Worker Debug] GetSessionById returned null for ${devId} in disconnectCameraInPage!`);
                  }
                }
                console.log(`[Worker Debug] Calling Player.DisConnectDevice(${devId})`);
                Player.DisConnectDevice(devId);
                console.log(`[Worker Debug] DisConnectDevice completed for ${devId}`);
              } catch (e) {
                console.log(`[Worker Debug] ERROR in disconnectCameraInPage: ${e.message}`);
              }
            } else {
              console.log(`[Worker Debug] Player or DisConnectDevice is UNDEFINED!`);
            }
          }, devId);
        });
      }
    } catch (e) {
      console.log(`[Worker Error] disconnectCameraInPage failed: ${e.message}`);
    }
  }

  triggerReconnect() {
    if (this.isStopping || this.isReconnecting) return;
    if (this.reconnectTimeout) return;

    this.cleanupSession();

    // Immediately tear down the SDK session in the browser so the WASM module
    // has the entire backoff duration (3s+) to cleanly close its internal C++ sockets.
    this.disconnectCameraInPage(this.deviceId).catch(() => { });

    this.reconnectAttempts++;

    // Stop reconnecting after many failures
    if (this.reconnectAttempts >= 15 || this.consecutiveP2pFailures >= 15) {
      this.warn(`Too many failures (${this.reconnectAttempts} attempts, ${this.consecutiveP2pFailures} P2P errors). Marking offline and pausing reconnects for 2 minutes.`);
      this.reconnectAttempts = 0;
      // Do not reset consecutiveP2pFailures here so the page reload logic in AccountPage can still trigger if needed
      const backoffMs = 120000; // wait 2 minutes
      db.updateStatus(this.deviceId, 'offline');

      this.log(`Scheduling delayed reconnection in ${Math.round(backoffMs)}ms...`);
      this.reconnectTimeout = setTimeout(async () => {
        this.reconnectTimeout = null;
        try {
          this.isReconnecting = true;
          await this.connectCameraInPage();
        } catch (err) {
          this.error(`Reconnection failed: ${err.message}`);
          this.triggerReconnect();
        } finally {
          this.isReconnecting = false;
        }
      }, backoffMs);
      return;
    }

    // Tuya SDK WASM engine takes ~30s to clean up a dead socket internally.
    // Wait 25s to balance fast recovery against Tuya WASM cleanup requirements.
    let backoffMs = 25000;
    this.log(`Scheduling reconnection in ${Math.round(backoffMs)}ms (attempt ${this.reconnectAttempts})...`);
    db.updateStatus(this.deviceId, 'reconnecting');

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      try {
        this.isReconnecting = true;

        if (this.reconnectAttempts > 0 && this.reconnectAttempts % 4 === 0) {
          if (this.circuitBreakerStrikes < 2) {
            this.circuitBreakerStrikes++;
            this.log(`Camera failed to reconnect ${this.reconnectAttempts} times. Proactively reloading shared page to clear SDK memory leak... (Strike ${this.circuitBreakerStrikes})`);
            await this.accountManager.reloadPage(this.deviceId);
            this.accountManager.reconnectCount = 0;
          } else {
            this.log(`Camera failed ${this.reconnectAttempts} times. Circuit breaker strikes maxed out. Bypassing page reload to protect other cameras.`);
          }
        } else if (this.accountManager.reconnectCount > 150) {
          this.log('Reconnection count exceeded limit. Proactively reloading shared page to clear SDK memory leak...');
          await this.accountManager.reloadPage(this.deviceId);
          this.accountManager.reconnectCount = 0;
        }

        this.accountManager.reconnectCount++;

        this.log('Attempting to reconnect (re-injecting camera connection only, no page reload)...');
        // Do NOT reload the page — that takes 10-30s and causes the 40s restart loop.
        // Simply re-issue the ConnectDevice command into the existing live page.
        await this.connectCameraInPage();
      } catch (err) {
        this.error(`Reconnection failed: ${err.message}`);
        this.triggerReconnect();
      } finally {
        this.isReconnecting = false;
      }
    }, backoffMs);
  }

  async connectCameraInPage() {
    try {
      if (this.deviceId.startsWith('MOCK_CAM_')) {
        this.log('Simulating connection for mock camera...');
        db.updateStatus(this.deviceId, 'connected');

        // Spawn dummy FFmpeg load generator for testing
        this.killFfmpeg();

        // Delay mock spawn by 20 seconds to wait for real camera to publish first
        setTimeout(() => {
          const ffmpegArgs = [
            '-fflags', 'nobuffer',
            '-flags', 'low_delay',
            '-rtsp_transport', 'tcp',
            '-i', 'rtsp://127.0.0.1:8554/live/devcamera1_hd',
            '-c:v', 'copy',
            '-f', 'rtsp',
            '-rtsp_transport', 'tcp',
            this.streamUrl
          ];
          this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
          this.ffmpegProcess.stderr.on('data', () => { }); // Ignore output to prevent spam

          this.ffmpegProcess.on('error', (err) => {
            this.error(`Mock FFmpeg error: ${err.message}`);
            this.ffmpegProcess = null;
            this.triggerReconnect();
          });

          this.ffmpegProcess.on('close', (code) => {
            this.warn(`Mock FFmpeg exited (code=${code}), retrying...`);
            this.ffmpegProcess = null;
            this.triggerReconnect();
          });
        }, 20000);
        return;
      }

      const page = await this.accountManager.getReadyPage(this.deviceId);

      this.log('Queueing connection command into dedicated page...');

      await this.accountManager.runSerializedInjection(this.deviceId, async () => {
        this.log('Injecting connection command into shared page...');

        await page.evaluate(({ devId, devSecret, wsPort, productId }) => {
          return new Promise((resolve) => {
            window.__wsConnections = window.__wsConnections || {};

            let oldWsClose = window.WebSocket.prototype.close;
            let closeFired = false;
            let sdkWs = null;

            // Intercept the close call to track when the SDK's websocket actually finishes closing
            window.WebSocket.prototype.close = function (code, reason) {
              sdkWs = this;
              this.addEventListener('close', () => {
                closeFired = true;
              });
              return oldWsClose.apply(this, arguments);
            };

            // Restore original WebSocket close immediately
            window.WebSocket.prototype.close = oldWsClose;

            const proceedToConnect = () => {
              // Establish WS pipe for frames
              const wsUrl = `ws://localhost:${wsPort}/?deviceId=${devId}`;
              const ws = new WebSocket(wsUrl);
              ws.binaryType = 'arraybuffer';
              window.__wsConnections[devId] = ws;

              ws.onopen = () => {
                setTimeout(() => {
                  if (typeof Player !== 'undefined' && Player.ConnectDevice) {
                    let formattedDevId = "";

                    // PRIMARY: Use productId from registry to build formattedDevId directly.
                    // This bypasses the SDK's getDeviceList() which fails due to expired/broken API token.
                    if (productId) {
                      formattedDevId = `${productId}:${devId}:${devSecret}`;
                      console.log(`[Browser] [Worker] Using registry productId to build formattedDevId for ${devId}.`);
                    } else {
                      // FALLBACK: Look up the dropdown (only works when getDeviceList succeeds)
                      const devSelect = document.getElementById("dev_id");
                      if (devSelect) {
                        for (let i = 0; i < devSelect.options.length; i++) {
                          if (devSelect.options[i].text === devId) {
                            formattedDevId = devSelect.options[i].value;
                            break;
                          }
                        }
                      }
                    }

                    if (!formattedDevId) {
                      console.log("[Browser] ERROR: formattedDevId could not be constructed - productId missing and dropdown empty!");
                      resolve();
                      return;
                    }
                    console.log(`[Browser] [Worker] ConnectDevice called for ${devId}. Formatted: ${formattedDevId}`);

                    // Allocate a unique winindex for each camera
                    window.__cameraWinIndexMap = window.__cameraWinIndexMap || {};
                    if (window.__cameraWinIndexMap[devId] === undefined) {
                      window.__cameraWinIndexMap[devId] = Object.keys(window.__cameraWinIndexMap).length;
                    }
                    let winIndex = window.__cameraWinIndexMap[devId];

                    // Provide a lightweight dummy player object for playerList[winIndex]
                    // This prevents harmless console errors like 'TypeError: Cannot read properties of undefined (reading fillframe_v2)'
                    // without spawning real WASM Web Workers that cause net::ERR_FAILED.
                    if (typeof playerList !== 'undefined') {
                      if (!playerList[winIndex]) {
                        playerList[winIndex] = {
                          open() { },
                          fillframe_v2() { },
                          fillframe() { },
                          SetStreamMode() { },
                          close() { }
                        };
                      }
                    }

                    // Hook into onloginresult to explicitly OpenStream.
                    // Use a global key so this only applies once per page, preventing duplicate hooks!
                    const hookKey = `__loginHooked_global`;
                    if (typeof ConnectApi !== 'undefined' && !window[hookKey]) {
                      window[hookKey] = true;
                      const originalLogin = ConnectApi.onloginresult;
                      ConnectApi.onloginresult = function (api_conn, result) {
                        if (originalLogin) originalLogin.apply(this, arguments);
                        if (result === 0) {
                          console.log(`[Worker] SDK login succeeded for ${api_conn.deviceid || api_conn.ip}, manually opening stream...`);
                          if (typeof Player !== 'undefined' && Player.OpenStream) {
                            // Main stream (streamid=1)
                            let idx = window.__cameraWinIndexMap ? window.__cameraWinIndexMap[api_conn.deviceid] : 0;
                            if (idx === undefined) idx = 0;
                            Player.OpenStream(api_conn.deviceid, "", 0, 1, idx);
                          }
                        }
                      };
                    }

                    // Debug: Ensure the Tuya SDK is tracking the session cleanly
                    try {
                      if (typeof GetSessionById !== 'undefined') {
                        const existingSession = GetSessionById(formattedDevId) || GetSessionById(devId);
                        console.log(`[Browser] [Worker Debug] Session before ConnectDevice: ${existingSession ? 'EXISTS' : 'NULL'}`);
                      }
                    } catch (e) { }

                    // Create a custom onResolv to avoid Tuya's default index.js which reads from the dev_id dropdown (causing cross-talk)
                    window[`__customOnResolv_${devId}`] = function (dId, mqtt_ipv4, mqtt_ipv6, mqtt_port, mqtts_port, ws_port, wss_port, mqttDomain) {
                      console.log(`[Browser] Device ID: ${dId}, mqtt address: ${mqtt_ipv4}, ${mqtt_ipv6}, ${mqtt_port}, ${mqtts_port}, ${ws_port}, ${wss_port}, ${mqttDomain}`);
                      let protocol = (mqtts_port > 0) ? "mqtts" : "mqtt";
                      let port = (mqtts_port > 0) ? mqtts_port : mqtt_port;
                      let url = dId;
                      if (!dId.includes(".")) {
                        protocol = (wss_port > 0) ? "wss" : "ws";
                        port = (wss_port > 0) ? wss_port : ws_port;
                        url = mqtt_ipv4.replace(/\./g, "-") + "." + mqttDomain;
                      }
                      console.log(`[Browser] Connecting MQTT directly for ${devId} with protocol ${protocol} on port ${port}...`);
                      if (typeof MqttClient !== 'undefined' && MqttClient.connectClient) {
                        MqttClient.connectClient(devId, devSecret, url, port);
                      }
                    };

                    // Actually call the Tuya connection logic
                    try {
                      Player.ConnectDevice(formattedDevId, "", "admin", devSecret, winIndex, 80, 0, 0, 1, "wss", window[`__customOnResolv_${devId}`]);
                    } catch (e) {
                      console.log(`[Browser] ERROR in ConnectDevice: ${e.message}`);
                    }
                  }
                  resolve();
                }, 100);
              };
              ws.onerror = () => resolve();
            };

            if (sdkWs && sdkWs.readyState !== WebSocket.CLOSED) {
              let checkInterval = setInterval(() => {
                if (closeFired || sdkWs.readyState === WebSocket.CLOSED) {
                  clearInterval(checkInterval);
                  clearTimeout(timeout);
                  setTimeout(proceedToConnect, 100);
                }
              }, 50);

              let timeout = setTimeout(() => {
                clearInterval(checkInterval);
                setTimeout(proceedToConnect, 100);
              }, 3000);
            } else {
              setTimeout(proceedToConnect, 100);
            }
          });
        }, { devId: this.deviceId, devSecret: this.deviceSecret, wsPort: this.wsPort, productId: this.productId });

        // CRITICAL FIX: Give the Tuya WASM SDK enough time to fully execute its C++ connectbykey logic 
        // (including external HTTP requests to Tuya Cloud) before releasing the mutex.
        // Tuya's SDK crashes or drops connections if two ConnectDevice calls happen concurrently!
        this.log('Staggering next camera connection to protect WASM state...');
        await new Promise(r => setTimeout(r, 4000));
      }); // End of serialized injection block

    } catch (err) {
      throw err;
    }
  }

  async stop() {
    this.log('Stopping bridge...');
    this.isStopping = true;
    db.updateStatus(this.deviceId, 'offline');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.cleanupSession();

    try {
      const page = await this.accountManager.getReadyPage(this.deviceId);
      await page.evaluate((devId) => {
        if (window.__wsConnections && window.__wsConnections[devId]) {
          try { window.__wsConnections[devId].close(); } catch (e) { }
        }
        if (typeof Player !== 'undefined' && Player.DisConnectDevice) {
          try { Player.DisConnectDevice(devId); } catch (e) { }
        }
      }, this.deviceId);
    } catch (e) { }

    try { if (this.activeSocket) this.activeSocket.close(); } catch (e) { }
  }
}

// Initialize and boot bridge array
let browserInstance = null;
const activeBridges = [];
const accountPages = new Map();

async function boot() {
  const allBridgeDevices = db.db.prepare(`
    SELECT * FROM devices 
    WHERE ingest_tier = 'bridge' AND worker_id = ?
    ORDER BY created_at
  `).all(workerId);

  // Reset all statuses to offline at boot to clear out stale 'connected' states from previous runs
  try {
    db.db.prepare(`UPDATE devices SET status = 'offline' WHERE worker_id = ?`).run(workerId);
  } catch (e) { }

  console.log(`[Worker:${workerId}] Found ${allBridgeDevices.length} devices assigned in registry.`);
  if (allBridgeDevices.length === 0) {
    console.log(`[Worker:${workerId}] No devices assigned. Waiting in idle loop...`);
    return;
  }

  const allBridgeGlobal = db.db.prepare(`
    SELECT device_id FROM devices 
    WHERE ingest_tier = 'bridge' 
    ORDER BY created_at
  `).all();

  startHttpServers();

  console.log(`[Worker:${workerId}] Launching shared Playwright browser with memory optimizations...`);
  const { chromium } = await import('playwright');

  const cacheDir = `/tmp/playwright_cache_worker_${workerId}`;
  if (fs.existsSync(cacheDir)) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log(`[Worker:${workerId}] Cleared Chromium cache at ${cacheDir}`);
    } catch (e) {
      console.error(`[Worker:${workerId}] Failed to clear cache: ${e.message}`);
    }
  }

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-translate',
      '--disable-hang-monitor',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--mute-audio',
      '--disable-audio-output',
      '--autoplay-policy=no-user-gesture-required',
      // Extreme Memory Optimization Flags
      '--disable-features=OptimizationGuideModelDownloading,OptimizationHints,OnDeviceModel,OnDeviceTranslation,OptimizationGuideOnDeviceModel',
      '--disable-component-update',
      '--disable-software-rasterizer',
      '--disable-webgl',
      '--disable-3d-apis',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu-compositing',
      '--disable-domain-reliability',
      '--disable-print-preview',
      '--disable-reading-from-canvas',
      '--disable-client-side-phishing-detection',
      '--memory-pressure-off'
    ]
  };

  try {
    browserInstance = await chromium.launch(launchOptions);
  } catch (launchErr) {
    if (launchErr.message.includes('Executable doesn\'t exist') || launchErr.message.includes('playwright install')) {
      console.log(`[Worker:${workerId}] Chromium binary missing. Automatically running 'npx playwright install chromium'...`);
      const { execSync } = await import('child_process');
      execSync('npx playwright install chromium', { stdio: 'inherit' });
      console.log(`[Worker:${workerId}] Playwright Chromium binary installed! Retrying browser launch...`);
      browserInstance = await chromium.launch(launchOptions);
    } else {
      throw launchErr;
    }
  }

  browserInstance.on('disconnected', () => {
    console.warn(`[Worker:${workerId}] Shared Playwright browser disconnected! Shutting down...`);
    shutdown(1);
  });

  // Start a bridge for each camera
  for (const device of allBridgeDevices) {
    const email = device.account_email;
    let accountPage = accountPages.get(email);
    if (!accountPage) {
      accountPage = new AccountPage(email, device.account_password_ref, browserInstance);
      accountPages.set(email, accountPage);
    }

    const index = allBridgeGlobal.findIndex(d => d.device_id === device.device_id);
    const wsPort = baseWsPort; // Unified WS port

    const bridge = new CameraBridge(device, wsPort, accountPage);
    activeBridges.push(bridge);

    bridge.start().catch(err => {
      console.error(`[Worker:${workerId}] Error starting camera bridge ${device.device_id}:`, err.message);
    });

    await new Promise(r => setTimeout(r, 1000));
  }
  // Periodically poll the Tuya SDK to discover newly added cameras automatically
  // This removes the need to ever manually restart the worker after adding a camera in the Tuya app.
  setInterval(async () => {
    try {
      for (const [email, accountPage] of accountPages) {
        let activePage = null;
        for (const [id, page] of accountPage.pages) {
          if (page && !page.isClosed()) {
            activePage = page;
            break;
          }
        }
        if (!activePage) continue;

        // Re-extract device list from the live browser session
        const deviceList = await activePage.evaluate(async () => {
          try {
            let res = await window.ConnectApi.getDeviceList();
            if (res && res.data && res.data.data && res.data.data.list) {
              return res.data.data.list.map(d => d.deviceParams);
            }
          } catch (e) { }
          return [];
        });

        if (deviceList.length > 0) {
          for (const dev of deviceList) {
            if (!dev.deviceUuid || !dev.deviceSecret) continue;
            const existing = db.getDevice(dev.deviceUuid);
            if (!existing) {
              console.log(`[Worker:${workerId}] Background sync found new camera: ${dev.deviceUuid}. Registering...`);
              const streamName = `cam_${dev.deviceUuid.slice(-6).toLowerCase()}`;
              try {
                db.upsertDevice({
                  deviceId: dev.deviceUuid,
                  deviceSecret: dev.deviceSecret,
                  nickname: dev.nickname || `Camera_${dev.deviceUuid.slice(-6)}`,
                  clientId: 'enarxi',
                  accountEmail: email,
                  accountPasswordRef: accountPage.accountPassword,
                  streamName: streamName,
                  workerId: workerId,
                  productId: dev.productId, // Auto-capture productId for new cameras
                  status: 'offline'
                });
              } catch (e) {
                console.error(`[Worker:${workerId}] Background auto-sync failed for ${dev.deviceUuid}:`, e.message);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`[Worker:${workerId}] Error during Tuya background sync:`, e.message);
    }
  }, 2 * 60 * 1000); // Check Tuya Cloud every 2 minutes

  // Set up polling loop to check for new assigned devices
  setInterval(() => {
    try {
      const currentDevices = db.db.prepare(`
        SELECT * FROM devices 
        WHERE ingest_tier = 'bridge' AND worker_id = ?
      `).all(workerId);

      const globalDevices = db.db.prepare(`
        SELECT device_id FROM devices 
        WHERE ingest_tier = 'bridge' 
        ORDER BY created_at
      `).all();

      for (const device of currentDevices) {
        const existingBridge = activeBridges.find(b => b.deviceId === device.device_id);
        if (!existingBridge) {
          console.log(`[Worker:${workerId}] Detected new assigned device: ${device.device_id}. Initializing bridge...`);
          const email = device.account_email;
          let accountPage = accountPages.get(email);
          if (!accountPage) {
            accountPage = new AccountPage(email, device.account_password_ref, browserInstance);
            accountPages.set(email, accountPage);
          }

          const index = globalDevices.findIndex(d => d.device_id === device.device_id);
          const wsPort = baseWsPort; // Unified WS port

          const bridge = new CameraBridge(device, wsPort, accountPage);
          activeBridges.push(bridge);

          bridge.start().catch(err => {
            console.error(`[Worker:${workerId}] Error starting new camera bridge ${device.device_id}:`, err.message);
          });
        }
      }
    } catch (e) {
      console.error(`[Worker:${workerId}] Error during device polling:`, e.message);
    }
  }, 30000);
}

let isShuttingDown = false;
async function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker:${workerId}] Shutting down resources gracefully...`);

  for (const bridge of activeBridges) {
    try { await bridge.stop(); } catch (e) { }
  }

  for (const [email, accountPage] of accountPages) {
    try { await accountPage.close(); } catch (e) { }
  }

  if (browserInstance) {
    try { await browserInstance.close(); } catch (e) { }
    browserInstance = null;
  }

  if (sdkHttpServer) await new Promise(r => sdkHttpServer.close(() => r()));

  db.close();

  console.log(`[Worker:${workerId}] Graceful shutdown complete.`);
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());

boot().catch(err => {
  console.error(`[Worker:${workerId}] Boot error:`, err.message);
  shutdown(1);
});
