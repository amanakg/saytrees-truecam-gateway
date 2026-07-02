// tools/onboard_camera.js
// Script to onboard a camera: queries capabilities, decides tier, sets settings via MQTT (if native), and registers in DB.

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('../registry/db');
const { generateMqttPayload } = require('../../publish_helper');

// Parse CLI arguments
const args = {};
process.argv.slice(2).forEach(val => {
  const parts = val.split('=');
  if (parts.length === 2 && parts[0].startsWith('--')) {
    args[parts[0].substring(2)] = parts[1];
  }
});

const deviceId = args.deviceId;
const deviceSecret = args.deviceSecret;
const accountEmail = args.accountEmail || "info@enarxi.com";
const accountPasswordRef = args.accountPasswordRef || "Enarxi12345@";
const clientId = args.clientId || "enarxi";
const nickname = args.nickname || `Camera_${deviceId.substring(deviceId.length - 6)}`;
const siteName = args.siteName || "General Site";
let ingestTier = args.ingestTier; // 'native' or 'bridge'

if (!deviceId || !deviceSecret) {
  console.log('Usage: node onboard_camera.js --deviceId=<id> --deviceSecret=<secret> [--ingestTier=<native|bridge>] [--nickname=<name>] [--siteName=<site>] [--clientId=<client>]');
  process.exit(1);
}

// Default MQTT broker settings
const brokerHost = args.brokerHost || "warner.co.in";
const brokerPort = parseInt(args.brokerPort, 10) || 1883;

async function run() {
  console.log(`[Onboard] Onboarding camera: ${deviceId} (${nickname})...`);

  // 1. Verify client exists
  const client = db.getClient(clientId);
  if (!client) {
    console.error(`[Onboard] Error: Client '${clientId}' does not exist in registry. Register client first.`);
    process.exit(1);
  }

  // 2. Check if device is already registered
  const existing = db.getDevice(deviceId);
  if (existing) {
    console.warn(`[Onboard] Warning: Device ${deviceId} already registered with tier ${existing.ingest_tier}. Will update config.`);
  }

  // 3. Generate unique stream name (collision-checked)
  let streamName = nickname.toLowerCase().replace(/[^a-z0-9]/g, '_');
  let suffix = 1;
  const originalStreamName = streamName;
  while (true) {
    const row = db.db.prepare('SELECT device_id FROM devices WHERE stream_name = ? AND device_id != ?').get(streamName, deviceId);
    if (!row) break;
    streamName = `${originalStreamName}_${suffix++}`;
  }
  console.log(`[Onboard] Derived unique stream name: ${streamName}`);

  // 4. Default tier decision
  if (!ingestTier) {
    console.log('[Onboard] No tier specified. Defaulting to bridge (shared Puppeteer) tier for reliability.');
    ingestTier = 'bridge';
  }

  let assignedWorkerId = null;

  if (ingestTier === 'bridge') {
    // Find the least-loaded worker process
    const workers = db.db.prepare(`
      SELECT worker_id, COUNT(*) as count 
      FROM devices 
      WHERE ingest_tier = 'bridge' AND worker_id IS NOT NULL 
      GROUP BY worker_id
      ORDER BY count ASC
    `).all();

    if (workers.length > 0) {
      assignedWorkerId = workers[0].worker_id;
      console.log(`[Onboard] Assigned to least-loaded worker: ${assignedWorkerId} (handling ${workers[0].count} cameras)`);
    } else {
      assignedWorkerId = 'worker1';
      console.log(`[Onboard] No active workers found in DB. Defaulting to worker1`);
    }
  }

  // 5. If native RTMP tier is forced, configure settings on the camera via MQTT
  if (ingestTier === 'native') {
    const rtmpTargetUrl = `rtsp://168.144.84.199:8554/live/${streamName}`;
    console.log(`[Onboard] Configuring camera native RTMP push to target: ${rtmpTargetUrl}`);

    const properties = [
      {
        "propertyName": "Audio.Input[0].Enabled",
        "id": 20037,
        "type": 4,
        "value": false
      },
      {
        "propertyName": "Protocol.RTMPClinet.Enabled",
        "id": 20241,
        "type": 4,
        "value": true
      },
      {
        "propertyName": "Protocol.RTMPClinet.Url",
        "id": 20242,
        "type": 1,
        "value": rtmpTargetUrl
      }
    ];

    const payload = generateMqttPayload(deviceId, deviceSecret, properties);
    const tempPayloadFile = path.join(__dirname, `temp_payload_${deviceId}.json`);
    fs.writeFileSync(tempPayloadFile, JSON.stringify(payload, null, 2), 'utf8');

    const topic = `Dmp/${deviceId}/Thing/setDeviceProperty`;
    const cmd = `mosquitto_pub -h ${brokerHost} -p ${brokerPort} -u "${deviceId}" -P "${deviceSecret}" -t "${topic}" -f "${tempPayloadFile}"`;
    
    console.log(`[Onboard] Publishing settings via command: ${cmd}`);

    await new Promise((resolve) => {
      exec(cmd, (err, stdout, stderr) => {
        // Cleanup temp file
        try { fs.unlinkSync(tempPayloadFile); } catch(e) {}
        
        if (err) {
          console.warn(`[Onboard] Warning: MQTT publish failed (${err.message}). Make sure mosquitto_pub is installed.`);
          console.log(`[Onboard] Please publish settings manually:`);
          console.log(cmd);
        } else {
          console.log(`[Onboard] Successfully published settings to MQTT broker!`);
        }
        resolve();
      });
    });
  }

  // 6. Registry Upsert
  db.upsertDevice({
    deviceId,
    deviceSecret,
    nickname,
    clientId,
    siteName,
    streamName,
    ingestTier,
    accountEmail,
    accountPasswordRef,
    workerId: assignedWorkerId,
    status: 'offline'
  });

  console.log(`[Onboard] Successfully registered camera ${deviceId} in database!`);
  console.log(`[Onboard] Summary:`);
  console.log(`  Device ID:   ${deviceId}`);
  console.log(`  Tier:        ${ingestTier}`);
  console.log(`  Stream:      live/${streamName}`);
  if (assignedWorkerId) {
    console.log(`  Worker:      ${assignedWorkerId}`);
  }

  db.close();
}

run().catch(err => {
  console.error('[Onboard] Execution error:', err.message);
  db.close();
});
