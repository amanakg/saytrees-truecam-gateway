const ws = require('ws');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Setup automatic file logger
const logFile = path.join(__dirname, 'gateway_cam2.log');
fs.writeFileSync(logFile, ''); // clear log on start
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function appendToLog(prefix, args) {
  const msg = args.map(arg => {
    if (arg instanceof Error) return arg.stack;
    return typeof arg === 'object' ? JSON.stringify(arg) : arg;
  }).join(' ');
  fs.appendFileSync(logFile, `[${new Date().toLocaleTimeString()}] ${prefix} ${msg}\n`);
}

console.log = function(...args) {
  originalLog.apply(console, args);
  appendToLog('[LOG]', args);
};
console.warn = function(...args) {
  originalWarn.apply(console, args);
  appendToLog('[WARN]', args);
};
console.error = function(...args) {
  originalError.apply(console, args);
  appendToLog('[ERROR]', args);
};

const CONFIG = {
  account: "info@enarxi.com",
  password: "Enarxi12345@",
  deviceId: "F14504WN1000345886", // Enarxi_Cam1
  deviceSecret: "1223093b8d7277ee7158841ae47d75a7",
  streamUrl: "rtsp://168.144.84.199:8554/live/devcamera2_hd",
  wsPort: 8080
};

// Locate sdk_dist directory
let sdkPath = path.join(__dirname, '..', 'sdk_dist');
if (!fs.existsSync(sdkPath)) {
  sdkPath = path.join(__dirname, 'sdk_dist');
}
console.log(`[Gateway] Serving SDK static files from: ${sdkPath}`);

// Locate dashboard directory
const dashboardPath = path.join(__dirname, '..', 'dashboard');

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

// SDK HTTP Server (port 8000) — serves SDK WASM/HTML for Puppeteer
const sdkHttpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
  serveFile(filePath, res);
});

sdkHttpServer.listen(8000, () => {
  console.log('[Gateway] SDK HTTP server on port 8000 (for Puppeteer)');
});

// Dashboard HTTP Server (port 9000) — serves the live camera dashboard UI
const dashboardHttpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(dashboardPath, urlPath === '/' ? 'index.html' : urlPath);
  serveFile(filePath, res);
});

dashboardHttpServer.listen(9000, () => {
  console.log('[Gateway] Dashboard available at → http://localhost:9000/');
});

// Start WebSocket Server
const wss = new ws.Server({ port: CONFIG.wsPort });
console.log(`[Gateway] WebSocket server listening on port ${CONFIG.wsPort}...`);

let isShuttingDown = false;
let startupTimeout = null;
let ffmpegProcess = null;
let lastFrameTime = 0;
let watchdogInterval = null;
let currentPage = null;
let isReconnecting = false;

wss.on('connection', (socket) => {
  console.log('[Gateway] Browser player client connected!');
  lastFrameTime = Date.now();
  
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
  }
  
  // Start watchdog to monitor frame arrival (3.5s threshold)
  watchdogInterval = setInterval(() => {
    if (ffmpegProcess) {
      const idleTime = Date.now() - lastFrameTime;
      if (idleTime > 3500) {
        console.warn(`[Gateway] Stream frozen! No frames received for ${idleTime / 1000}s. Forcing seamless reconnect...`);
        // Stop watchdog first to prevent re-entrant triggers
        clearInterval(watchdogInterval);
        watchdogInterval = null;
        // Kill stale FFmpeg and trigger seamless in-page reconnect directly
        // (avoids the 1.5s close→reconnect cycle going through socket.close)
        if (ffmpegProcess) {
          ffmpegProcess.stdin.end();
          ffmpegProcess.kill('SIGKILL');
          ffmpegProcess = null;
        }
        triggerReconnect();
      }
    }
  }, 1000);
  
  socket.on('message', (message) => {
    // Check if the message is a text configuration JSON
    if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 123)) { // '{' is 123 in ascii
      try {
        const text = message.toString();
        const initData = JSON.parse(text);
        if (initData.type === 'init') {
          console.log(`[Gateway] Received init metadata:`, initData);
          lastFrameTime = Date.now(); // Reset watchdog timer — init counts as stream activity
          
          // Determine codec format
          const isH265 = initData.enc && (initData.enc.includes('265') || initData.enc.includes('hevc') || initData.enc === 'hevc');
          const inputFormat = isH265 ? 'hevc' : 'h264';
          
          console.log(`[Gateway] Launching FFmpeg with input format: ${inputFormat}...`);
          
          // Clean up old FFmpeg if any
          if (ffmpegProcess) {
            ffmpegProcess.kill();
          }
          
          // Spawn FFmpeg to package and stream to MediaMTX
          let ffmpegPath = "C:\\Users\\chellakumarr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe";
          if (process.platform === 'linux') {
            ffmpegPath = 'ffmpeg';
          }
          
          const ffmpegArgs = [
            '-y',
            '-fflags', '+genpts+discardcorrupt', // discard corrupt packets from 4G drops
            '-use_wallclock_as_timestamps', '1',
            '-analyzeduration', '0',             // skip analysis delay, start faster
            '-probesize', '32',                  // minimal probe for low latency
            '-f', inputFormat,
            '-i', 'pipe:0',
            '-c:v', 'copy',
            '-max_muxing_queue_size', '1024',    // buffer during brief camera 4G drops
            '-f', 'rtsp',
            '-rtsp_transport', 'tcp',
            '-timeout', '5000000',               // 5s RTSP output timeout before FFmpeg errors
            CONFIG.streamUrl
          ];
          
          console.log(`[Gateway] Using zero-CPU copy mode for ${inputFormat} stream...`);
          
          ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
          
          ffmpegProcess.stdin.on('error', (err) => {
            console.error('[Gateway] FFmpeg stdin error:', err.message);
          });
          
          ffmpegProcess.stderr.on('data', (data) => {
            // Log FFmpeg output (usually bitrate/fps stats)
            console.log(`[FFmpeg] ${data.toString().trim()}`);
          });
          
          ffmpegProcess.on('close', (code) => {
            console.warn(`[Gateway] FFmpeg process exited (code=${code}). Stream to MediaMTX lost.`);
            // FFmpeg dying means the RTSP push to MediaMTX is gone.
            // The camera P2P may still be alive (so watchdog won't fire),
            // so we must proactively trigger a full reconnect here.
            if (ffmpegProcess) {
              ffmpegProcess = null;
            }
            console.log('[Gateway] FFmpeg died — triggering stream reconnect...');
            triggerReconnect();
          });
        }
      } catch (err) {
        // Not a valid JSON, ignore
      }
      return;
    }

    // Write binary video frame data to FFmpeg's standard input
    if (ffmpegProcess && ffmpegProcess.stdin.writable) {
      lastFrameTime = Date.now(); // Reset watchdog timer
      ffmpegProcess.stdin.write(message);
    }
  });

  socket.on('close', () => {
    console.log('[Gateway] Browser player client disconnected.');
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
    if (ffmpegProcess) {
      ffmpegProcess.stdin.end();
      ffmpegProcess.kill('SIGKILL');
      ffmpegProcess = null;
    }
    triggerReconnect();
  });
});

let currentBrowser = null;
let reconnectTimeout = null;
let isIntentionallyClosed = false;

function triggerReconnect() {
  if (isShuttingDown) return;
  if (isReconnecting || reconnectTimeout) return;
  console.log('[Gateway] Scheduling stream reconnection in 500ms...');
  reconnectTimeout = setTimeout(async () => {
    try {
      reconnectTimeout = null;
      await reconnectAutomation();
    } catch (err) {
      console.error('[Gateway] Failed to reconnect stream:', err.message);
      triggerReconnect();
    }
  }, 500);
}

async function reconnectAutomation() {
  if (isReconnecting) return;
  isReconnecting = true;
  console.log('[Gateway] Reconnecting P2P stream (in-page, seamless)...');
  
  try {
    if (currentPage && !currentPage.isClosed() && currentBrowser) {
      // Lightweight in-page reconnect: skip re-login and device-list steps
      // (already logged in and device already selected on this page).
      // Just disconnect P2P, reconnect, re-wire interceptor and open video.
      console.log('[Gateway] Using fast in-page reconnect (skip login/device steps)...');
      await runReconnectSequence(currentPage);
    } else {
      console.log('[Gateway] No live page found, performing full browser restart...');
      await launchAutomation();
    }
  } catch (err) {
    console.error('[Gateway] In-page reconnect failed, performing full browser restart:', err.message);
    await launchAutomation();
  } finally {
    isReconnecting = false;
  }
}

async function launchAutomation() {
  // Clean up any existing browser instance
  if (currentBrowser) {
    console.log('[Gateway] Closing existing browser instance...');
    try {
      isIntentionallyClosed = true;
      await currentBrowser.close();
    } catch (e) {
      console.error('[Gateway] Error closing existing browser:', e.message);
    }
    currentBrowser = null;
    currentPage = null;
  }

  console.log('[Gateway] Launching headless browser to start P2P stream...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  currentBrowser = browser;
  isIntentionallyClosed = false;

  // Handle crash or manual close of the browser process
  browser.on('disconnected', () => {
    console.log('[Gateway] Puppeteer browser process disconnected.');
    currentPage = null;
    if (!isIntentionallyClosed) {
      triggerReconnect();
    }
  });
  
  const page = await browser.newPage();
  currentPage = page;
  
  // Handle alerts / dialogs automatically so they don't block execution thread
  page.on('dialog', async (dialog) => {
    console.log(`[Browser Dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });

  // Expose configuration to browser page
  await page.evaluateOnNewDocument((config) => {
    window.__GATEWAY_CONFIG = config;
  }, CONFIG);

  // Track page console logs
  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.text()}`);
  });

  // Navigate to local SDK site
  console.log('[Gateway] Navigating to H5 SDK portal http://localhost:8000/ ...');
  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle2' });

  // Automate Login and Connection
  await runLoginSequence(page);
}

// Lightweight reconnect for watchdog recovery: skips login + device-list steps
// (already on the live page, already logged in, device already selected).
// Target total recovery time: watchdog(3.5s) + trigger(0.5s) + reconnect(~4s P2P) ≈ 8s
async function runReconnectSequence(page) {
  console.log('[Gateway] Running lightweight reconnect sequence...');
  await page.evaluate(async () => {
    // 1. Disconnect existing P2P session cleanly
    try { if (typeof disconnect === 'function') disconnect(); } catch(e) {}

    // 2. Tear down old gateway WS
    if (window.__gatewayWs && window.__gatewayWs.readyState !== WebSocket.CLOSED) {
      window.__gatewayWs.close();
      await new Promise(r => setTimeout(r, 150));
    }

    // 3. Brief settle before reconnect
    await new Promise(r => setTimeout(r, 300));

    // 4. Reconnect P2P (device/password/streamtype already set from last session)
    console.log('[Browser] [Reconnect] Calling connect()...');
    connect();

    // 5. Open fresh gateway WS + interceptor
    const ws = new WebSocket(`ws://localhost:${window.__GATEWAY_CONFIG.wsPort}`);
    ws.binaryType = 'arraybuffer';
    window.__gatewayWs = ws;

    ws.onerror = (e) => console.error('[Browser] [Reconnect] GW WS error!', e.type);
    ws.onclose = (e) => console.warn(`[Browser] [Reconnect] GW WS closed (code=${e.code})`);

    ws.onopen = () => {
      console.log('[Browser] [Reconnect] WS reconnected. Installing interceptor...');
      let isInitSent = false;
      const checkAndOverride = setInterval(() => {
        if (window.ConnectApi && window.ConnectApi.onrecvframeex) {
          const original = window.ConnectApi.onrecvframeex;
          window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
            if (frametype === 1 || frametype === 2) {
              if (ws.readyState === WebSocket.OPEN) {
                if (!isInitSent) {
                  ws.send(JSON.stringify({ type: 'init', enc: enc, width: width, height: height }));
                  isInitSent = true;
                  console.log('[Browser] [Reconnect] Init sent. Frames flowing.');
                }
                ws.send(data);
              }
            }
            original.apply(this, arguments);
          };
          clearInterval(checkAndOverride);
          console.log('[Browser] [Reconnect] Interceptor re-installed.');
        }
      }, 100);
    };

    // 6. Open video — 3000ms is enough for P2P reconnect on an existing warm session
    setTimeout(() => {
      console.log('[Browser] [Reconnect] Opening video stream...');
      openvideo();
    }, 3000);
  });
}

// Runs the FULL login+connect+intercept sequence on a given page.
// Used on cold start only.
async function runLoginSequence(page) {
  console.log('[Gateway] Performing login & connection sequence...');
  await page.evaluate(async () => {
    // 1. Fill account and password
    document.getElementById('login-account').value = window.__GATEWAY_CONFIG.account;
    document.getElementById('login-password').value = window.__GATEWAY_CONFIG.password;
    
    // 2. Click login button and wait for it to process
    console.log('[Browser] Submitting credentials...');
    document.getElementById('loginBtn').click();
    
    // Wait for the access_token variable to populate
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (window.access_token) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });

    console.log('[Browser] Login success. Retrieving device list...');
    
    // Retry loop for device list retrieval to prevent uncaught iterability crashes
    let deviceListLoaded = false;
    while (!deviceListLoaded) {
      try {
        await getDeviceList();
        
        const select = document.getElementById('dev_id');
        if (select && select.options.length > 0) {
          // Find option matching our deviceId
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value.includes(window.__GATEWAY_CONFIG.deviceId)) {
              select.selectedIndex = i;
              select.dispatchEvent(new Event('change'));
              deviceListLoaded = true;
              break;
            }
          }
        }
      } catch (err) {
        console.log('[Browser] Error or empty list, retrying in 2 seconds...');
      }
      
      if (!deviceListLoaded) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    // 4. Fill device password
    document.getElementById('pwd').value = window.__GATEWAY_CONFIG.deviceSecret;
    
    // 5. Select Main Stream (value = 1)
    document.getElementById('streamtype').value = "1";
    
    // 6. Connect to device
    console.log('[Browser] Connecting to device target...');
    connect();

    // 7. Inject frame interceptor.
    //    IMPORTANT: ConnectApi is a WASM/emscripten object. Object.defineProperty traps do NOT
    //    work — WASM calls callbacks via internal C function pointers, bypassing JS property
    //    descriptors entirely. The only working approach is a direct property assignment AFTER
    //    the SDK has set its final handler (which happens during P2P setup). The 4000ms
    //    openvideo delay below ensures P2P is complete and the interceptor is in place first.
    if (window.__gatewayWs && window.__gatewayWs.readyState !== WebSocket.CLOSED) {
      window.__gatewayWs.close();
      await new Promise(r => setTimeout(r, 150));
    }
    const ws = new WebSocket(`ws://localhost:${window.__GATEWAY_CONFIG.wsPort}`);
    ws.binaryType = 'arraybuffer';
    window.__gatewayWs = ws;

    ws.onerror = (e) => {
      console.error('[Browser] Gateway WebSocket error — cannot send frames to gateway!', e.type);
    };
    ws.onclose = (e) => {
      console.warn(`[Browser] Gateway WebSocket closed (code=${e.code}). Frames will stop flowing.`);
    };

    ws.onopen = () => {
      console.log('[Browser] WebSocket connection established. Starting interceptor poll...');

      let isInitSent = false;

      // Poll for ConnectApi.onrecvframeex then do a direct assignment override.
      // This works because WASM reads the JS property value at callback registration time
      // and stores it internally — so our wrapper becomes the stored callback.
      const checkAndOverride = setInterval(() => {
        if (window.ConnectApi && window.ConnectApi.onrecvframeex) {
          const original = window.ConnectApi.onrecvframeex;

          window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
            // video frame (frametype 1 = keyframe, 2 = inter-frame)
            if (frametype === 1 || frametype === 2) {
              if (ws.readyState === WebSocket.OPEN) {
                if (!isInitSent) {
                  ws.send(JSON.stringify({ type: 'init', enc: enc, width: width, height: height }));
                  isInitSent = true;
                  console.log('[Browser] Init metadata sent. Frame forwarding active.');
                }
                ws.send(data);
              }
            }
            original.apply(this, arguments);
          };

          clearInterval(checkAndOverride);
          console.log('[Browser] Interceptor successfully installed on ConnectApi.onrecvframeex.');
        }
      }, 100);
    };

    // 8. Open video after 4000ms — gives P2P time to fully connect and the interceptor
    //    poll time to find and replace ConnectApi.onrecvframeex before frames start flowing.
    //    Safe w.r.t. watchdog: watchdog only activates after FFmpeg starts (post-init message).
    setTimeout(() => {
      console.log('[Browser] Opening video stream...');
      openvideo();
    }, 4000);
  });
}

// Start automation after websocket server is ready
startupTimeout = setTimeout(launchAutomation, 2000);

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[Gateway] Shutdown signal received. Cleaning up resources...');

  // 1. Clear all timers
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }

  // 2. Terminate FFmpeg
  if (ffmpegProcess) {
    console.log('[Gateway] Stopping FFmpeg process...');
    try {
      ffmpegProcess.stdin.end();
      ffmpegProcess.kill('SIGTERM');
    } catch (e) {
      console.error('[Gateway] Error stopping FFmpeg:', e.message);
    }
    ffmpegProcess = null;
  }

  // 3. Close Puppeteer Browser
  if (currentBrowser) {
    console.log('[Gateway] Closing Puppeteer browser...');
    try {
      await currentBrowser.close();
    } catch (e) {
      console.error('[Gateway] Error closing Puppeteer browser:', e.message);
    }
    currentBrowser = null;
    currentPage = null;
  }

  // 4. Close WebSocket Server
  if (wss) {
    console.log('[Gateway] Closing WebSocket server...');
    await new Promise((resolve) => wss.close(() => resolve()));
  }

  // 5. Close HTTP Servers
  if (sdkHttpServer) {
    console.log('[Gateway] Closing SDK HTTP server...');
    await new Promise((resolve) => sdkHttpServer.close(() => resolve()));
  }
  if (typeof dashboardHttpServer !== 'undefined' && dashboardHttpServer) {
    console.log('[Gateway] Closing Dashboard HTTP server...');
    await new Promise((resolve) => dashboardHttpServer.close(() => resolve()));
  }

  console.log('[Gateway] Shutdown complete.');
}

// Signal Listeners
process.on('SIGTERM', async () => {
  console.log('[Gateway] Received SIGTERM.');
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Gateway] Received SIGINT (Ctrl+C).');
  await shutdown();
  process.exit(0);
});
