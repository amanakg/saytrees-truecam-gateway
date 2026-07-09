const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const numCameras = parseInt(process.argv[2], 10) || 10;
const account = process.argv[3] || "info@enarxi.com";
const password = process.argv[4] || "Enarxi12345@";

const sdkPath = path.join(__dirname, '..', '..', 'sdk_dist');
console.log(`[LoadTest] Serving SDK static files from: ${sdkPath}`);

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

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
  serveFile(filePath, res);
});

function getChromeMemoryWindows(browserPid) {
  return new Promise((resolve) => {
    const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe'\\" | Select-Object ProcessId, ParentProcessId, @{Name='RAM_MB';Expression={[math]::round($_.WorkingSetSize / 1MB, 2)}} | ConvertTo-Json"`;
    exec(cmd, (err, stdout) => {
      if (err) { resolve(`Error fetching memory: ${err.message}`); return; }
      try {
        const list = JSON.parse(stdout);
        const processes = Array.isArray(list) ? list : [list].filter(x => x);
        
        const childPids = new Set([browserPid]);
        let added = true;
        while (added) {
          added = false;
          for (const proc of processes) {
            if (proc && proc.ParentProcessId && childPids.has(proc.ParentProcessId) && !childPids.has(proc.ProcessId)) {
              childPids.add(proc.ProcessId);
              added = true;
            }
          }
        }
        
        const myChromeProcs = processes.filter(p => p && childPids.has(p.ProcessId));
        const totalMemory = myChromeProcs.reduce((sum, p) => sum + p.RAM_MB, 0);
        
        let output = `Active Chrome Processes for this browser instance (Root PID: ${browserPid}):\n`;
        myChromeProcs.forEach(p => { output += `  PID: ${p.ProcessId} (Parent: ${p.ParentProcessId}) -> ${p.RAM_MB} MB\n`; });
        output += `Total Memory consumed by this Chrome instance: ${totalMemory.toFixed(2)} MB\n`;
        output += `Average memory per camera (N=${numCameras}): ${(totalMemory / numCameras).toFixed(2)} MB\n`;
        resolve(output);
      } catch (e) { resolve(`Raw output from PowerShell:\n${stdout}`); }
    });
  });
}

function getChromeMemoryLinux(browserPid) {
  return new Promise((resolve) => {
    const cmd = `ps -o pid,ppid,rss,command -e | grep -E "chrome|chromium"`;
    exec(cmd, (err, stdout) => {
      if (err) { resolve(`Error fetching memory: ${err.message}`); return; }
      resolve(`Raw ps output:\n${stdout}`);
    });
  });
}

server.listen(8003, async () => {
  console.log('[LoadTest] SDK HTTP server listening on port 8003');
  
  let browser;
  try {
    console.log(`[LoadTest] Launching single Puppeteer browser instance...`);
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer',
        '--disable-extensions', '--disable-background-networking', '--disable-default-apps',
        '--disable-sync', '--no-first-run', '--no-default-browser-check',
        '--disable-translate', '--disable-hang-monitor', '--mute-audio',
        '--disable-audio-output', '--js-flags=--max-old-space-size=64',
        '--renderer-process-limit=1'
      ]
    });

    const browserPid = browser.process().pid;
    console.log(`[LoadTest] Headless browser launched. PID: ${browserPid}`);

    console.log(`[LoadTest] Creating single shared page...`);
    const page = await browser.newPage();
    console.log(`[LoadTest] Page created. Setting up dialog handler...`);
    page.on('dialog', async (dialog) => { await dialog.accept(); });
    page.on('console', msg => console.log(`[Browser] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[Browser Error] ${err.message}`));

    
    console.log(`[LoadTest] Adding evaluateOnNewDocument stubs...`);
    // Stub Rendering & Audio
    await page.evaluateOnNewDocument(() => {
      window.requestAnimationFrame = (cb) => setTimeout(cb, 1000);
      window.AudioContext = function() { 
        const dummyNode = new Proxy({
          getChannelData: () => new Float32Array(0)
        }, { 
          get: (target, prop) => prop in target ? target[prop] : () => dummyNode 
        });
        return new Proxy({
          state: 'running',
          destination: dummyNode,
          decodeAudioData: () => Promise.resolve(),
          close: () => Promise.resolve(),
          suspend: () => Promise.resolve(),
          resume: () => Promise.resolve()
        }, {
          get: (target, prop) => prop in target ? target[prop] : () => dummyNode
        });
      };
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        const ctx = originalGetContext.call(this, type, ...args);
        if (ctx && type === '2d') { ctx.drawImage = () => {}; ctx.putImageData = () => {}; }
        return ctx;
      };
    });

    console.log(`[LoadTest] Navigating to http://localhost:8003/...`);
    await page.goto('http://localhost:8003/', { waitUntil: 'networkidle2', timeout: 60000 });
    
    console.log(`[LoadTest] Navigation complete. Running login sequence...`);
    // Login
    try {
      await page.evaluate(async (acc, pwd) => {
        document.getElementById('login-account').value = acc;
        document.getElementById('login-password').value = pwd;
        document.getElementById('loginBtn').click();
        
        await new Promise((resolve, reject) => {
          let attempts = 0;
          const i = setInterval(() => {
            if (window.access_token) { clearInterval(i); resolve(); }
            if (++attempts > 40) { clearInterval(i); reject(new Error('Timeout waiting for access_token')); }
          }, 500);
        });
        
        window.__wsConnections = {};
        const interval = setInterval(() => {
          if (window.ConnectApi && window.ConnectApi.onrecvframeex) {
            window.ConnectApi.onrecvframeex = function () {};
            clearInterval(interval);
          }
        }, 100);
      }, account, password);
    } catch (err) {
      console.error('[LoadTest] Login evaluate failed:', err.message);
      throw err;
    }
    console.log(`[LoadTest] Login successful. Shared page is ready.`);

    // Simulate connecting cameras sequentially
    for (let i = 0; i < numCameras; i++) {
      const simulatedDeviceId = `simulated_cam_${i}`;
      console.log(`[LoadTest] Connecting simulated camera ${i + 1} of ${numCameras} (${simulatedDeviceId})...`);
      
      await page.evaluate((devId) => {
        // Just call the SDK to create a session.
        // We pass fake credentials and IP, but this forces the SDK to allocate decoder structures.
        if (window.Player && window.Player.ConnectDevice) {
           window.Player.ConnectDevice(devId, "127.0.0.1", "admin", "fake_password", 0, 80, 0, 0, 1, "wss", null);
        }
      }, simulatedDeviceId);
      
      // Wait to prevent massive CPU spike
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n[LoadTest] All ${numCameras} cameras connecting in one page. Waiting 15 seconds for memory to settle...`);
    await new Promise(r => setTimeout(r, 15000));

    console.log(`\n[LoadTest] Measuring memory usage...`);
    let memoryReport = '';
    
    // Check detailed metrics from Puppeteer
    const metrics = await page.metrics();
    console.log(`[Puppeteer Page Metrics] JSHeapUsedSize: ${(metrics.JSHeapUsedSize / 1048576).toFixed(2)} MB`);

    if (process.platform === 'win32') {
      memoryReport = await getChromeMemoryWindows(browserPid);
    } else {
      memoryReport = await getChromeMemoryLinux(browserPid);
    }
    console.log(memoryReport);

  } catch (err) {
    console.error('[LoadTest] Error during load test:', err.message);
  } finally {
    if (browser) {
      console.log('[LoadTest] Closing Puppeteer browser...');
      await browser.close();
    }
    server.close(() => {
      console.log('[LoadTest] Server closed. Done.');
    });
  }
});
