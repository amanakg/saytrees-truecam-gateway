// api/server.js
// Tenant-scoped HTTP API for Truecam Portal embedding

const express = require('express');
const path = require('path');
const db = require('../registry/db');
const { spawn } = require('child_process');

const appMain = express();
const portMain = 3000;

// Middlewares
appMain.use(express.json());

// Serve static dashboards
appMain.use(express.static(path.join(__dirname, '..', '..', 'dashboard_main')));

const corsMiddleware = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
};

appMain.use(corsMiddleware);

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

const getCamerasHandler = (req, res) => {
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
};

appMain.get('/api/clients/:clientId/cameras', authenticateClient, getCamerasHandler);

const WebSocket = require('ws');

const actionHandler = (req, res) => {
  const deviceId = req.params.deviceId;
  const actionPayload = req.body;

  try {
    const ws = new WebSocket(`ws://127.0.0.1:8080/?deviceId=${deviceId}&type=control`);
    ws.on('open', () => {
      ws.send(JSON.stringify(actionPayload));
      ws.close();
      res.json({ message: 'Action dispatched successfully' });
    });
    ws.on('error', (e) => {
      console.error('[API] Control WS Error:', e.message);
      res.status(500).json({ error: 'Failed to contact worker for control' });
    });
  } catch (err) {
    console.error('[API] Error handling action:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

appMain.post('/api/clients/:clientId/cameras/:deviceId/action', authenticateClient, actionHandler);

const serverMain = appMain.listen(portMain, () => {
  console.log(`[API Main] Server listening on port ${portMain}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  serverMain.close();
  db.close();
  console.log('[API] Servers closed.');
});
