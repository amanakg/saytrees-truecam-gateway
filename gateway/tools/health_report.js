// tools/health_report.js
// Health monitoring utility to check for offline or frozen cameras in the registry

const db = require('../registry/db');

console.log('=== Truecam Fleet Health Report ===');
console.log(`Report generated at: ${new Date().toLocaleString()}`);
console.log('----------------------------------');

try {
  // 1. Query general stats
  const total = db.db.prepare('SELECT COUNT(*) as count FROM devices').get().count;
  const connected = db.db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'connected'").get().count;
  const reconnecting = db.db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'reconnecting'").get().count;
  const offline = db.db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'offline'").get().count;
  const error = db.db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'error'").get().count;
  const unknown = db.db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'unknown'").get().count;

  console.log(`Total Cameras:      ${total}`);
  console.log(`Connected:          ${connected} (${((connected/total)*100 || 0).toFixed(1)}%)`);
  console.log(`Reconnecting:       ${reconnecting}`);
  console.log(`Offline:            ${offline}`);
  console.log(`Error:              ${error}`);
  console.log(`Unknown Status:     ${unknown}`);
  console.log('----------------------------------');

  // 2. Query cameras that require attention (status != 'connected')
  const issues = db.db.prepare(`
    SELECT device_id, nickname, status, worker_id, ingest_tier, last_frame_at 
    FROM devices 
    WHERE status != 'connected'
    ORDER BY status, last_frame_at DESC
  `).all();

  if (issues.length > 0) {
    console.log(`⚠ Found ${issues.length} camera(s) requiring attention:\n`);
    
    issues.forEach((cam, index) => {
      const lastSeen = cam.last_frame_at 
        ? new Date(cam.last_frame_at).toLocaleString() 
        : 'Never';
      
      console.log(`[#${index + 1}] Nickname:  ${cam.nickname || cam.device_id}`);
      console.log(`     UUID:      ${cam.device_id}`);
      console.log(`     Status:    ${cam.status.toUpperCase()}`);
      console.log(`     Tier:      ${cam.ingest_tier}`);
      console.log(`     Worker ID: ${cam.worker_id || 'None'}`);
      console.log(`     Last Seen: ${lastSeen}`);
      console.log('     ----------------------------');
    });
  } else {
    console.log('✅ All cameras are connected and streaming successfully!');
  }
  
} catch (err) {
  console.error('[Health] Failed to generate health report:', err.message);
} finally {
  db.close();
}
