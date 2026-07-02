// worker.js
// Parameterized, shared-browser worker pool for Truecam cameras

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

console.log(`[Worker:${workerId}] Booting worker pool...`);

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
  // Try to find winget Gyan.FFmpeg installation dynamically on Windows
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

  // Fallback to absolute developer path
  return "C:\\Users\\chellakumarr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe";
}

const ffmpegPath = getFfmpegPath();
console.log(`[Worker:${workerId}] Using FFmpeg binary: ${ffmpegPath}`);

/**
 * CameraBridge Class handles the lifecycle of a single camera stream.
 */
class CameraBridge {
  constructor(device, wsPort) {
    this.deviceId = device.device_id;
    this.deviceSecret = device.device_secret;
    this.nickname = device.nickname || device.device_id;
    this.accountEmail = device.account_email;
    this.accountPassword = device.account_password_ref;
    // Derive stream URL
    this.streamUrl = `rtsp://168.144.84.199:8554/live/${device.stream_name}`;
    this.wsPort = wsPort;

    this.wss = null;
    this.ffmpegProcess = null;
    this.watchdogInterval = null;
    this.lastFrameTime = 0;
    this.lastDbUpdateTime = 0;
    this.reconnectTimeout = null;
    this.page = null;
    this.browserContext = null;
    this.isReconnecting = false;
    this.isStopping = false;

    this.logPrefix = `[${this.nickname}][Port:${this.wsPort}]`;
  }

  log(...args) {
    console.log(`${this.logPrefix}`, ...args);
  }

  warn(...args) {
    console.warn(`${this.logPrefix} [WARN]`, ...args);
  }

  error(...args) {
    console.error(`${this.logPrefix} [ERROR]`, ...args);
  }

  async start(browser) {
    this.log('Starting bridge...');
    db.updateStatus(this.deviceId, 'connecting');
    
    // 1. Start WebSocket Server
    this.setupWebSocketServer();

    // 2. Launch Puppeteer Page
    await this.launchPage(browser);
  }

  setupWebSocketServer() {
    this.wss = new ws.Server({ port: this.wsPort });
    this.log(`WebSocket server listening...`);

    this.wss.on('connection', (socket) => {
      this.log('Browser SDK page connected to WS!');
      this.lastFrameTime = Date.now();
      db.updateStatus(this.deviceId, 'connected', new Date().toISOString());

      if (this.watchdogInterval) {
        clearInterval(this.watchdogInterval);
      }

      // Watchdog: 15s startup window, 3.5s active streaming
      this.watchdogInterval = setInterval(() => {
        const idleTime = Date.now() - this.lastFrameTime;
        const threshold = this.ffmpegProcess ? 3500 : 15000;
        if (idleTime > threshold) {
          this.warn(`Stream idle for ${idleTime / 1000}s. Triggering reconnect...`);
          clearInterval(this.watchdogInterval);
          this.watchdogInterval = null;
          
          this.killFfmpeg();
          this.triggerReconnect();
        }
      }, 1000);

      socket.on('message', (message) => {
        // Detect text config message
        if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 123)) { // '{' is 123
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
          } catch (e) {
            // ignore JSON parse errors
          }
          return;
        }

        // Forward binary frame to FFmpeg standard input
        if (this.ffmpegProcess && this.ffmpegProcess.stdin.writable) {
          this.lastFrameTime = Date.now();
          this.ffmpegProcess.stdin.write(message);

          // Throttled database update for frame arrival (every 30 seconds)
          const now = Date.now();
          if (now - this.lastDbUpdateTime > 30000) {
            db.updateStatus(this.deviceId, 'connected', new Date().toISOString());
            this.lastDbUpdateTime = now;
          }
        }
      });

      socket.on('close', () => {
        this.log('Browser SDK page disconnected.');
        this.cleanupSession();
        this.triggerReconnect();
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

    this.ffmpegProcess.on('error', (err) => {
      this.error(`FFmpeg process failed to spawn: ${err.message}`);
      this.ffmpegProcess = null;
      this.triggerReconnect();
    });

    this.ffmpegProcess.stdin.on('error', (err) => {
      this.error(`FFmpeg stdin error: ${err.message}`);
    });

    this.ffmpegProcess.stderr.on('data', (data) => {
      // Log FFmpeg statistics lines
      const msg = data.toString().trim();
      if (msg.includes('fps=') || msg.includes('speed=')) {
        // optionally throttle logging
      } else {
        this.log(`[FFmpeg] ${msg}`);
      }
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
        await this.reconnectAutomation();
      } catch (err) {
        this.error(`Reconnection automation failed: ${err.message}`);
        this.triggerReconnect();
      }
    }, 2000);
  }

  async reconnectAutomation() {
    if (this.isStopping || this.isReconnecting) return;
    this.isReconnecting = true;

    try {
      if (this.page && !this.page.isClosed()) {
        this.log('Using fast in-page reconnect...');
        await this.runReconnectSequence();
      } else {
        this.log('Restarting browser tab...');
        await this.restartTab();
      }
    } catch (err) {
      this.error(`In-page reconnect failed, restarting tab: ${err.message}`);
      await this.restartTab();
    } finally {
      this.isReconnecting = false;
    }
  }

  async restartTab() {
    if (this.page) {
      try { await this.page.close(); } catch(e) {}
      this.page = null;
    }
    if (this.browserContext) {
      try { await this.browserContext.close(); } catch(e) {}
      this.browserContext = null;
    }

    this.log('Opening new isolated browser tab...');
    // Create incognito context for session isolation
    const browser = this.globalBrowser;
    try {
      this.browserContext = await browser.createBrowserContext();
    } catch (e) {
      try {
        this.browserContext = await browser.createIncognitoBrowserContext();
      } catch (err) {
        this.browserContext = browser;
      }
    }

    this.page = await this.browserContext.newPage();
    
    // Auto-accept alerts
    this.page.on('dialog', async (dialog) => {
      this.log(`Dialog intercepted: ${dialog.message()}`);
      await dialog.accept();
    });

    // Expose config to page
    const config = {
      account: this.accountEmail,
      password: this.accountPassword,
      deviceId: this.deviceId,
      deviceSecret: this.deviceSecret,
      wsPort: this.wsPort
    };
    await this.page.evaluateOnNewDocument((cfg) => {
      window.__GATEWAY_CONFIG = cfg;
      
      // Optimize CPU: Stub out canvas drawing context to skip GPU/CPU rendering overhead in headless Chrome
      try {
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
    }, config);

    this.page.on('console', (msg) => {
      this.log(`[Browser Console] ${msg.text()}`);
    });

    await this.page.goto('http://localhost:8000/', { waitUntil: 'networkidle2' });
    await this.runLoginSequence();
  }

  async runLoginSequence() {
    this.log('Running login & connection sequence...');
    await this.page.evaluate(async () => {
      document.getElementById('login-account').value = window.__GATEWAY_CONFIG.account;
      document.getElementById('login-password').value = window.__GATEWAY_CONFIG.password;
      
      console.log('[Browser] Submitting credentials...');
      document.getElementById('loginBtn').click();
      
      // Wait for token
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          if (window.access_token) {
            clearInterval(interval);
            resolve();
          }
        }, 500);
      });

      console.log('[Browser] Login success. Retrieving device list...');
      let loaded = false;
      while (!loaded) {
        try {
          await getDeviceList();
          const select = document.getElementById('dev_id');
          if (select && select.options.length > 0) {
            for (let i = 0; i < select.options.length; i++) {
              if (select.options[i].value.includes(window.__GATEWAY_CONFIG.deviceId)) {
                select.selectedIndex = i;
                select.dispatchEvent(new Event('change'));
                loaded = true;
                break;
              }
            }
          }
        } catch (err) {}
        if (!loaded) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      document.getElementById('pwd').value = window.__GATEWAY_CONFIG.deviceSecret;
      document.getElementById('streamtype').value = "1"; // Main Stream

      console.log('[Browser] Connecting to device target...');
      connect();

      // Open WS
      if (window.__gatewayWs && window.__gatewayWs.readyState !== WebSocket.CLOSED) {
        window.__gatewayWs.close();
      }
      const wsUrl = `ws://localhost:${window.__GATEWAY_CONFIG.wsPort}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      window.__gatewayWs = ws;

      ws.onopen = () => {
        console.log('[Browser] WebSocket connected. Installing interceptor...');
        let isInitSent = false;
        const interval = setInterval(() => {
          if (window.ConnectApi && window.ConnectApi.onrecvframeex) {
            const original = window.ConnectApi.onrecvframeex;
            window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
              if (frametype === 1 || frametype === 2) {
                if (ws.readyState === WebSocket.OPEN) {
                  if (!isInitSent) {
                    ws.send(JSON.stringify({ type: 'init', enc: enc, width: width, height: height, fps: fps }));
                    isInitSent = true;
                    console.log('[Browser] Init metadata sent.');
                  }
                  ws.send(data);
                }
              }
              original.apply(this, arguments);
            };
            clearInterval(interval);
            console.log('[Browser] Interceptor successfully installed.');
          }
        }, 100);
      };

      setTimeout(() => {
        console.log('[Browser] Opening video stream...');
        openvideo();
      }, 4000);
    });
  }

  async runReconnectSequence() {
    await this.page.evaluate(async () => {
      try { if (typeof disconnect === 'function') disconnect(); } catch(e) {}
      if (window.__gatewayWs && window.__gatewayWs.readyState !== WebSocket.CLOSED) {
        window.__gatewayWs.close();
        await new Promise(r => setTimeout(r, 150));
      }
      await new Promise(r => setTimeout(r, 300));
      
      console.log('[Browser] Reconnecting P2P...');
      connect();

      const wsUrl = `ws://localhost:${window.__GATEWAY_CONFIG.wsPort}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      window.__gatewayWs = ws;

      ws.onopen = () => {
        let isInitSent = false;
        const interval = setInterval(() => {
          if (window.ConnectApi && window.ConnectApi.onrecvframeex) {
            const original = window.ConnectApi.onrecvframeex;
            window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
              if (frametype === 1 || frametype === 2) {
                if (ws.readyState === WebSocket.OPEN) {
                  if (!isInitSent) {
                    ws.send(JSON.stringify({ type: 'init', enc: enc, width: width, height: height, fps: fps }));
                    isInitSent = true;
                  }
                  ws.send(data);
                }
              }
              original.apply(this, arguments);
            };
            clearInterval(interval);
          }
        }, 100);
      };

      setTimeout(() => {
        openvideo();
      }, 3000);
    });
  }

  async launchPage(browser) {
    this.globalBrowser = browser;
    await this.restartTab();
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

    if (this.page) {
      try { await this.page.close(); } catch(e) {}
      this.page = null;
    }
    if (this.browserContext) {
      try { await this.browserContext.close(); } catch(e) {}
      this.browserContext = null;
    }

    if (this.wss) {
      await new Promise((resolve) => this.wss.close(() => resolve()));
      this.wss = null;
    }
  }
}

// Initialize and boot bridge array
let browserInstance = null;
const activeBridges = [];

async function boot() {
  // Query all active bridge devices for this worker from the registry
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

  // Get index list of all bridge devices globally to derive deterministic WS ports
  const allBridgeGlobal = db.db.prepare(`
    SELECT device_id FROM devices 
    WHERE ingest_tier = 'bridge' 
    ORDER BY created_at
  `).all();

  // Start HTTP static servers (they bind safely once)
  startHttpServers();

  console.log(`[Worker:${workerId}] Launching shared Puppeteer browser...`);
  browserInstance = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  browserInstance.on('disconnected', () => {
    console.warn(`[Worker:${workerId}] Shared Puppeteer browser disconnected! Shutting down...`);
    shutdown(1);
  });

  // Start a bridge for each camera
  for (const device of allBridgeDevices) {
    // Derive deterministic port: baseWsPort + index in global list
    const index = allBridgeGlobal.findIndex(d => d.device_id === device.device_id);
    const wsPort = baseWsPort + (index >= 0 ? index : 0);

    const bridge = new CameraBridge(device, wsPort);
    activeBridges.push(bridge);
    
    // Launch bridge asynchronously (parallel tab startup)
    bridge.start(browserInstance).catch(err => {
      console.error(`[Worker:${workerId}] Error starting camera bridge ${device.device_id}:`, err.message);
    });

    // Small stagger delay between tab openings to prevent CPU thrashing
    await new Promise(r => setTimeout(r, 2000));
  }
}

let isShuttingDown = false;
async function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker:${workerId}] Shutting down resources gracefully...`);

  // Stop all camera bridges
  for (const bridge of activeBridges) {
    try {
      await bridge.stop();
    } catch (e) {
      console.error(`Error stopping bridge ${bridge.nickname}:`, e.message);
    }
  }

  // Close Puppeteer
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (e) {}
    browserInstance = null;
  }

  // Close HTTP servers
  if (sdkHttpServer) {
    await new Promise(r => sdkHttpServer.close(() => r()));
  }
  if (dashboardHttpServer) {
    await new Promise(r => dashboardHttpServer.close(() => r()));
  }

  // Close database connection
  db.close();

  console.log(`[Worker:${workerId}] Graceful shutdown complete.`);
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());

// Boot the worker
boot().catch(err => {
  console.error(`[Worker:${workerId}] Boot error:`, err.message);
  shutdown(1);
});
