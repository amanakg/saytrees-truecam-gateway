const db = require('better-sqlite3')('registry/truecam.db');

const template = db.prepare('SELECT * FROM devices WHERE nickname = ?').get('Enarxi_Cam1');

if (!template) {
  console.log("Template camera not found");
  process.exit(1);
}

const insert = db.prepare(`
  INSERT INTO devices (
    device_id, device_secret, nickname, client_id, site_name, stream_name, ingest_tier, account_email, account_password_ref, worker_id, status
  ) VALUES (
    @device_id, @device_secret, @nickname, @client_id, @site_name, @stream_name, @ingest_tier, @account_email, @account_password_ref, @worker_id, 'offline'
  )
`);

for (let i = 2; i <= 10; i++) {
  try {
    insert.run({
      device_id: `MOCK_CAM_${i}`,
      device_secret: template.device_secret,
      nickname: `Simulated_Cam_${i}`,
      client_id: template.client_id,
      site_name: template.site_name,
      stream_name: `mock_cam_${i}`,
      ingest_tier: template.ingest_tier,
      account_email: template.account_email,
      account_password_ref: template.account_password_ref,
      worker_id: template.worker_id
    });
    console.log(`Inserted Simulated_Cam_${i}`);
  } catch (err) {
    console.log(`Skipped Enarxi_Cam${i}: ${err.message}`);
  }
}
