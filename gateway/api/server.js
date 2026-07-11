// api/server.js
// Tenant-scoped HTTP API for Truecam Portal embedding

const express = require('express');
const path = require('path');
const db = require('../registry/db');
const { spawn } = require('child_process');

const appMain = express();
const appTesting = express();
const portMain = 3000;
const portTesting = 9001;

// Middlewares
appMain.use(express.json());
appTesting.use(express.json());

// Serve static dashboards
appMain.use(express.static(path.join(__dirname, '..', '..', 'dashboard_main')));
appTesting.use(express.static(path.join(__dirname, '..', '..', 'dashboard_testing')));

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
appTesting.use(corsMiddleware);

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
appTesting.get('/api/clients/:clientId/cameras', authenticateClient, getCamerasHandler);

// Mock Camera Management
let mockProcesses = [];

appTesting.post('/api/test/mock_cameras', (req, res) => {
  const { count } = req.body;
  if (typeof count !== 'number' || count < 0) {
    return res.status(400).json({ error: 'Invalid count' });
  }

  console.log(`[Testing API] Stopping ${mockProcesses.length} existing mock cameras...`);
  mockProcesses.forEach(p => {
    try { p.kill('SIGKILL'); } catch(e) {}
  });
  mockProcesses = [];
  try { require('child_process').execSync('pkill -f "mock_cam_" || true'); } catch(e) {}

  console.log(`[Testing API] Starting ${count} new mock cameras...`);
  for (let i = 1; i <= count; i++) {
    const streamName = `mock_cam_${i}`;
    // FFMPEG command to copy from devcamera1_hd to mock_cam_X
    const ffmpegArgs = [
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-rtsp_transport', 'tcp',
      '-i', 'rtsp://127.0.0.1:8554/live/devcamera1_hd',
      '-c:v', 'copy',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      `rtsp://127.0.0.1:8554/live/${streamName}`
    ];
    
    const p = spawn('ffmpeg', ffmpegArgs);
    p.on('error', (err) => console.error(`[Mock ${i}] FFmpeg error: ${err.message}`));
    mockProcesses.push(p);
  }

  res.json({ message: `Started ${count} mock cameras`, count });
});

appTesting.post('/api/test/stop_mock_cameras', (req, res) => {
  console.log(`[Testing API] Stopping ${mockProcesses.length} mock cameras via Stop button...`);
  mockProcesses.forEach(p => {
    try { p.kill('SIGKILL'); } catch(e) {}
  });
  mockProcesses = [];
  try { require('child_process').execSync('pkill -f "mock_cam_" || true'); } catch(e) {}
  res.json({ message: 'Stopped all mock cameras' });
});

const serverMain = appMain.listen(portMain, () => {
  console.log(`[API Main] Server listening on port ${portMain}`);
});
const serverTesting = appTesting.listen(portTesting, () => {
  console.log(`[API Testing] Server listening on port ${portTesting}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  serverMain.close();
  serverTesting.close();
  mockProcesses.forEach(p => { try { p.kill('SIGKILL'); } catch(e) {} });
  db.close();
  console.log('[API] Servers closed.');
});
