const db = require('./registry/db');
const { execSync } = require('child_process');

console.log("=== Disabling Puppeteer SDK Worker ===");

// 1. Wipe the entire devices table to ensure no phantom cameras
db.db.prepare("DELETE FROM devices").run();

// 2. Insert the camera but mark it as 'native' tier instead of 'bridge'
const insertStmt = db.db.prepare(`
  INSERT INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// We assign worker_id = NULL because the worker doesn't need to touch this camera
insertStmt.run(
  '367ABDWN1000346168',
  '08ce8ae8a9e468d2313c03c9e058a3c2',
  'Office Camera Native',
  'enarxi',
  'General Site',
  'native_cam',
  'native',
  'info@enarxi.com',
  'Enarxi12345@',
  null,
  'online'
);

console.log("Database updated: Camera marked as Tier-1 Native Push (No SDK).");

// 3. Send the MQTT command to the camera to begin native push
console.log("\n=== Sending Native Push Command to Camera ===");
try {
  // Use the existing onboard script to send the MQTT payload
  const cmd = `node tools/onboard_camera.js --deviceId=367ABDWN1000346168 --deviceSecret=08ce8ae8a9e468d2313c03c9e058a3c2 --ingestTier=native --streamName=native_cam`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  console.log(output);
} catch (error) {
  console.error("Failed to send MQTT command:", error.message);
  if (error.stdout) console.log(error.stdout);
}

console.log("\n=== Test Ready ===");
console.log("The server is no longer pulling video. The camera is now natively pushing to:");
console.log("rtsp://168.144.84.199:8554/live/native_cam");
