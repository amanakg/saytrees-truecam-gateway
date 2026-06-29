const BasicPublishTopic = [
  "Thing/setDeviceProperty",
  "Device/executeDeviceAction",
  "Thing/getDeviceProperty",
  "Device/syncBindStatus"
];
const MqttAction = {};
const CallBackMap = new Map();
getNonce = () => {
  const charStr = "abcdefghijklmnopqrstuvwxyz0123456789";
  let res = "";
  for (let i = 0; i < 32; i++) {
    res += charStr.charAt(Math.floor(Math.random() * charStr.length));
  }
  return res;
};
generateSign = data => {
  const signKey = "46sw124kluj98bh6";
  const keys = Object.keys(data).sort((a, b) => a[0].charCodeAt(0) - b[0].charCodeAt(0));
  let string = "";
  for (let i = 0; i < keys.length; i++) {
    string += keys[i] + "=" + JSON.stringify(data[keys[i]]);
  }
  return stringChangeMd5(string + signKey);
};
/**
 * @description: Get Device Property
 * @param {*} deviceId
 * @param {*} deviceSecret
 * @return {*}
 */
MqttAction.getDeviceModel = (deviceId, deviceSecret) => {
  const payload = {
    sign: "afer34terhg45qydhfghdfghsehf",
    msg: {
      msgType: "thing.model.get",
      version: "v1",
      nonce: "asdagrg2rthgadf23rwefsd4323e",
      requestTime: new Date().valueOf(),
      deviceId,
      deviceSecret,
      payload: {
        msgId: "",
        data: {}
      }
    }
  };
  MqttAction.publishMessage(deviceId, "/Thing/getDeviceModel", payload);
};
/**
 * @description: Get Device Model Response
 * @param {*} deviceId
 * @param {*} message
 * @return {*}
 */
MqttAction.getDeviceModelResponse = (deviceId, message) => {
  if (message.payload.code == 200) {
    console.log(`There you go! The model of ${deviceId} is: \n ${message.payload.data.services}`);
  }
};

/**
 * @description: Set Device Property
 * @param {*} deviceId
 * @param {*} properties ["propertyName":"test", "id":102, "type":4, "value":true]
 * @return {*}
 */
MqttAction.setDeviceProperty = (deviceId, deviceSecret, properties, callback) => {
  const msgId = generateSign(uuid.v1());
  const msg = {
    msgType: "thing.property.set",
    version: "v1",
    nonce: getNonce(),
    requestTime: new Date().valueOf() / 1000,
    deviceId,
    deviceSecret,
    payload: {
      msgId: msgId,
      sys: {
        ack: 1
      },
      time: new Date().valueOf(),
      data: {
        properties
      }
    }
  };
  const payload = {
    msg,
    sign: generateSign(msg)
  };
  if (callback) {
    const InitCallBackList = {
      getDevicePropertyCallback: () => { },
      setDevicePropertyCallback: () => { },
      executeDeviceActionCallback: () => { }
    };
    let callbackObj = CallBackMap.get(deviceId + msgId) ? CallBackMap.get(deviceId + msgId) : InitCallBackList;
    callbackObj.setDevicePropertyCallback = callback;
    CallBackMap.set(deviceId + msgId, callbackObj);
  }
  MqttClient.publishMessage(deviceId, "Thing/setDeviceProperty", payload);
};
/**
 * @description: Set Device Property Response
 * @param {*} deviceId
 * @param {*} message
 * @return {*}
 */
MqttAction.setDevicePropertyResponse = (deviceId, message) => {
  const channel = 0;
  if (message.msg.payload.code == 200) {
    const msgId = message.msg.payload.msgId;
    CallBackMap.get(deviceId + msgId)?.setDevicePropertyCallback(deviceId, message);
    CallBackMap.delete(deviceId + msgId);
    console.log(`There you go! Setting ${deviceId} is Successful！`, message);
  } else {
    console.log(`Oops! Something wrong of ${deviceId}\n`, message.msg.payload);
  }
};

/**
 * @description: Execute Device Action
 * @param {*} deviceId
 * @param {*} deviceSecret
 * @param {*} actionName
 * @param {*} inputParams  [{"paramsName":"direction", "type":1,"value":"UP"}]
 * @return {*}
 */
MqttAction.executeDeviceAction = (deviceId, deviceSecret, actionName, actionValue, callback, id, inputParams) => {
  const msgId = generateSign(uuid.v1());
  const msg = {
    msgType: "thing.action.execute",
    version: "v1",
    nonce: getNonce(),
    requestTime: Math.round(new Date().valueOf() / 1000),
    deviceId,
    deviceSecret,
    payload: {
      msgId: String(msgId),
      sys: {
        ack: 1
      },
      time: Math.round(new Date().valueOf() / 1000),
      data: {
        actionName: actionName,
        id: id ? id : 1,
        inputParams: inputParams
          ? inputParams
          : [
            {
              paramsName: actionName,
              type: 1,
              value: JSON.stringify(actionValue)
            }
          ]
      }
    }
  };
  const payload = {
    msg,
    sign: generateSign(msg)
  };
  if (callback) {
    const InitCallBackList = {
      getDevicePropertyCallback: () => { },
      setDevicePropertyCallback: () => { },
      executeDeviceActionCallback: () => { }
    };
    let callbackObj = CallBackMap.get(deviceId + msgId) ? CallBackMap.get(deviceId + msgId) : InitCallBackList;
    callbackObj.executeDeviceActionCallback = callback;
    CallBackMap.set(deviceId + msgId, callbackObj);
  }
  MqttClient.publishMessage(deviceId, "Device/executeDeviceAction", payload);
};
/**
 * @description:  Set Device Property Response
 * @param {*} deviceId
 * @param {*} message
 * @return {*}
 */
MqttAction.executeDeviceActionResponse = (deviceId, message) => {
  if (message.msg.payload.code == 200) {
    const msgId = message.msg.payload.msgId;
    CallBackMap.get(deviceId + msgId)?.executeDeviceActionCallback(deviceId, message);
    CallBackMap.delete(deviceId + msgId);
    console.log(`There you go! Execute Action for ${deviceId} is Successful!`, message.msg.payload);
  } else {
    console.log(`Oops! Something wrong of ${deviceId}\n`, message);
  }
};

/**
 * @description: Get Device Property
 * @param {*} deviceId
 * @param {*} deviceSecret
 * @param {*} propertyNames ["foodRemaining"]
 * @return {*}
 */
MqttAction.getDeviceProperty = (deviceId, deviceSecret, propertyNames = [], callback) => {
  const msgId = generateSign(uuid.v1());
  const msg = {
    msgType: "thing.property.get",
    version: "v2",
    nonce: getNonce(),
    requestTime: Math.round(new Date().valueOf() / 1000),
    deviceId,
    deviceSecret,
    payload: {
      msgId: String(msgId),
      sys: {
        ack: 1
      },
      data: {
        propertyNames
      }
    }
  };
  let sign = generateSign({ msg });
  const payload = {
    msg,
    sign
  };
  if (callback) {
    const InitCallBackList = {
      getDevicePropertyCallback: () => { },
      setDevicePropertyCallback: () => { },
      executeDeviceActionCallback: () => { }
    };
    let callbackObj = CallBackMap.get(deviceId + msgId) ? CallBackMap.get(deviceId + msgId) : InitCallBackList;
    callbackObj.getDevicePropertyCallback = callback;
    CallBackMap.set(deviceId + msgId, callbackObj);
  }
  MqttClient.publishMessage(deviceId, "Thing/getDeviceProperty", payload);
};
/**
 * @description: Get Device Property Response
 * @param {*} deviceId
 * @param {*} message
 * @return {*}
 */
MqttAction.getDevicePropertyResponse = (deviceId, message) => {
  if (message.msg.payload.code == 200) {
    const msgId = message.msg.payload.msgId;
    let callbackObj = CallBackMap.get(deviceId + msgId);
    callbackObj?.getDevicePropertyCallback(message.msg.payload.code, message.msg.payload.data.properties);
    CallBackMap.delete(deviceId + msgId);
    console.log(`There you go! The Setting of ${deviceId} are:\n`, message);
  } else {
    console.log(`Oops! Something wrong of ${deviceId}\n`, message);
  }
};

MqttAction.syncBindStatus = (deviceId, deviceSecret, status) => {
  const payload = {
    sign: "afer34terhg45qydhfghdfghsehf",
    msg: {
      msgType: "bind.status.sync",
      version: "v1",
      nonce: "asdagrg2rthgadf23rwefsd4323e",
      requestTime: new Date().valueOf(),
      deviceId,
      deviceSecret,
      payload: {
        msgId: uuid.v1(),
        data: {
          status: status
        }
      }
    }
  };
  MqttClient.publishMessage(deviceId, "/Device/syncBindStatus", payload);
};
MqttAction.reportUpgradeProgress = (deviceId, message) => {
  if (message.msg.payload.code == 200) {
    console.log(`There you go! The Message of Upgrade Progress ${deviceId} is:\n ${message}`);
  }
};
window.MqttAction = MqttAction;
