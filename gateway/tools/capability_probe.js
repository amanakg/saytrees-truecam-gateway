const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Read command line arguments or use defaults
const account = process.argv[2] || "info@enarxi.com";
const password = process.argv[3] || "Camtest123@";
const targetDeviceId = process.argv[4] || "367ABDWN1000346168"; // Default to Camera 1

const sdkPath = path.join(__dirname, '..', '..', 'sdk_dist');
console.log(`[Probe] Serving SDK static files from: ${sdkPath}`);

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

// SDK HTTP Server on port 8002 (to avoid conflicting with running gateways)
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(sdkPath, urlPath === '/' ? 'index.html' : urlPath);
  serveFile(filePath, res);
});

server.listen(8002, async () => {
  console.log('[Probe] SDK HTTP server listening on port 8002');
  
  let browser;
  try {
    console.log('[Probe] Launching Playwright Chromium...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Auto-accept all alerts/dialogs
    page.on('dialog', async (dialog) => {
      console.log(`[Probe Dialog Alert]: ${dialog.message()}`);
      await dialog.accept();
    });

    page.on('console', msg => {
      console.log(`[Browser Console]: ${msg.text()}`);
    });

    console.log('[Probe] Navigating to http://localhost:8002/ ...');
    await page.goto('http://localhost:8002/', { waitUntil: 'domcontentloaded' });

    console.log('[Probe] Logging in with account:', account);
    const loginResult = await page.evaluate(async ({ acc, pwd }) => {
      document.getElementById('login-account').value = acc;
      document.getElementById('login-password').value = pwd;
      try {
        const token = await window.ConnectApi.userLogin(acc, pwd);
        console.log('[Browser] ConnectApi.userLogin succeeded, token:', token);
        window.access_token = token;
        return { success: true, token: token };
      } catch (err) {
        console.error('[Browser] ConnectApi.userLogin failed:', err);
        return { success: false, error: err.msg || err.message || JSON.stringify(err) };
      }
    }, { acc: account, pwd: password });

    console.log('[Probe] Login attempt result:', JSON.stringify(loginResult, null, 2));
    const deviceResult = await page.evaluate(async () => {
      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        try {
          let res = await window.ConnectApi.getDeviceList();
          console.log('[Browser] ConnectApi.getDeviceList result:', JSON.stringify(res));
          if (res && res.data && res.data.data && Array.isArray(res.data.data.list)) {
            // Populate select box if devices exist
            await getDeviceList();
            return { success: true, list: res.data.data.list, raw: res };
          }
        } catch (e) {
          console.error('[Browser] Error calling getDeviceList:', e.message);
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      return { success: false, error: 'Timeout or empty device list from Tuya Cloud' };
    });

    console.log('[Probe] Device list fetch result:', JSON.stringify(deviceResult, null, 2));

    // Check if device select list has option
    const devices = await page.evaluate(() => {
      const select = document.getElementById('dev_id');
      const list = [];
      for (let i = 0; i < select.options.length; i++) {
        list.push({
          value: select.options[i].value,
          text: select.options[i].text
        });
      }
      return list;
    });

    console.log('[Probe] Devices found in account:', devices);

    const hasTarget = devices.some(d => d.text.includes(targetDeviceId));
    if (!hasTarget) {
      console.warn(`[Probe] Target device ${targetDeviceId} not found in the account device list. Probing the first available device instead.`);
    }

    const deviceToProbe = hasTarget ? targetDeviceId : (devices[0] ? devices[0].text : null);
    if (!deviceToProbe) {
      throw new Error("No devices available in the account.");
    }

    console.log(`[Probe] Querying getDeviceModal for device: ${deviceToProbe}`);
    const modalResult = await page.evaluate(async (devId) => {
      const res = await window.ConnectApi.getDeviceModal(devId);
      return res;
    }, deviceToProbe);

    console.log('[Probe] Received capability model successfully!');
    
    const productFun = modalResult.data.data.productFun;
    // Pretty print capability model
    const filePath = path.join(__dirname, '..', `capabilities_${deviceToProbe}.json`);
    fs.writeFileSync(filePath, JSON.stringify(productFun, null, 2), 'utf8');
    console.log(`[Probe] Full capability set written to: ${filePath}`);

    // Filter and print RTMP client properties specifically
    console.log('\n--- RTMP Client Properties Found ---');
    const rtmpProps = productFun.filter(p => 
      (p.propertyName && p.propertyName.toLowerCase().includes('rtmp')) ||
      (p.funCode && p.funCode.toLowerCase().includes('rtmp')) ||
      (p.funName && p.funName.toLowerCase().includes('rtmp'))
    );
    if (rtmpProps.length > 0) {
      console.log(JSON.stringify(rtmpProps, null, 2));
    } else {
      console.log('No properties containing "rtmp" found in capabilities model.');
    }

    // Filter and print Audio Input properties
    console.log('\n--- Audio Input Properties Found ---');
    const audioProps = productFun.filter(p => 
      (p.propertyName && p.propertyName.toLowerCase().includes('audio')) ||
      (p.funCode && p.funCode.toLowerCase().includes('audio')) ||
      (p.funName && p.funName.toLowerCase().includes('audio'))
    );
    console.log(JSON.stringify(audioProps, null, 2));

  } catch (err) {
    console.error('[Probe] Error occurred during probe:', err.message);
  } finally {
    if (browser) {
      console.log('[Probe] Closing browser...');
      await browser.close();
    }
    server.close(() => {
      console.log('[Probe] HTTP Server stopped. Done.');
    });
  }
});
