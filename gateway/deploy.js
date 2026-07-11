const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH Connection Ready!');
  
  const cmd = `
    cd /opt/truecam
    echo "Current directory: $(pwd)"
    
    echo "=== Updating Git ==="
    git fetch
    git checkout native-push-test
    git pull origin native-push-test
    
    echo "=== Installing dependencies ==="
    cd gateway
    npm install
    
    echo "=== Restarting processes ==="
    if command -v pm2 &> /dev/null; then
      echo "Using PM2 to restart"
      pm2 restart all
    else
      echo "PM2 not found. Killing node and restarting."
      pkill -f "node api/server.js" || true
      nohup node api/server.js > server.log 2>&1 &
      echo "Started via nohup."
    fi
    echo "=== Deployment Complete ==="
  `;

  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Command finished with code ' + code);
      conn.end();
    }).on('data', (data) => {
      process.stdout.write(data.toString());
    }).stderr.on('data', (data) => {
      process.stderr.write(data.toString());
    });
  });
}).on('error', (err) => {
  console.error('SSH Connection Error:', err);
}).connect({
  host: '168.144.84.199',
  port: 22,
  username: 'root',
  password: 'Enarxi@Say007',
  readyTimeout: 20000
});
