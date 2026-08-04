const db = require('./db');

console.log('[Seed] Seeding existing client and devices...');

try {
  // 1. Seed tenant client
  db.upsertClient({
    clientId: 'enarxi',
    name: 'Enarxi Innovations Private Limited',
    apiKeyHash: 'dummy_hash_for_testing' // Phase 7 security key
  });
  console.log('[Seed] Seeded client: enarxi');

  // 2. Seed Camera 1 (from server_cam1.js)
  db.upsertDevice({
    deviceId: '367ABDWN1000346168',
    deviceSecret: '08ce8ae8a9e468d2313c03c9e058a3c2',
    nickname: 'Enarxi Cam 1',
    clientId: 'enarxi',
    siteName: 'Office Gate 1',
    streamName: 'devcamera1_hd',
    ingestTier: 'bridge',
    accountEmail: 'info@enarxi.com',
    accountPasswordRef: 'Camtest123@', // reference to account password
    workerId: 'worker1', // initially assign to worker1
    status: 'offline'
  });
  console.log('[Seed] Seeded Camera 1: 367ABDWN1000346168');

  // 3. Seed Camera 2 (from server.js)
  db.upsertDevice({
    deviceId: 'F14504WN1000345886',
    deviceSecret: '1223093b8d7277ee7158841ae47d75a7',
    nickname: 'Enarxi Cam 2',
    clientId: 'enarxi',
    siteName: 'Office Gate 2',
    streamName: 'devcamera2_hd',
    ingestTier: 'bridge',
    accountEmail: 'info@enarxi.com',
    accountPasswordRef: 'Camtest123@',
    workerId: 'worker1', // initially assign to worker1
    status: 'offline'
  });
  console.log('[Seed] Seeded Camera 2: F14504WN1000345886');

  console.log('[Seed] Seeding completed successfully!');
} catch (err) {
  console.error('[Seed] Seeding failed:', err.message);
} finally {
  db.close();
}
