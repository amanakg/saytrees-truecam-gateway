const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'truecam.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema from schema.sql
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

console.log(`[Registry] Database initialized at: ${dbPath}`);

/**
 * Expose Database Client API
 */
module.exports = {
  db,

  // Client queries
  upsertClient({ clientId, name, apiKeyHash }) {
    const stmt = db.prepare(`
      INSERT INTO clients (client_id, name, api_key_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        name = excluded.name,
        api_key_hash = COALESCE(excluded.api_key_hash, api_key_hash)
    `);
    return stmt.run(clientId, name, apiKeyHash || null);
  },

  getClient(clientId) {
    const stmt = db.prepare('SELECT * FROM clients WHERE client_id = ?');
    return stmt.get(clientId);
  },

  // Device queries
  getDevice(deviceId) {
    const stmt = db.prepare('SELECT * FROM devices WHERE device_id = ?');
    return stmt.get(deviceId);
  },

  listDevicesByClient(clientId) {
    const stmt = db.prepare('SELECT * FROM devices WHERE client_id = ?');
    return stmt.all(clientId);
  },

  listDevicesByWorker(workerId) {
    const stmt = db.prepare('SELECT * FROM devices WHERE worker_id = ?');
    return stmt.all(workerId);
  },

  upsertDevice(device) {
    const stmt = db.prepare(`
      INSERT INTO devices (
        device_id, device_secret, nickname, client_id, site_name, 
        stream_name, ingest_tier, account_email, account_password_ref, worker_id, status
      )
      VALUES (
        :device_id, :device_secret, :nickname, :client_id, :site_name, 
        :stream_name, :ingest_tier, :account_email, :account_password_ref, :worker_id, :status
      )
      ON CONFLICT(device_id) DO UPDATE SET
        device_secret = excluded.device_secret,
        nickname = excluded.nickname,
        client_id = excluded.client_id,
        site_name = excluded.site_name,
        stream_name = excluded.stream_name,
        ingest_tier = excluded.ingest_tier,
        account_email = excluded.account_email,
        account_password_ref = excluded.account_password_ref,
        worker_id = excluded.worker_id,
        status = COALESCE(excluded.status, status),
        updated_at = CURRENT_TIMESTAMP
    `);
    
    // Set default values if not provided
    const payload = {
      device_id: device.deviceId,
      device_secret: device.deviceSecret,
      nickname: device.nickname || null,
      client_id: device.clientId,
      site_name: device.siteName || null,
      stream_name: device.streamName,
      ingest_tier: device.ingestTier || 'bridge',
      account_email: device.accountEmail,
      account_password_ref: device.accountPasswordRef,
      worker_id: device.workerId || null,
      status: device.status || 'unknown'
    };
    
    return stmt.run(payload);
  },

  updateStatus(deviceId, status, lastFrameAt = null) {
    if (lastFrameAt) {
      const stmt = db.prepare(`
        UPDATE devices
        SET status = ?, last_frame_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `);
      return stmt.run(status, lastFrameAt, deviceId);
    } else {
      const stmt = db.prepare(`
        UPDATE devices
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE device_id = ?
      `);
      return stmt.run(status, deviceId);
    }
  },

  updateMetadata(deviceId, codec, resolution, fps) {
    const stmt = db.prepare(`
      UPDATE devices
      SET codec = ?, resolution = ?, fps = ?, updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `);
    return stmt.run(codec, resolution, fps, deviceId);
  },

  close() {
    db.close();
  }
};
