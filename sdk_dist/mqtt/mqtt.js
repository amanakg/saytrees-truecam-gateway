const mqttWorker = new Worker("./mqtt/mqttWorker.js");
const MqttClient = {};
const connectCallbackMap = new Map();

/**
 * @description: mqtt
 * @param {*} deviceId
 * @param {*} password
 * @param {*} url
 * @param {*} callback
 * @return {*}
 */
MqttClient.connectClient = (deviceId, password, url, port, callback) => {
  sendMessageToWorker("connectClient", {
    deviceId,
    password,
    url,
    port,
    callback: true
  });
  connectCallbackMap.set(deviceId, callback);
};
MqttClient.closeClient = deviceId => {
  sendMessageToWorker("closeClient", {
    deviceId
  });
};
MqttClient.publishMessage = (deviceId, topic, data) => {
  sendMessageToWorker("publishMessage", {
    deviceId,
    topic,
    data
  });
};
const messageCallback = (deviceId, topic, message) => {
  console.log("mqtt messageCallback", deviceId, topic, message);
  switch (topic) {
    case "/Thing/getDeviceModelResponse":
      MqttAction.getDeviceModelResponse(deviceId, message);
      break;
    case "/Thing/setDevicePropertyResponse":
      MqttAction.setDevicePropertyResponse(deviceId, message);
      break;
    case "/Device/executeDeviceActionResponse":
      MqttAction.executeDeviceActionResponse(deviceId, message);
      break;
    case "/Thing/getDevicePropertyResponse":
      MqttAction.getDevicePropertyResponse(deviceId, message);
      break;
    case "/Ota/reportUpgradeProgress":
      MqttAction.reportUpgradeProgress(deviceId, message);
      break;
  }
};

mqttWorker.addEventListener("message", function (param) {
  const { data } = param;
  if (data.message == "onconnect") {
    const { deviceId, code } = data.data;
    let callback = connectCallbackMap.get(deviceId);
    if (callback) {
      callback(code);
      callback = null;
      connectCallbackMap.delete(deviceId);
    }
  } else if (data.message == "messageCallback") {
    const { deviceId, topic, message } = data.data;
    // const string = new TextDecoder().decode(message);
    // const resMessage = JSON.parse(string);
    const resMessage = JSON.parse(message);
    messageCallback(deviceId, topic, resMessage);
  }
});
function sendMessageToWorker(funName, data) {
  mqttWorker.postMessage({
    message: funName,
    data
  });
}
