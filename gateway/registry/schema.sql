-- schema.sql
-- SQLite schema for the Truecam device registry

CREATE TABLE IF NOT EXISTS clients (
  client_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  api_key_hash  TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  device_id             TEXT PRIMARY KEY, -- Camera UUID
  device_secret         TEXT NOT NULL,
  nickname              TEXT,
  client_id             TEXT NOT NULL,
  site_name             TEXT,
  stream_name           TEXT NOT NULL UNIQUE, -- MediaMTX path identifier (e.g. devcamera1_hd)
  ingest_tier           TEXT NOT NULL CHECK(ingest_tier IN ('native', 'bridge')),
  account_email         TEXT NOT NULL,
  account_password_ref  TEXT NOT NULL, -- references password/secret
  worker_id             TEXT, -- worker ID assigned to handle this camera
  product_id            TEXT, -- Tuya productId (needed to construct formattedDevId for ConnectDevice)
  status                TEXT DEFAULT 'unknown', -- 'connected', 'reconnecting', 'offline', 'error', 'unknown'
  last_frame_at         DATETIME,
  codec                 TEXT, -- Stream codec (e.g., 'hevc', 'h264')
  resolution            TEXT, -- Stream resolution (e.g., '2304x1296')
  fps                   INTEGER, -- Stream frames per second (e.g., 25)
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME,
  FOREIGN KEY (client_id) REFERENCES clients(client_id)
);
