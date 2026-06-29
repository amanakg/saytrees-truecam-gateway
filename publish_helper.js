const fs = require('fs');
const crypto = require('crypto');

// Check command line arguments
if (process.argv.length < 6) {
  console.log('Usage: node publish_helper.js <deviceId> <deviceSecret> <brokerHost> <brokerPort> [Main|Sub]');
  console.log('Example: node publish_helper.js B1796DDB1000000566 65362f1c2724e31eeb3a9e5490294808 192.168.23.180 1883 Main');
  process.exit(1);
}

const deviceId = process.argv[2];
const deviceSecret = process.argv[3];
const brokerHost = process.argv[4];
const brokerPort = parseInt(process.argv[5], 10);
const streamType = process.argv[6] || 'Main'; // Default to Main stream

// Signature helper
function generateSign(data) {
  const signKey = "46sw124kluj98bh6";
  const keys = Object.keys(data).sort((a, b) => a[0].charCodeAt(0) - b[0].charCodeAt(0));
  let string = "";
  for (let i = 0; i < keys.length; i++) {
    string += keys[i] + "=" + JSON.stringify(data[keys[i]]);
  }
  return crypto.createHash('md5').update(string + signKey).digest('hex');
}

// Generate random nonce string
function getNonce() {
  const charStr = "abcdefghijklmnopqrstuvwxyz0123456789";
  let res = "";
  for (let i = 0; i < 32; i++) {
    res += charStr.charAt(Math.floor(Math.random() * charStr.length));
  }
  return res;
}

// Generate unique msgId using a UUID
const rawUuid = crypto.randomUUID();
const msgId = generateSign(rawUuid);

const timestampSeconds = Math.round(Date.now() / 1000);
const timestampMs = Date.now();

// Properties payload
const properties = [
  {
    "propertyName": "Audio.Input[0].Enabled",
    "id": 20037,
    "type": 4,
    "value": false
  },
  {
    "propertyName": "Protocol.RTMPClinet.Enabled",
    "id": 20241,
    "type": 4,
    "value": true
  }
];

// Construct msg object
const msg = {
  msgType: "thing.property.set",
  version: "v1",
  nonce: getNonce(),
  requestTime: timestampSeconds,
  deviceId,
  deviceSecret,
  payload: {
    msgId: msgId,
    sys: {
      ack: 1
    },
    time: timestampMs,
    data: {
      properties
    }
  }
};

// Complete payload with signature
const payload = {
  msg,
  sign: generateSign(msg)
};

// Save to payload.json
const payloadStr = JSON.stringify(payload);
fs.writeFileSync('payload.json', payloadStr, 'utf8');
console.log('Successfully generated signed payload and saved to payload.json!');
console.log('\n--- Payload Details ---');
console.log(JSON.stringify(payload, null, 2));

// Construct topic
const topic = `Dmp/${deviceId}/Thing/setDeviceProperty`;

console.log('\n--- Mosquitto Publish Command ---');
console.log('Run the following command in your terminal:');
console.log(`mosquitto_pub -h ${brokerHost} -p ${brokerPort} -u "${deviceId}" -P "${deviceSecret}" -t "${topic}" -f payload.json`);
