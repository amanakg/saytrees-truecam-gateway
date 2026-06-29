const https = require('https');
const crypto = require('crypto');

if (process.argv.length < 4) {
  console.log('Usage: node get_device_list.js <account> <password>');
  console.log('Example: node get_device_list.js test@example.com mypassword123');
  process.exit(1);
}

const account = process.argv[2];
const password = process.argv[3];

const appBound = "wgBkDSffTQ7yxEffF2kFx3sxR";
const clientImei = "c1a01c34-7a35-11eb-9439-0242ac130002"; // standard dummy UUID
const clientType = "Chrome";

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function generateApiSign(data) {
  const signKey = "46sw124kluj98bh6";
  const sortedKeys = Object.keys(data).sort();
  let str = "";
  sortedKeys.forEach(key => {
    if (Array.isArray(data[key])) {
      str += key + "=" + JSON.stringify(data[key]);
    } else {
      str += key + "=" + data[key];
    }
  });
  str += signKey;
  return md5(str);
}

const Lt = "fmY1VABKnuLDNM0+Zjdl7vocwi8bk2xCO4=PReFQ9TsXq3WJ6aryEHzSG5IgUph/t";

// 1. Generate random salt
function wt() {
  const e = Math.floor(17 * Math.random()) + 16;
  let t = "";
  for (let r = 0; r < e; r++) {
    t += Lt.charAt(Math.floor(64 * Math.random()));
  }
  return t;
}

// 2. Encryption function (matching Gt in connector.js)
function encrypt(e, t) {
  e = String(e);
  const r = Buffer.from(e, 'utf8').toString('base64');
  const a = t;
  const i = Math.min(t.length, 32);
  const s = r.length;
  let o = "";
  for (let n = 0; n < s; n++) {
    const u = Math.floor(n / i);
    const p = n % i;
    if (u > 1 && 0 === p) {
      t = o.substring((u - 2) * i, (u - 1) * i);
    }
    const m = r.charAt(n);
    const c = t.charAt(p);
    const l = a.charAt(p);
    let d;
    if (0 === Math.floor(u / 2)) {
      d = (Lt.indexOf(m) + Lt.indexOf(c) + Lt.indexOf(l)) % 65;
    } else {
      d = (Lt.indexOf(m) - Lt.indexOf(c) - Lt.indexOf(l) + 130) % 65;
    }
    o += Lt.charAt(d);
  }
  return o;
}

// 3. Decryption function
function decrypt(e, t) {
  const r = t;
  const a = Math.min(t.length, 32);
  const i = e.length;
  let s = "";
  for (let o = 0; o < i; o++) {
    const n = Math.floor(o / a);
    const u = o % a;
    if (n > 1 && 0 === u) {
      t = e.substring((n - 2) * a, (n - 1) * a);
    }
    const p = e.charAt(o);
    const c = t.charAt(u);
    const l = r.charAt(u);
    let d;
    if (0 === Math.floor(n / 2)) {
      d = (Lt.indexOf(p) - Lt.indexOf(c) - Lt.indexOf(l) + 130) % 65;
    } else {
      d = (Lt.indexOf(p) + Lt.indexOf(c) + Lt.indexOf(l)) % 65;
    }
    s += Lt.charAt(d);
  }
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch (err) {
    return "";
  }
}

// Encrypted POST helper replacing axios and payload wrapping
function post(url, data) {
  return new Promise((resolve, reject) => {
    // Encrypt payload
    const salt = wt();
    const encrypted = encrypt(JSON.stringify(data), salt);
    const saltLenStr = salt.length.toString().padStart(2, "0");
    const payload = {
      p: saltLenStr + salt + encrypted
    };

    const urlObj = new URL(url);
    const postData = JSON.stringify(payload);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        try {
          const resJson = JSON.parse(responseBody);
          // Decrypt response if it is encrypted
          if (resJson.data && typeof resJson.data === 'string') {
            const rawData = resJson.data;
            const r = parseInt(rawData.substring(0, 2), 10);
            const saltVal = rawData.substring(2, 2 + r);
            const decryptedBody = decrypt(rawData.substring(2 + r), saltVal);
            resJson.data = JSON.parse(decryptedBody);
          }
          resolve({ data: resJson });
        } catch (e) {
          reject(new Error(`Failed to parse/decrypt response: ${responseBody}`));
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.write(postData);
    req.end();
  });
}

async function run() {
  try {
    console.log('1. Resolving API Domain (seekDomain)...');
    const seekData = {
      osType: 3,
      appBound: appBound,
      account: account,
      clientImei: clientImei,
      clientType: clientType
    };
    seekData.sign = generateApiSign(seekData);

    const seekRes = await post('https://app-api.warner.co.in/UserApi/seekDomain', seekData);
    if (seekRes.data.ack !== "200") {
      throw new Error(`Domain resolution failed: ${JSON.stringify(seekRes.data)}`);
    }

    const domainUrl = seekRes.data.data.domain;
    console.log(`Resolved API Base URL: ${domainUrl}`);

    console.log('\n2. Logging in...');
    const loginData = {
      osType: 3,
      appBound: appBound,
      account: account,
      password: md5(password),
      clientImei: clientImei,
      clientType: clientType
    };
    loginData.sign = generateApiSign(loginData);

    const loginRes = await post(`${domainUrl}/UserApi/loginByPassword`, loginData);
    if (loginRes.data.ack !== "200") {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.data)}`);
    }

    const accessToken = loginRes.data.data.accessToken;
    console.log(`Login Successful! Access Token obtained.`);

    console.log('\n3. Retrieving Device List...');
    const listData = {
      osType: 3,
      appBound: appBound,
      accessToken: accessToken
    };
    listData.sign = generateApiSign(listData);

    const listRes = await post(`${domainUrl}/DeviceApi/getDeviceList`, listData);
    if (listRes.data.ack !== "200") {
      throw new Error(`Failed to retrieve device list: ${JSON.stringify(listRes.data)}`);
    }

    const deviceList = listRes.data.data.list;
    console.log(`\nFound ${deviceList.length} device(s):\n`);

    deviceList.forEach((device, index) => {
      const params = device.deviceParams;
      console.log(`[Device #${index + 1}]`);
      console.log(`Name:          ${device.nickname || 'N/A'}`);
      console.log(`Product ID:    ${params.productId}`);
      console.log(`Device ID:     ${params.deviceUuid}`);
      console.log(`Device Secret: ${params.deviceSecret}`);
      console.log(`-------------------------------------------`);
    });

  } catch (error) {
    console.error('Error occurred:', error.message);
  }
}

run();
