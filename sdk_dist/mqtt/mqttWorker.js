importScripts("./mqtt.min.js");
importScripts("../js/uuid.js");
/***
 *
 *  ws  wss  MQTT over WebSocket
 * EMQX  ws  8083，wss  8084
 *  path,  /mqtt
 */
const clientMap = new Map();
const isEncrypt = false
/***
 * Node.js
 *  mqtt  mqtts  MQTT over TCP
 * EMQX  mqtt  1883，mqtts  8084
 */
//

const BasicSubscribeTopic = [
  "Thing/setDevicePropertyResponse",
  "Device/executeDeviceActionResponse",
  "Thing/getDevicePropertyResponse",
  "Ota/reportUpgradeProgress"
];
// Encryption and Decryption utility
const base64Chars = "fmY1VABKnuLDNM0+Zjdl7vocwi8bk2xCO4=PReFQ9TsXq3WJ6aryEHzSG5IgUph/t";

/**
 *  salt 
 * @returns {string}  salt
 */
function generateSalt() {
  const length = Math.floor(Math.random() * (32 - 16 + 1)) + 16; //  16-32 
  let salt = "";
  for (let i = 0; i < length; i++) {
    salt += base64Chars.charAt(Math.floor(Math.random() * 64));
  }
  return salt;
  // return "eaW8Z9/NqiNruF/8OkR6B=vx2Qm7="
}

/**
 * 
 * @param {string} paramStr 
 * @param {string} salt  salt
 * @returns {string} 
 */
function encodeParamStr(paramStr, salt) {
  // 
  paramStr = String(paramStr);

  //  Base64（ Unicode ）
  const firstStr = btoa(unescape(encodeURIComponent(paramStr)));

  const key = salt;
  const saltLength = Math.min(salt.length, 32);
  const firstStrLength = firstStr.length;
  let lastStr = "";

  for (let i = 0; i < firstStrLength; i++) {
    const interger = Math.floor(i / saltLength);
    const remainder = i % saltLength;

    if (interger > 1 && remainder === 0) {
      salt = lastStr.substring((interger - 2) * saltLength, (interger - 1) * saltLength);
    }

    const rawStr = firstStr.charAt(i);
    const saltStr = salt.charAt(remainder);
    const keyStr = key.charAt(remainder);
    let encodeIndex;

    if (Math.floor(interger / 2) === 0) {
      encodeIndex = (base64Chars.indexOf(rawStr) + base64Chars.indexOf(saltStr) + base64Chars.indexOf(keyStr)) % 65;
    } else {
      encodeIndex = (base64Chars.indexOf(rawStr) - base64Chars.indexOf(saltStr) - base64Chars.indexOf(keyStr) + 130) % 65;
    }

    lastStr += base64Chars.charAt(encodeIndex);
  }

  return lastStr;
}

/**
 * 
 * @param {string} paramStr 
 * @param {string} salt  salt
 * @returns {string} 
 */
function decodeParamStr(paramStr, salt) {
  const key = salt;
  const saltLength = Math.min(salt.length, 32);
  const firstStrLength = paramStr.length;
  let lastStr = "";

  for (let i = 0; i < firstStrLength; i++) {
    const interger = Math.floor(i / saltLength);
    const remainder = i % saltLength;

    if (interger > 1 && remainder === 0) {
      salt = paramStr.substring((interger - 2) * saltLength, (interger - 1) * saltLength);
    }

    const rawStr = paramStr.charAt(i);
    const saltStr = salt.charAt(remainder);
    const keyStr = key.charAt(remainder);
    let encodeIndex;

    if (Math.floor(interger / 2) === 0) {
      encodeIndex = (base64Chars.indexOf(rawStr) - base64Chars.indexOf(saltStr) - base64Chars.indexOf(keyStr) + 130) % 65;
    } else {
      encodeIndex = (base64Chars.indexOf(rawStr) + base64Chars.indexOf(saltStr) + base64Chars.indexOf(keyStr)) % 65;
    }

    lastStr += base64Chars.charAt(encodeIndex);
  }

  try {
    //  Base64  Unicode 
    return decodeURIComponent(escape(atob(lastStr)));
  } catch (error) {
    console.error('Decoding error:', error);
    return '';
  }
}
/**
 * @description: mqtt
 * @param {*} deviceId
 * @param {*} password
 * @param {*} url
 * @param {*} callback
 * @return {*}
 */
connectClient = (deviceId, password, url, port, callback) => {
  if (!deviceId || !password || !url || !port || clientMap.get(deviceId)) return;
  // deviceId = "B1796DDB1000000566"
  // password = "65362f1c2724e31eeb3a9e5490294808"
  // url = "192.168.23.180"
  // port = "8083"
  let connectTime = 0;
  // wss
  const connectUrl = `wss://${url}:${port}/mqtt`;
  const options = {
    // Clean session
    clean: true,
    connectTimeout: 4000,
    //  Authorization
    clientId: `client_${deviceId}_${uuid.v1()}`,
    reconnectPeriod: 1000,
    username: deviceId,
    password: password
  };
  console.log(
    `[logs][mqtt][${deviceId}]connect mqtt, password = ${password}, connectUrl = ${connectUrl}, options = `,
    options
  );
  let client = mqtt.connect(connectUrl, options);

  client.on("connect", function () {
    console.log(`[logs][mqtt][${deviceId}]client connect success`);
    connectTime = 0;
    //  Subscribe Theme
    for (let i = 0; i < BasicSubscribeTopic.length; i++) {
      const topic = `Dmp/${deviceId}/${BasicSubscribeTopic[i]}`;
      console.log(`[logs][mqtt][${deviceId}]invoke subscribe topic, topic = ${topic}`);
      client.subscribe(topic, err => {
        console.log(`[logs][mqtt][${deviceId}]subscribe topic success, topic = ${topic}`);
        if (callback && i + 1 == BasicSubscribeTopic.length) {
          sendMessageToMain("onconnect", { deviceId, code: 200 });
        }
      });
    }
    //  store device connection object
    clientMap.set(deviceId, {
      client,
      msgId: uuid.v1()
    });
  });
  //  Reconnect
  client.on("reconnect", () => {
    connectTime++;
    console.log(`[logs][mqtt][${deviceId}]Reconnecting, connectTime = ${connectTime}`);
    if (connectTime > 5) {
      console.log(`[logs][mqtt][${deviceId}]Reconnect failed, connectTime = ${connectTime}`);
      // map Delete from Map
      client.unsubscribe(BasicSubscribeTopic);
      client.end();
      client = null;
      sendMessageToMain("onconnect", { deviceId, code: 500 });
    }
  });
  //  Accept Message
  client.on("message", function (topic, message) {
    // message is Buffer
    const shortTopic = topic.slice(topic.indexOf("/", topic.indexOf("/") + 1));
    console.log(
      `[logs][mqtt][${deviceId}] msg received: shortTopic = ${shortTopic}, message = ${JSON.parse(message)}`
    );
    try {
      msgStr = message ? message.toString() : "";
      // console.log(
      //   `[logs][mqtt][${deviceId}] msg received: shortTopic = ${shortTopic}, message = ${msgStr}`
      // );
      if (isEncrypt) {
        let EncrypteData = JSON.parse(msgStr)
        let EncrypteDataStr = EncrypteData.p
        const saltLength = parseInt(EncrypteDataStr.substring(0, 2), 10);
        const salt = EncrypteDataStr.substring(2, 2 + saltLength);
        const encryptedStr = EncrypteDataStr.substring(2 + saltLength);
        const decodedData = decodeParamStr(encryptedStr, salt);
        messageCallback(deviceId, shortTopic, decodedData);
      } else {
        messageCallback(deviceId, shortTopic, msgStr);
      }
    } catch (error) {
      console.error(
        `[logs][mqtt][${deviceId}] msg handle error: shortTopic = ${shortTopic}, message = ${msgStr}, err = `,
        error
      );
    }
  });
  //  Broker Disconnect
  client.on("disconnect", () => {
    // map Delete from Map
    client.unsubscribe(BasicSubscribeTopic);
    clientMap.delete(deviceId);
    console.log(`[logs][mqtt][${deviceId}]raw mqtt connection closed, map length is`, clientMap.size());
  });
  //  Client Offline
  client.on("offline", function () {
    console.log(`[mqtt][mqtt][${deviceId}]client offline`);
    // map Delete from Map
    client.unsubscribe(BasicSubscribeTopic);
    clientMap.delete(deviceId);
  });

  //  Client Close
  client.on("close", function () {
    console.log(`[logs][mqtt][${deviceId}] client Close`);
  });
  //  Connect or Parse Error
  client.on("error", function (error) {
    if (callback) sendMessageToMain("onconnect", { deviceId, code: 500 });
    console.log(`[logs][mqtt][${deviceId}]mqtt error happened, error = `, error);
  });
};

closeClient = deviceId => {
  console.log(`[logs][mqtt][${deviceId}]MqttClient.closeClient`);
  const clientObj = clientMap.get(deviceId);
  if (!clientObj) {
    return;
  }
  let client = clientObj.client;
  if (client) {
    client.unsubscribe(BasicSubscribeTopic);
    client.end();
    // map Delete from Map
    client = null;
    clientMap.delete(deviceId);
  }
};

publishMessage = (deviceId, topic, data) => {
  const clientObj = clientMap.get(deviceId);

  if (clientObj) {
    const url = `Dmp/${deviceId}/${topic}`;
    try {
      if (isEncrypt) {
        const salt = generateSalt();
        const encryptedData = encodeParamStr(JSON.stringify(data), salt);
        const saltWithLength = `${salt.length.toString().padStart(2, '0')}${salt}`;
        const realData = { p: saltWithLength + encryptedData };
        console.log(`【logs】【mqtt】【${deviceId}】 publish data, topic = ${topic}, data = `, data);

        clientObj.client.publish(url, JSON.stringify(realData));
      } else {
        clientObj.client.publish(url, JSON.stringify(data));
      }
    } catch (e) {
      console.error(`[logs][mqtt][${deviceId}]publish error:`, e);
    }
  }
};

const messageCallback = (deviceId, topic, message) => {
  sendMessageToMain("messageCallback", { deviceId, topic, message });
};

// 
self.onmessage = e => {
  const { message } = e.data;
  if (message == "connectClient") {
    const { deviceId, password, url, port, callback } = e.data.data;
    connectClient(deviceId, password, url, port, callback);
  } else if (message == "closeClient") {
    const { deviceId } = e.data.data;
    closeClient(deviceId);
  } else if (message == "publishMessage") {
    const { deviceId, topic, data } = e.data.data;
    const clientObj = clientMap.get(deviceId);
    if (!clientObj) {
      console.log("Please connect device first :<");
      return;
    }
    publishMessage(deviceId, topic, data);
  }
};
// 
function sendMessageToMain(funName, data) {
  self.postMessage({
    message: funName,
    data
  });
}
