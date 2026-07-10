const db = require('./registry/db');

// Ensure devcamera1_hd is present
const restoreStmt = db.db.prepare(`
  INSERT OR REPLACE INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

restoreStmt.run(
  '367ABDWN1000346168', '08ce8ae8a9e468d2313c03c9e058a3c2', 'Enarxi_Cam1', 
  'enarxi', 'General Site', 'devcamera1_hd', 'bridge', 
  'info@enarxi.com', 'Enarxi12345@', 'worker1', 'offline'
);
console.log('[Setup] Verified Enarxi_Cam1 (devcamera1_hd)');

// Add 3 mock cameras
const insertMock = db.db.prepare(`
  INSERT OR REPLACE INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (let i = 1; i <= 3; i++) {
  insertMock.run(
    `MOCK_CAM_${i}`, 
    '08ce8ae8a9e468d2313c03c9e058a3c2', 
    `Simulated_Cam_${i}`, 
    'enarxi', 
    'General Site', 
    `mock_cam_${i}`, 
    'bridge', 
    'info@enarxi.com', 
    'Enarxi12345@', 
    'worker1', 
    'offline'
  );
}
console.log('[Setup] Added 3 Mock Cameras (mock_cam_1, mock_cam_2, mock_cam_3)');
