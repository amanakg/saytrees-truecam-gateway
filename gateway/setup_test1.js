const db = require('./registry/db');
const stmt = db.db.prepare('INSERT OR REPLACE INTO devices (device_id, device_secret, nickname, client_id, site_name, stream_name, ingest_tier, account_email, account_password_ref, worker_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

for (let i = 1; i <= 5; i++) { 
  stmt.run('367ABDWN1000346168', '08ce8ae8a9e468d2313c03c9e058a3c2', 'Test_Cam_'+i, 'enarxi', 'General Site', 'enarxi_cam'+i, 'bridge', 'info@enarxi.com', 'Enarxi12345@', 'worker1', 'offline'); 
}

console.log('Test 1 cameras added successfully.');
