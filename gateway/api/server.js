// api/server.js
// Tenant-scoped HTTP API for Truecam Portal embedding

const express = require('express');
const path = require('path');
const db = require('../registry/db');
const app = express();
const port = process.env.API_PORT || 3000;

app.use(express.json());

// Serve the dashboard statically on Port 3000 (bypassing firewall block on 9000)
app.use(express.static(path.join(__dirname, '..', 'dashboard')));


// Enable CORS for dashboard integration
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware to authenticate tenant client API key
function authenticateClient(req, res, next) {
  const clientId = req.params.clientId;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Missing x-api-key header' });
  }

  const client = db.getClient(clientId);
  if (!client) {
    return res.status(404).json({ error: `Client '${clientId}' not found` });
  }

  // Simple direct match for API key (in production, use bcrypt/crypto hash comparison)
  if (client.api_key_hash !== apiKey) {
    return res.status(403).json({ error: 'Forbidden: Invalid API key' });
  }

  req.client = client;
  next();
}

/**
 * GET /api/clients/:clientId/cameras
 * Returns all registered cameras for the given client.
 */
app.get('/api/clients/:clientId/cameras', authenticateClient, (req, res) => {
  try {
    const devices = db.listDevicesByClient(req.client.client_id);
    
    // Map database columns to the clean API structure
    const payload = devices.map(device => {
      return {
        id: device.device_id,
        name: device.nickname || device.device_id,
        streamName: device.stream_name,
        whepUrl: `http://168.144.84.199:8889/live/${device.stream_name}/whep`,
        status: device.status,
        lastFrameAt: device.last_frame_at,
        metadata: {
          codec: device.codec || null,
          resolution: device.resolution || null,
          fps: device.fps || null
        }
      };
    });

    res.json(payload);
  } catch (err) {
    console.error('[API] Error listing cameras:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const server = app.listen(port, () => {
  console.log(`[API] Server listening on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    console.log('[API] Server closed.');
  });
});
