const fs = require('fs');
const path = require('path');
const db = require('../registry/db');

async function syncAccount(accountEmail, accountPasswordRef, clientId) {
  const { default: puppeteer } = await import('puppeteer');
  console.log(`[Sync] Starting sync for account: ${accountEmail}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    console.log('[Sync] Navigating to TrueCam web portal (Local SDK)...');
    await page.goto('http://localhost:8000/', { waitUntil: 'networkidle2' });

    console.log('[Sync] Logging in...');
    await page.evaluate(async (acc, pwd) => {
      document.getElementById('login-account').value = acc;
      document.getElementById('login-password').value = pwd;
      document.getElementById('loginBtn').click();
    }, accountEmail, accountPasswordRef);

    console.log('[Sync] Waiting for authentication...');
    await page.waitForFunction(() => window.access_token !== undefined && window.access_token !== null, { timeout: 15000 });
    
    console.log('[Sync] Fetching device list...');
    await page.evaluate(async () => {
      let loaded = false;
      while (!loaded) {
        try {
          await getDeviceList();
          const select = document.getElementById('dev_id');
          if (select && select.options.length > 0) {
            loaded = true;
          }
        } catch (e) {
          // ignore and retry
        }
        if (!loaded) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    });

    const devices = await page.evaluate(() => {
      const select = document.getElementById('dev_id');
      const list = [];
      for (let i = 0; i < select.options.length; i++) {
        list.push({
          deviceId: select.options[i].value,
          nickname: select.options[i].text
        });
      }
      return list;
    });

    console.log(`[Sync] Found ${devices.length} devices tied to account.`);

    let syncedCount = 0;
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      console.log(`[Sync] Upserting device: ${d.nickname} (${d.deviceId})`);
      
      const streamName = `devcamera${i + 1}_hd`; // Simple mapping for demo

      db.upsertDevice({
        deviceId: d.deviceId,
        deviceSecret: 'unknown_secret', // Secret is unavailable via this scraping method
        nickname: d.nickname,
        clientId: clientId,
        siteName: 'Auto Synced Site',
        streamName: streamName,
        ingestTier: 'bridge',
        accountEmail: accountEmail,
        accountPasswordRef: accountPasswordRef,
        workerId: 'worker1', // Assign to worker1 by default
        status: 'offline'
      });
      syncedCount++;
    }

    console.log(`[Sync] Successfully synced ${syncedCount} cameras to local DB!`);

  } catch (err) {
    console.error('[Sync] Error during sync process:', err.message);
  } finally {
    await browser.close();
  }
}

// CLI Execution
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
};

const email = getArg('email');
const password = getArg('password');
const clientId = getArg('clientId') || 'enarxi';

if (!email || !password) {
  console.log("Usage: node auto_sync_account.js --email=USER@DOMAIN.COM --password=YOUR_PASSWORD [--clientId=enarxi]");
  process.exit(1);
}

syncAccount(email, password, clientId);
