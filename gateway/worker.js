// worker.js
// Parameterized, shared-browser worker pool for Truecam cameras
// Refactored for Single Page Multi-Camera Architecture

const ws = require('ws');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
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
function serveFile(filePath, res) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    let contentType = 'text/html';
    const ext = path.extname(filePath);
    if (ext === '.js')   contentType = 'application/javascript';
    else if (ext === '.css')  contentType = 'text/css';
    else if (ext === '.wasm') contentType = 'application/wasm';
    else if (ext === '.json') contentType = 'application/json';
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  });
}

// Global servers - only bind if not already running on host
let sdkHttpServer = null;
let dashboardHttpServer = null;

function startHttpServers() {
  sdkHttpServer = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
    serveFile(filePath, res);
  });
  
  sdkHttpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Worker:${workerId}] Port 8000 already in use, assuming another worker is serving SDK static files.`);
    } else {
      console.error(`[Worker:${workerId}] SDK Server error:`, err.message);
    }
  });

  sdkHttpServer.listen(8000, () => {
    console.log(`[Worker:${workerId}] SDK HTTP server running on port 8000`);
  });

  dashboardHttpServer = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(dashboardPath, urlPath === '/' ? 'index.html' : urlPath);
    serveFile(filePath, res);
  });

  dashboardHttpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Worker:${workerId}] Port 9000 already in use, assuming another worker is serving Dashboard.`);
    } else {
      console.error(`[Worker:${workerId}] Dashboard Server error:`, err.message);
    }
  });

  dashboardHttpServer.listen(9000, () => {
    console.log(`[Worker:${workerId}] Dashboard served at http://localhost:9000/`);
  });
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
  } catch (e) {}

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
    this.page = null;
    this.isReady = false;
    this.initializationPromise = null;
  }

  async getReadyPage() {
    if (this.isReady && this.page && !this.page.isClosed()) {
      return this.page;
    }
    if (!this.initializationPromise) {
      this.initializationPromise = this.initPage();
    }
    await this.initializationPromise;
    return this.page;
  }

  async initPage() {
    console.log(`[AccountPage:${this.accountEmail}] Initializing shared page...`);
    try {
      this.page = await this.browser.newPage();
      
      this.page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      this.page.on('console', (msg) => {
        console.log(`[Browser] ${msg.text()}`);
      });
      this.page.on('pageerror', (err) => {
        console.error(`[Browser Error] ${err.toString()}`);
      });

      await this.page.evaluateOnNewDocument(() => {
        // Optimize Memory & CPU: Stub out rendering and audio
        try {
          window.requestAnimationFrame = (cb) => setTimeout(cb, 1000);
          window.cancelAnimationFrame = () => {};

          window.AudioContext = function() { 
            const stub = { 
              createMediaStreamSource: () => ({ connect: () => {} }), 
              createGain: () => ({ connect: () => {}, gain: { value: 1 } }),
              createScriptProcessor: () => ({ connect: () => {}, disconnect: () => {}, onaudioprocess: null }),
              createBufferSource: () => ({ connect: () => {}, start: () => {}, stop: () => {} }),
              createAnalyser: () => ({ connect: () => {} }),
              createBuffer: () => ({ duration: 0, length: 0, sampleRate: 44100, getChannelData: () => new Float32Array(0) }),
              decodeAudioData: () => Promise.resolve(),
              resume: () => Promise.resolve(),
              suspend: () => Promise.resolve(),
              close: () => Promise.resolve(),
              destination: {}
            }; 
            return new Proxy(stub, {
              get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop === 'string' && prop.startsWith('create')) {
                   return () => ({ connect: () => {} });
                }
                return undefined;
              }
            });
          };
          window.webkitAudioContext = window.AudioContext;
          window.RTCPeerConnection = null;
          window.RTCSessionDescription = null;

          const originalGetContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const ctx = originalGetContext.call(this, type, ...args);
            if (ctx) {
              if (type === '2d') {
                ctx.drawImage = () => {};
                ctx.putImageData = () => {};
              } else if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
                ctx.drawArrays = () => {};
                ctx.drawElements = () => {};
              }
            }
            return ctx;
          };
        } catch (e) {}
      });

      await this.page.goto('http://localhost:8000/', { waitUntil: 'networkidle2' });
      
      console.log(`[AccountPage:${this.accountEmail}] Running login sequence...`);
      await this.page.evaluate(async (acc, pwd) => {
        document.getElementById('login-account').value = acc;
        document.getElementById('login-password').value = pwd;
        document.getElementById('loginBtn').click();
        
        await new Promise((resolve) => {
          const interval = setInterval(() => {
            if (window.access_token) {
              clearInterval(interval);
              resolve();
            }
          }, 500);
        });
        
        // Wait for device list to load as a sign of full SDK readiness
        let loaded = false;
        while (!loaded) {
          try {
            await getDeviceList();
            loaded = true;
          } catch (err) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }

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

      }, this.accountEmail, this.accountPassword);

      this.isReady = true;
      console.log(`[AccountPage:${this.accountEmail}] Shared page is ready!`);
    } catch (err) {
      this.initializationPromise = null;
      throw err;
    }
  }

  async close() {
    if (this.page) {
      try { await this.page.close(); } catch (e) {}
    }
    this.isReady = false;
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

    this.logPrefix = `[${this.nickname}][Port:${this.wsPort}]`;
  }

  log(...args) { console.log(`${this.logPrefix}`, ...args); }
  warn(...args) { console.warn(`${this.logPrefix} [WARN]`, ...args); }
  error(...args) { console.error(`${this.logPrefix} [ERROR]`, ...args); }

  async start() {
    this.log('Starting bridge controller...');
    db.updateStatus(this.deviceId, 'connecting');
    
    this.setupWebSocketServer();
    await this.connectCameraInPage();
  }

  setupWebSocketServer() {
    this.wss = new ws.Server({ port: this.wsPort });
    this.log(`WebSocket server listening...`);

    this.wss.on('connection', (socket) => {
      this.activeSocket = socket;
      this.log('Browser SDK routed WS connection established!');
      this.lastFrameTime = Date.now();
      db.updateStatus(this.deviceId, 'connected', new Date().toISOString());

      if (this.watchdogInterval) clearInterval(this.watchdogInterval);

      this.watchdogInterval = setInterval(() => {
        const idleTime = Date.now() - this.lastFrameTime;
        const threshold = this.ffmpegProcess ? 5000 : 45000;
        if (idleTime > threshold) {
          this.warn(`Stream idle for ${idleTime / 1000}s. Triggering reconnect...`);
          clearInterval(this.watchdogInterval);
          this.watchdogInterval = null;
          
          this.killFfmpeg();
          this.triggerReconnect();
        }
      }, 1000);

      socket.on('message', (message) => {
        if (!this.firstMessageLogged) {
          this.firstMessageLogged = true;
          this.log(`First message received! Type: ${typeof message}, IsBuffer: ${Buffer.isBuffer(message)}, Byte0: ${message[0]}`);
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
              this.startFfmpeg(initData);
            }
          } catch (e) {}
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
    });
  }

  startFfmpeg(initData) {
    this.killFfmpeg();
    const isH265 = initData.enc && (initData.enc.includes('265') || initData.enc.includes('hevc'));
    const inputFormat = isH265 ? 'hevc' : 'h264';
    
    this.log(`Launching FFmpeg with format: ${inputFormat} -> RTSP: ${this.streamUrl}`);

    const ffmpegArgs = [
      '-y',
      '-fflags', '+genpts+discardcorrupt',
      '-use_wallclock_as_timestamps', '1',
      '-analyzeduration', '0',
      '-probesize', '32',
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
      } catch (e) {}
      this.ffmpegProcess = null;
    }
  }

  cleanupSession() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    this.killFfmpeg();
  }

  triggerReconnect() {
    if (this.isStopping || this.isReconnecting) return;
    if (this.reconnectTimeout) return;

    this.log('Scheduling reconnection in 2000ms...');
    db.updateStatus(this.deviceId, 'reconnecting');

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
    }, 2000);
  }

  async connectCameraInPage() {
    try {
      const page = await this.accountManager.getReadyPage();
      
      this.log('Injecting connection command into shared page...');
      await page.evaluate((devId, devSecret, wsPort) => {
        window.__wsConnections = window.__wsConnections || {};
        
        // Clean up previous connection for this device
        if (window.__wsConnections[devId]) {
          try { window.__wsConnections[devId].close(); } catch(e) {}
        }
        if (window.Player && window.Player.DisConnectDevice) {
          try { window.Player.DisConnectDevice(devId); } catch(e) {}
        }

        // Establish WS pipe for frames
        const wsUrl = `ws://localhost:${wsPort}`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        window.__wsConnections[devId] = ws;

        ws.onopen = () => {
          setTimeout(() => {
             if (typeof Player !== 'undefined' && Player.ConnectDevice) {
               Player.ConnectDevice(devId, "", "admin", devSecret, 0, 80, 0, 0, 1, "wss", window.onResolv);
               
               setTimeout(() => {
                  if (typeof Player !== 'undefined' && Player.OpenStream) {
                    Player.OpenStream(devId, "", 0, 1, 0);
                  }
               }, 3000);
             }
          }, 500);
        };
      }, this.deviceId, this.deviceSecret, this.wsPort);

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
      const page = await this.accountManager.getReadyPage();
      await page.evaluate((devId) => {
        if (window.__wsConnections && window.__wsConnections[devId]) {
          try { window.__wsConnections[devId].close(); } catch(e) {}
        }
        if (typeof Player !== 'undefined' && Player.DisConnectDevice) {
          try { Player.DisConnectDevice(devId); } catch(e) {}
        }
      }, this.deviceId);
    } catch(e) {}

    if (this.wss) {
      await new Promise((resolve) => this.wss.close(() => resolve()));
      this.wss = null;
    }
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

  console.log(`[Worker:${workerId}] Launching shared Puppeteer browser with memory optimizations...`);
  browserInstance = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-translate',
      '--disable-hang-monitor',
      '--mute-audio',
      '--disable-audio-output',
      '--js-flags=--max-old-space-size=64',
      '--renderer-process-limit=1'
    ]
  });

  browserInstance.on('disconnected', () => {
    console.warn(`[Worker:${workerId}] Shared Puppeteer browser disconnected! Shutting down...`);
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
    const wsPort = baseWsPort + (index >= 0 ? index : 0);

    const bridge = new CameraBridge(device, wsPort, accountPage);
    activeBridges.push(bridge);
    
    bridge.start().catch(err => {
      console.error(`[Worker:${workerId}] Error starting camera bridge ${device.device_id}:`, err.message);
    });

    await new Promise(r => setTimeout(r, 1000));
  }
}

let isShuttingDown = false;
async function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker:${workerId}] Shutting down resources gracefully...`);

  for (const bridge of activeBridges) {
    try { await bridge.stop(); } catch (e) {}
  }
  
  for (const [email, accountPage] of accountPages) {
    try { await accountPage.close(); } catch (e) {}
  }

  if (browserInstance) {
    try { await browserInstance.close(); } catch (e) {}
    browserInstance = null;
  }

  if (sdkHttpServer) await new Promise(r => sdkHttpServer.close(() => r()));
  if (dashboardHttpServer) await new Promise(r => dashboardHttpServer.close(() => r()));

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
