const fs = require('fs');
const crypto = require('crypto');

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

// Generate complete signed MQTT payload
function generateMqttPayload(deviceId, deviceSecret, properties) {
  const rawUuid = crypto.randomUUID();
  const msgId = generateSign(rawUuid);
  const timestampSeconds = Math.round(Date.now() / 1000);
  const timestampMs = Date.now();

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

  return {
    msg,
    sign: generateSign(msg)
  };
}

// Export for other Node scripts (like onboard_camera.js)
module.exports = {
  generateSign,
  getNonce,
  generateMqttPayload
};

// If run directly from the command line
if (require.main === module) {
  if (process.argv.length < 6) {
    console.log('Usage: node publish_helper.js <deviceId> <deviceSecret> <brokerHost> <brokerPort> [propertiesJson|rtmpUrl]');
    console.log('Example 1 (Default RTMP set): node publish_helper.js B1796DDB1000000566 secret 192.168.23.180 1883 rtsp://168.144.84.199:8554/live/mycam');
    console.log('Example 2 (Custom JSON properties): node publish_helper.js B1796DDB1000000566 secret 192.168.23.180 1883 \'[{"propertyName":"Audio.Input[0].Enabled","id":20037,"type":4,"value":false}]\'');
    process.exit(1);
  }

  const deviceId = process.argv[2];
  const deviceSecret = process.argv[3];
  const brokerHost = process.argv[4];
  const brokerPort = parseInt(process.argv[5], 10);
  
  let properties = [];
  const fifthArg = process.argv[6];

  if (fifthArg && fifthArg.trim().startsWith('[')) {
    try {
      properties = JSON.parse(fifthArg);
    } catch (e) {
      console.error('Failed to parse properties JSON argument:', e.message);
      process.exit(1);
    }
  } else {
    // If it's a URL or empty, build default RTMP push configuration
    const rtmpUrl = fifthArg || `rtsp://168.144.84.199:8554/live/${deviceId}_hd`;
    properties = [
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
      },
      {
        "propertyName": "Protocol.RTMPClinet.Url",
        "id": 20242,
        "type": 1,
        "value": rtmpUrl
      }
    ];
  }

  const payload = generateMqttPayload(deviceId, deviceSecret, properties);
  const payloadStr = JSON.stringify(payload, null, 2);
  
  fs.writeFileSync('payload.json', payloadStr, 'utf8');
  console.log('Successfully generated signed payload and saved to payload.json!');
  console.log('\n--- Payload Details ---');
  console.log(payloadStr);

  const topic = `Dmp/${deviceId}/Thing/setDeviceProperty`;
  console.log('\n--- Mosquitto Publish Command ---');
  console.log('Run the following command in your terminal:');
  console.log(`mosquitto_pub -h ${brokerHost} -p ${brokerPort} -u "${deviceId}" -P "${deviceSecret}" -t "${topic}" -f payload.json`);
}
