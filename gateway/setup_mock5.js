const db = require('./registry/db');

// 1. Restore the original camera that was overwritten during the previous test
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
console.log('[Setup] Restored original Enarxi_Cam1 (devcamera1_hd)');

// 2. Add 5 mock cameras for the load test
const insertMock = db.db.prepare(`
  INSERT OR REPLACE INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, 
    ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (let i = 1; i <= 5; i++) {
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
console.log('[Setup] 5 Mock Cameras added successfully (mock_cam_1 to mock_cam_5)');
