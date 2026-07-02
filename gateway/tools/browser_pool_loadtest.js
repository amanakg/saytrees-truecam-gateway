const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const numPages = parseInt(process.argv[2], 10) || 10;
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

// SDK HTTP Server on port 8003
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
  serveFile(filePath, res);
});

function getChromeMemoryWindows(browserPid) {
  return new Promise((resolve) => {
    // Find all chrome processes launched under our root browser PID or generally
    // Since Puppeteer launches a specific instance, we can list processes and filter by parent process ID (CommandLine or ParentProcessId)
    const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'chrome.exe'\\" | Select-Object ProcessId, ParentProcessId, @{Name='RAM_MB';Expression={[math]::round($_.WorkingSetSize / 1MB, 2)}} | ConvertTo-Json"`;
    
    exec(cmd, (err, stdout) => {
      if (err) {
        resolve(`Error fetching memory: ${err.message}`);
        return;
      }
      try {
        const list = JSON.parse(stdout);
        const processes = Array.isArray(list) ? list : [list].filter(x => x);
        
        // Filter processes that are descendants of our browserPid or browserPid itself
        // Let's build a map of parent PIDs
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
        myChromeProcs.forEach(p => {
          output += `  PID: ${p.ProcessId} (Parent: ${p.ParentProcessId}) -> ${p.RAM_MB} MB\n`;
        });
        output += `Total Memory consumed by this Chrome instance: ${totalMemory.toFixed(2)} MB\n`;
        output += `Average memory per page (N=${numPages}): ${(totalMemory / numPages).toFixed(2)} MB\n`;
        resolve(output);
      } catch (e) {
        resolve(`Raw output from PowerShell:\n${stdout}`);
      }
    });
  });
}

function getChromeMemoryLinux(browserPid) {
  return new Promise((resolve) => {
    // On Linux, use pgrep/ps to find children and sum RSS memory
    const cmd = `ps -o pid,ppid,rss,command -e | grep -E "chrome|chromium"`;
    exec(cmd, (err, stdout) => {
      if (err) {
        resolve(`Error fetching memory: ${err.message}`);
        return;
      }
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
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const browserPid = browser.process().pid;
    console.log(`[LoadTest] Headless browser launched. PID: ${browserPid}`);

    const pages = [];
    
    for (let i = 0; i < numPages; i++) {
      console.log(`[LoadTest] Opening page ${i + 1} of ${numPages}...`);
      const page = await browser.newPage();
      pages.push(page);
      
      // Auto-accept dialogs
      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });
      
      await page.goto('http://localhost:8003/', { waitUntil: 'networkidle2' });
      
      // Perform login to trigger SDK initialization
      await page.evaluate((acc, pwd) => {
        document.getElementById('login-account').value = acc;
        document.getElementById('login-password').value = pwd;
        document.getElementById('loginBtn').click();
      }, account, password);
      
      // Wait for login processing to complete
      await new Promise(r => setTimeout(r, 1000));
      
      console.log(`[LoadTest] Page ${i + 1} initialized.`);
    }

    console.log(`\n[LoadTest] All ${numPages} pages initialized. Waiting 10 seconds for memory to settle...`);
    await new Promise(r => setTimeout(r, 10000));

    console.log(`\n[LoadTest] Measuring memory usage...`);
    let memoryReport = '';
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
