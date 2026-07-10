const db = require('./registry/db');

// 1. Wipe the entire devices table to ensure no phantom/old cameras jam the worker
db.db.prepare("DELETE FROM devices").run();

// 2. Restore ONLY the correct, active physical camera
const insertStmt = db.db.prepare(`
  INSERT INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insertStmt.run(
  '367ABDWN1000346168', 
  '08ce8ae8a9e468d2313c03c9e058a3c2', 
  'Office Camera', 
  'enarxi', 
  'General Site', 
  'devcamera1_hd', 
  'bridge', 
  'afzal.basha@goldbharat.com', 
  'default', 
  '1', 
  'offline'
);

// 3. Create exactly 2 mock cameras
for (let i = 1; i <= 2; i++) {
  insertStmt.run(
    `MOCK_CAM_${i}`, 
    '08ce8ae8a9e468d2313c03c9e058a3c2', 
    `Simulated_Cam_${i}`, 
    'enarxi', 
    'General Site', 
    `mock_cam_${i}`, 
    'bridge', 
    'afzal.basha@goldbharat.com', 
    'default', 
    '1', 
    'online'
  );
}

console.log("Database wiped clean and reset: EXACTLY 1 Real Camera (367...) + 2 Mock Cameras.");
