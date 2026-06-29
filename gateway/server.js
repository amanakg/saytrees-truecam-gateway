const ws = require('ws');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  account: "info@enarxi.com",
  password: "Enarxi12345@",
  deviceId: "367ABDWN1000346168", // Enarxi_Cam1
  deviceSecret: "08ce8ae8a9e468d2313c03c9e058a3c2",
  streamUrl: "rtsp://168.144.84.199:8554/live/camera1_hd",
  wsPort: 8080
};

// Locate sdk_dist directory
let sdkPath = path.join(__dirname, '..', 'sdk_dist');
if (!fs.existsSync(sdkPath)) {
  sdkPath = path.join(__dirname, 'sdk_dist');
}
console.log(`[Gateway] Serving SDK static files from: ${sdkPath}`);

// Start HTTP Server to serve SDK static files
const sdkHttpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    
    let contentType = 'text/html';
    const ext = path.extname(filePath);
    if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.wasm') contentType = 'application/wasm';
    else if (ext === '.json') contentType = 'application/json';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

sdkHttpServer.listen(8000, () => {
  console.log('[Gateway] Local HTTP SDK server listening on port 8000');
});

// Start WebSocket Server
const wss = new ws.Server({ port: CONFIG.wsPort });
console.log(`[Gateway] WebSocket server listening on port ${CONFIG.wsPort}...`);

let ffmpegProcess = null;
let lastFrameTime = 0;
let watchdogInterval = null;

wss.on('connection', (socket) => {
  console.log('[Gateway] Browser player client connected!');
  lastFrameTime = Date.now();
  
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
  }
  
  // Start watchdog to monitor frame arrival (12s threshold)
  watchdogInterval = setInterval(() => {
    if (ffmpegProcess) {
      const idleTime = Date.now() - lastFrameTime;
      if (idleTime > 12000) {
        console.warn(`[Gateway] Stream frozen! No frames received for ${idleTime / 1000}s. Forcing reconnect...`);
        socket.close(); // Trigger socket close and subsequent reconnect
      }
    }
  }, 3000);
  
  socket.on('message', (message) => {
    // Check if the message is a text configuration JSON
    if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 123)) { // '{' is 123 in ascii
      try {
        const text = message.toString();
        const initData = JSON.parse(text);
        if (initData.type === 'init') {
          console.log(`[Gateway] Received init metadata:`, initData);
          
          // Determine codec format
          const isH265 = initData.enc && (initData.enc.includes('265') || initData.enc.includes('hevc') || initData.enc === 'hevc');
          const inputFormat = isH265 ? 'hevc' : 'h264';
          
          console.log(`[Gateway] Launching FFmpeg with input format: ${inputFormat}...`);
          
          // Clean up old FFmpeg if any
          if (ffmpegProcess) {
            ffmpegProcess.kill();
          }
          
          // Spawn FFmpeg to package and stream to MediaMTX
          const ffmpegPath = "C:\\Users\\chellakumarr\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe";
          
          const ffmpegArgs = [
            '-y',
            '-fflags', '+genpts',
            '-use_wallclock_as_timestamps', '1',
            '-f', inputFormat,
            '-i', 'pipe:0',
            '-c:v', 'copy',
            '-f', 'rtsp',
            '-rtsp_transport', 'tcp',
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
            console.log(`[Gateway] FFmpeg process closed with code ${code}`);
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
      ffmpegProcess.kill();
      ffmpegProcess = null;
    }
    triggerReconnect();
  });
});

let currentBrowser = null;
let reconnectTimeout = null;
let isIntentionallyClosed = false;

function triggerReconnect() {
  if (reconnectTimeout) return;
  console.log('[Gateway] Scheduling stream reconnection in 5 seconds...');
  reconnectTimeout = setTimeout(async () => {
    try {
      reconnectTimeout = null;
      await launchAutomation();
    } catch (err) {
      console.error('[Gateway] Failed to relaunch automation:', err.message);
      triggerReconnect();
    }
  }, 5000);
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
    if (!isIntentionallyClosed) {
      triggerReconnect();
    }
  });
  
  const page = await browser.newPage();
  
  // Handle alerts / dialogs automatically so they don't block execution thread
  page.on('dialog', async (dialog) => {
    console.log(`[Browser Dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });

  // Expose configuration to browser page
  await page.evaluateOnNewDocument((config) => {
    window.__GATEWAY_CONFIG = config;
  }, CONFIG);

  // Navigate to local SDK site
  console.log('[Gateway] Navigating to H5 SDK portal http://localhost:8000/ ...');
  await page.goto('http://localhost:8000/', { waitUntil: 'networkidle2' });

  // Track page console logs
  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.text()}`);
  });

  // Automate Login and Connection
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

    // 7. Inject frame interceptor
    const ws = new WebSocket(`ws://localhost:${window.__GATEWAY_CONFIG.wsPort}`);
    ws.binaryType = 'arraybuffer';
    
    ws.onopen = () => {
      console.log('[Browser] WebSocket connection established.');
      
      const checkAndOverride = setInterval(() => {
        if (window.ConnectApi && window.ConnectApi.onrecvframeex) {
          const original = window.ConnectApi.onrecvframeex;
          let isInitSent = false;
          
          window.ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
            // video frame
            if (frametype === 1 || frametype === 2) {
              if (ws.readyState === WebSocket.OPEN) {
                if (!isInitSent) {
                  // Send init metadata JSON
                  ws.send(JSON.stringify({ type: 'init', enc: enc, width: width, height: height }));
                  isInitSent = true;
                }
                // Send raw binary frame
                ws.send(data);
              }
            }
            original.apply(this, arguments);
          };
          clearInterval(checkAndOverride);
          console.log('[Browser] Interceptor successfully overridden!');
        }
      }, 100);
    };

    // 8. Open Video stream after a small delay to allow connection handshake
    setTimeout(() => {
      console.log('[Browser] Opening video stream...');
      openvideo();
    }, 4000);
  });
}

// Start automation after websocket server is ready
setTimeout(launchAutomation, 2000);
