const db = require('./registry/db');

// 1. Restore the original camera
const restoreStmt = db.db.prepare(`
  INSERT OR REPLACE INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

restoreStmt.run(
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

// 2. Clear out any old mocks to start fresh
db.db.prepare("DELETE FROM devices WHERE device_id LIKE 'MOCK_CAM_%'").run();

// 3. Create exactly 2 mock cameras for a 3-way test (Real + 2 Mocks)
const insertMock = db.db.prepare(`
  INSERT OR REPLACE INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (let i = 1; i <= 2; i++) {
  insertMock.run(
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

console.log("Database reset: 1 Real Camera + 2 Mock Cameras.");
