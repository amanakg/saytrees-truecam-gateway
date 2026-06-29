// mqtt
let mqttUrl = {
  ipv4: "",
  ipv6: "",
  mqtt_port: "",
  mqtt_ports: ""
};
var playbackNum = 0;
var recorder = null;
var splitdata = new window.JASplitData();
// var access_token = '31.b9d33ee19c9b206a3e99229fa7cb15fa.2592000.1770164841.3497206-1980552223852412928'
var access_token = '31.3891bed191cdf7d20e09c12dbe607e30.2592000.1770711523.16533677-1971845300634337280'
const productObjectModel = {
  // `productId`: `model`
}

//canvas
function init() {
  let canvas = document.getElementById("canvas1");
  Player.init([canvas]);
  window.onorientationchange = function () {
    alert(1);
  };
}
init();
// mqtt，
function onResolv(deviceId, mqtt_ipv4, mqtt_ipv6, mqtt_port, mqtts_port, ws_port, wss_port, mqttDomain) {
  // ipv4，ipv6
  console.log(
    `Device ID: ${deviceId}, mqtt address: ${mqtt_ipv4}, ${mqtt_ipv6}, ${mqtt_port}, ${mqtts_port}, ${ws_port}, ${wss_port}, ${mqttDomain}`
  );
  //mqtts_port。
  mqttUrl = {
    ipv4: mqtt_ipv4.replace(/\./g, "-") + "." + mqttDomain,
    ipv6: mqtt_ipv6,
    ws_port,
    wss_port,
    mqtt_port,
    mqtts_port
  };
  toConnectMqtt(deviceId);
}

function connect() {
  // init();
  var devid = document.getElementById("dev_id").value;
  var user = document.getElementById("user").value;
  var pwd = document.getElementById("pwd").value;
  var streamid = parseInt(document.getElementById("streamtype").value);
  var channel = document.getElementById("channel").value ? parseInt(document.getElementById("channel").value) : 0;
  var wss = "wss";
  if ("https:" == location.protocol) {
    wss = "wss";
  }
  wss = "wss";
  Player.ConnectDevice(devid, "", user, pwd, 0, 80, 0, channel, streamid, wss, onResolv);
}
function connectByIP() {
  // init();
  var ip = document.getElementById("dev_ip").value;
  var user = document.getElementById("user").value;

  var devid = document.getElementById("dev_id").value.split(":");
  var tmp = devid[0] + "quhX9w,OTQNd.kj#" + devid[1] + "-6j7.@3yHo7qIprG" + devid[2];
  var md5_res = stringChangeMd5(tmp);
  var pwd = md5_res.substr(8, 16);
  var streamid = parseInt(document.getElementById("streamtype").value);
  var channel = document.getElementById("channel").value ? parseInt(document.getElementById("channel").value) : 0;
  Player.ConnectDevice("", ip, user, pwd, 0, 10010, 0, channel, streamid, "wss", null);
}

function disconnect() {
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    closevideo();
    Player.DisConnectDevice(tmp[1]);
    toDisconnectMqtt();
  } else {
    closevideo();
    Player.DisConnectDevice(devid);
  }
}

function disconnectByIP() {
  closevideo();
  var devip = document.getElementById("dev_ip").value;
  Player.DisConnectDevice("", devip);
}

function openvideo() {
  playerList[0].SetStreamMode(0);
  var streamid = parseInt(document.getElementById("streamtype").value);
  var channel = parseInt(document.getElementById("channel").value);
  document.getElementById("channel").disabled = true;
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    Player.OpenStream(tmp[1], "", channel, streamid, 0);
  } else {
    Player.OpenStream(devid, "", channel, streamid, 0);
  }
}

function openVideoByIp() {
  var devip = document.getElementById("dev_ip").value;
  var streamid = parseInt(document.getElementById("streamtype").value);
  var channel = parseInt(document.getElementById("channel").value);
  Player.OpenStream("", devip, channel, streamid, 0);
}

function closevideo() {
  Player.CloseStream(0);
}

function changestream() {
  //closevideo();
  var obj = document.getElementById("streamtype");
  if (obj.value == 0) {
    obj.value = 1;
  } else if (obj.value == 1) {
    obj.value = 2;
  } else {
    obj.value = 0;
  }
  //openvideo();
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.ChangeStream(devid, "", channel, obj.value);
}

function searchrecord(event) {
  var recListTable = document.getElementById("recListTable");
  document.getElementById("div_recList").style.display = "";
  for (let i = recListTable.rows.length - 1; i >= 1; i--) {
    recListTable.deleteRow(i);
  }

  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  const beginTimeStr = document.getElementById("playback_startTime").value;
  const endTimeStr = document.getElementById("playback_endTime").value;
  const begintime = parseInt(Date.parse(beginTimeStr) / 1000) - new Date().getTimezoneOffset() * 60;
  const endtime = parseInt(Date.parse(endTimeStr) / 1000) - new Date().getTimezoneOffset() * 60;

  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.SreachRecord(devid, "", channel, begintime, endtime, 15);
  const frame = document.getElementById('div_recList')
  frame.style.left = `${event.pageX}px`
  frame.style.top = `${event.pageY}px`
  frame.style.display = 'block'
}

function playback_byTime() {
  let devid = document.getElementById("dev_id").value;
  const channel = document.getElementById("channel").value;
  const beginTimeStr = document.getElementById("playback_startTime").value;
  const endTimeStr = document.getElementById("playback_endTime").value;
  const begintime = parseInt(Date.parse(beginTimeStr) / 1000) - new Date().getTimezoneOffset() * 60;
  const endtime = parseInt(Date.parse(endTimeStr) / 1000) - new Date().getTimezoneOffset() * 60;
  console.log('playback_byTime: ', begintime + ", " + endtime);
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  playerList[0].SetStreamMode(1);
  Player.StartPlayBack(devid, "", channel, begintime, endtime, 15, 0, false, 0);
}

function playSelectedDate() {
  let devid = document.getElementById("dev_id").value;
  const channel = document.getElementById("channel").value;
  const playback_startTime = document.getElementById("searchVideoDates").value;
  console.log('playback_startTime', playback_startTime);
  const startTime = (Date.parse(playback_startTime)) / 1000// + new Date().getTimezoneOffset() * 60;
  const endTime = startTime + 60 * 60 * 24;
  const tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  playerList[0].SetStreamMode(1)
  Player.StartPlayBack(devid, '', channel, startTime, endTime, 15, 0, false, 0);
}

function changePlaySpeed(speed) {
  Player.changeSpeed(0, speed);
}

function playbacktodown(startTime, endTime, file_type) {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }

  Player.StartPlayBack(devid, '', channel, startTime, endTime, file_type, 0, false, 1);

  window.downloadBeginTime = startTime * 1000;
  window.downloadEndTime = endTime * 1000;
  window.useTimeStart = Date.now();
  window.downloadSize = 0;
  console.log("indexoverTime", window.downloadEndTime);
}

function playbackBySpecNum(num, tasktype = 0) {
  const list = getRecordList();
  if (!list || list.length == 0) {
    alert('Please search record first.');
    return;
  }
  playbackNum = num;
  if (playbackNum < 0) playbackNum = 0;
  else if (playbackNum >= list.length - 1) playbackNum = list.length - 1;

  const startTime = list[playbackNum].file_begintime;
  const endTime = list[playbackNum].file_endtime;
  document.getElementById("startTime").textContent = new Date(
    (startTime + new Date().getTimezoneOffset() * 60) * 1000
  ).toLocaleString();
  document.getElementById("endTime").textContent = new Date(
    (endTime + new Date().getTimezoneOffset() * 60) * 1000
  ).toLocaleString();

  let devid = document.getElementById("dev_id").value;
  const channel = document.getElementById("channel").value;
  const tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.StartPlayBack(devid, '', channel, startTime, endTime, list[playbackNum].file_type, 0, false, tasktype)
}

function playbacknext() {
  playbackBySpecNum(playbackNum + 1);
}

function playbackprev() {
  playbackBySpecNum(playbackNum - 1);
}

function playbackpause() {
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.PausePlayBack(devid, "", 0);
}

function playbackcontinue() {
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.ContinuePlayBack(devid, "", 0);
}

function stopplayback() {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.StopPlayBack(devid, "", channel);
}

function searchVideoDates() {
  const currentTimestampMillis = Date.now();
  const endTime = Math.floor(currentTimestampMillis / 1000);
  const oneYearAgoTimestampMillis = currentTimestampMillis - (365 * 24 * 60 * 60 * 1000);
  const beginTime = Math.floor(oneYearAgoTimestampMillis / 1000);

  const data = {
    RecordScheduleDateInfo: [{
      ChnNum: parseInt(document.getElementById("channel").value),
      BeginTimeS: beginTime,
      EndTimeS: endTime
    }]
  };
  const { deviceId, deviceSecret } = getTripleId();
  MqttAction.executeDeviceAction(deviceId, deviceSecret, 'R.CheckRecDay', data, (deviceId, message) => {
    const results = JSON.parse(message.msg.payload.data.outputParams[0].value).RecordScheduleDateInfo[0];
    console.log('R.CheckRecDay', results)
    if (!results.RecordDay) {
      return;
    }
    const selectDate = document.getElementById("searchVideoDates");
    selectDate.innerHTML = '';
    const fillZero = (num) => num < 10 ? `0${num}` : num.toString();
    results.RecordDay.forEach(str => {
      const regex = /0x[a-fA-F0-9]+/g;
      const Hexstr = str.match(regex);

      const Hex = parseInt(Hexstr[0]).toString(2);
      const Hexlist = Hex.split("").reverse();
      const Datestr = str.substring(0, 8);
      for (let index = 0; index <= Hexlist.length; index++) {
        if (Hexlist[index] == 1) {
          const value = Datestr + fillZero(index + 1);
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          selectDate.appendChild(option);
        }
      }
    });
  }
  );
}

function opencall() {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.OpenCall(devid, "", channel);
}

function speakingcall() {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  if (recorder !== null) recorder.close();
  var recordAudioCallback = function (int16) {
    var unit8data = new Uint8Array(int16.buffer);
    splitdata.feed(unit8data);
  };
  window.JARecorder.get(
    rec => {
      recorder = rec;
      recorder.start();
    },
    {
      inputCallback: recordAudioCallback
    }
  );
  splitdata.outputData = function (unit8data) {
    Player.CallSend(
      devid,
      "",
      channel,
      parseInt(new Date().getTime() / 1000),
      "G711A",
      8000,
      16,
      1,
      1,
      unit8data,
      unit8data.length
    );
  };
}

function stopspeaking() {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  recorder && recorder.stop();
  splitdata.close();
}

function closecall() {
  recorder && recorder.close();
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.CallHangup(devid, "", channel);
}

function snapshot() {
  Player.Snapshot(0, 0, "test", 1280, 720, null);
}

function openaudio() {
  Player.OpenAudio(0);
}

function closeaudio() {
  Player.CloseAudio(0);
}

//button
function downloadVideo(startTime, endTime, file_type) {
  console.log("downloadVideo", startTime, endTime, file_type);
  //  Pause playback when downloading
  document.getElementById("startTime").innerHTML = new Date(
    (startTime + new Date().getTimezoneOffset() * 60) * 1000
  ).toLocaleString();
  document.getElementById("endTime").innerHTML = new Date(
    (endTime + new Date().getTimezoneOffset() * 60) * 1000
  ).toLocaleString();

  playbacktodown(startTime, endTime, file_type);
}

function downloadVideoSpecifyTime() {
  document.getElementById("downSpecifyTimeProcess").style.width = '0%';
  const startTimeStr = document.getElementById("download_startTime").value;
  const endTimeStr = document.getElementById("download_endTime").value;

  const offsetTime = new Date().getTimezoneOffset() * 60;
  const startTime = Date.parse(startTimeStr) / 1000 - offsetTime;
  const endTime = Date.parse(endTimeStr) / 1000 - offsetTime;
  if (endTime - startTime > 60 * 10) {
    alert('Please select a duration less than 10min')
    return
  }
  window.downloadSpecifyTime = true;
  downloadVideo(startTime, endTime, 15);
}

function onLoginDevice() {
  let session = null;
  var id = document.getElementById("dev_id").value;
  var tmp = id.split(":");
  if (tmp.length != 3) return;
  session = GetSessionById(tmp[1]);
  ConnectApi.login(session, "admin", tmp[2], true);
}

function showRecordList(SearchRecList) {
  SearchRecList.map((recordItem, index) => {
    let file_type = recordItem.file_type;
    let file_begintime = recordItem.file_begintime;
    let file_endtime = recordItem.file_endtime;
    let INDEX = index;
    const lang = "en_US";
    var recListTable = document.getElementById("recListTable");

    const newRow = recListTable.insertRow(index + 1);

    const td_index = newRow.insertCell(0);
    const td_begin = newRow.insertCell(1);
    const td_end = newRow.insertCell(2);
    const td_times = newRow.insertCell(3);
    const td_type = newRow.insertCell(4);
    const cell5 = newRow.insertCell(5);
    const td_play = newRow.insertCell(6);
    var td_download = document.createElement("button");
    td_download.id = "rowBtn" + INDEX
    td_download.startTime = file_begintime;
    td_download.endTime = file_endtime;
    td_download.file_type = file_type;
    td_download.innerHTML = "download";
    window.downloadButton = td_download;
    window.downloadCell = cell5;
    td_download.addEventListener("click", function () {
      // console.log(td_download.id)
      window.useTimeStart = Date.now();
      window.downloadSpecifyTime = false;
      window.downloadSize = 0;
      downloadVideo(this.startTime, this.endTime, this.file_type);
    })
    // console.log(td_download)
    cell5.appendChild(td_download)
    td_play.innerHTML =
      '<a href="javascript:playRecord(' + file_begintime + "," + file_endtime + ", " + file_type + ')">Play</a>';

    td_index.innerText = INDEX;
    td_begin.innerText = new Date((file_begintime + new Date().getTimezoneOffset() * 60) * 1000).toLocaleString();
    td_end.innerText = new Date((file_endtime + new Date().getTimezoneOffset() * 60) * 1000).toLocaleString();
    td_times.innerText = file_endtime - file_begintime;
    if (file_type == 1) {
      td_type.innerText = lang == "zh_CN" ? "" : "Schedule recording";
    } else {
      td_type.innerText = lang == "zh_CN" ? "" : "Alarm recording";
    }

    td_index.style = "border:solid 1px black; padding: 4px 8px;";
    td_begin.style = "border:solid 1px black; padding: 4px 8px;";
    td_end.style = "border:solid 1px black; padding: 4px 8px;";
    td_times.style = "border:solid 1px black; padding: 4px 8px;";
    td_type.style = "border:solid 1px black; padding: 4px 8px;";
    cell5.style = "border:solid 1px black; padding: 4px 8px;";
    td_play.style = "border:solid 1px black; padding: 4px 8px;";
  });
}

function playRecord(tBegin, tEnd, tType, index) {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  Player.StartPlayBack(devid, "", channel, tBegin, tEnd, 255, 0, false, 0);
  document.getElementById("div_recList").style.display = "none";
  document.getElementById("startTime").innerHTML = new Date(
    (tBegin + new Date().getTimezoneOffset() * 60) * 1000
  ).toLocaleString();
  document.getElementById("endTime").innerHTML = new Date(
    (tEnd + new Date().getTimezoneOffset() * 60) * 1000
  ).toLocaleString();
}

function getTripleId() {
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length != 3) return;
  return {
    deviceId: tmp[1],
    deviceSecret: tmp[2]
  };
}
// mqtt
async function toConnectMqtt(deviceId) {
  var devid = document.getElementById("dev_id").value;
  var channel = document.getElementById("channel").value;
  var tmp = devid.split(":");

  if (tmp.length == 3) {
    devid = tmp[1];
  }
  var deviceSecret = tmp[2];
  // ，
  let protocol = "";
  let port = 0;
  let url = "";
  if (deviceId.includes(".")) {
    protocol = mqttUrl.mqtts_port > 0 ? "mqtts" : "mqtt";
    port = mqttUrl.mqtts_port > 0 ? mqttUrl.mqtts_port : mqttUrl.mqtt_port;
    url = devid;
  } else {
    protocol = mqttUrl.wss_port > 0 ? "wss" : "ws";
    port = mqttUrl.wss_port > 0 ? mqttUrl.wss_port : mqttUrl.ws_port;
    url = mqttUrl.ipv4;
  }
  MqttClient.connectClient(devid, deviceSecret, url, port);
}
// mqtt
function toDisconnectMqtt() {
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length == 3) {
    devid = tmp[1];
  }
  MqttClient.closeClient(devid);
}
// 
function setDeviceProperty() {
  var devid = document.getElementById("dev_id").value;
  var tmp = devid.split(":");
  if (tmp.length != 3) return;
  const propertiesStr = document.getElementById("setDeviceProperty_str").value
  const properties = JSON.parse(propertiesStr)
  properties.map(item => {
    let value = item.value
    if (Array.isArray(value) || typeof value === 'object') {
      item.value = JSON.stringify(value)
    }
  })
  // const value = properties[0].value
  // if (Array.isArray(value) || typeof value === 'object') {
  //   properties[0].value = JSON.stringify(value)
  // }
  MqttAction.setDeviceProperty(tmp[1], tmp[2], properties);
}
// 
function getDeviceProperty() {
  let value = [];
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  let valueStr = document.getElementById("getDeviceProperty_str").value
  value = JSON.parse(valueStr)
  MqttAction.getDeviceProperty(deviceId, deviceSecret, value, (code, res) => {
    console.log("getDevicePropertyRes", code, res);
  });
}

function onRTMPStart() {
  const { deviceId, deviceSecret } = getTripleId();
  var log = {
    url: "rtmp://192.168.23.180:1935/LiveApp/test",
    channel: 0
  };
  const properties = [
    {
      propertyName: "logupload",
      id: 10200,
      type: 1,
      value: JSON.stringify(log)
    }
  ];
  MqttAction.setDeviceProperty(deviceId, deviceSecret, properties);
}

function onRTMPStop() {
  const { deviceId, deviceSecret } = getTripleId();
  var log = {
    url: "",
    channel: 0
  };
  const properties = [
    {
      propertyName: "logupload",
      id: 10200,
      type: 1,
      value: JSON.stringify(log)
    }
  ];
  MqttAction.setDeviceProperty(deviceId, deviceSecret, properties);
}
// 
function lightControl(lightState) {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  let durSec = 60;
  if (lightState == "OFF") {
    durSec = 0;
  }
  MqttAction.executeDeviceAction(
    deviceId,
    deviceSecret,
    "R.LightManCtrl",
    {
      Operate: lightState,
      DurSec: durSec
    },
    (deviceId, message) => {
      console.log("Lighting!", deviceId, message);
    }
  );
}
// 
function alarmLightControl(lightState) {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.AlarmLightManCtrl", {
    Operate: lightState,
    DurSec: 600
  });
}
// 
/**
 * @description: 
 * @param {*} direction PTZ Cmd: MoveLeft, MoveRight, MoveUp, MoveDown, Stop, SetPreset, ClearPreset, GotoPreset
 * @param {*} arg ： For preset：Preset Number
 * @param {*} speed  6 1-10 Default is 6, range from 1 to 10
 * @return {*}
 */
function ptzControl(direction, arg = 0, speed = 6) {
  // direction:
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.PTZ.Control", {
    Cmd: direction,
    Arg: arg,
    Speed: speed
  });
}
/**
 * @description: 
 * @param {*} act ，， SetPreset, ClearPreset, GotoPreset
 * @return {*}
 */
function presetControl(act) {
  const { deviceId, deviceSecret } = getTripleId();
  // Preset Index   1 PresetID, start from 1
  let index = Number(document.getElementById("presetName").value);
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.PTZ.Preset", {
    Index: index,
    Act: act
  });
}
/**
 * @description: 
 * @param {*} mode 0  Stop，1  Panoramic cruise control，2  Fixed-point cruise control
 * @return {*}
 */
function cruiseControl(mode = 0) {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.PTZ.Cruise", {
    Mode: mode
  });
}

/**
 * @description: Format TF Card
 * @param {*}
 * @return {*}
 */
function formatTFCard() {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.TFManager", {
    Operate: "format"
  });
}

/**
 * @description: Get TF Card Status
 * @param {*}
 * @return {*}
 */
function getTFCardStatus() {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.Sync.Stat.TF", {}, (deviceId, message) => {
    console.log("getTFCardStatusRes", deviceId, message);
    const data = JSON.parse(message.msg.payload.data.outputParams[0].value)
    document.getElementById("Tfstatus").textContent = `${data.Status}`;
    document.getElementById("TFtotalSize").textContent = `${data.TotalSpacesize}MB`;
    document.getElementById("TFLeaveSize").textContent = `${data.LeaveSpacesize}MB`;
  });
}

/**
 * @description: Get AP Info
 * @param {*}
 * @return {*}
 */
function getApInfo() {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.APInfoGet", {}, (deviceId, message) => {
    console.log("getApInfoRes", deviceId, message);
    const data = JSON.parse(message.msg.payload.data.outputParams[0].value)
    if (data.APInfo.length === 0) {
      alert("No AP found");
      return;
    }
    const select = document.getElementById('AP_list');
    select.innerHTML = '';
    for (const ap of data.APInfo) {
      const option = document.createElement('option');
      option.value = ap.SSID;
      option.textContent = atob(ap.SSID); // decode SSID
      select.appendChild(option);
    }
  });
}

/**
 * @description: Get Network Info
 * @param {*}
 * @return {*}
 */
function getNetworkInfo() {
  const { deviceId, deviceSecret } = getTripleId();
  if (!deviceId) return;
  MqttAction.executeDeviceAction(deviceId, deviceSecret, "R.Sync.Stat.NetWork", {}, (deviceId, message) => {
    console.log("getNetworkInfoRes", deviceId, message);
    const data = JSON.parse(message.msg.payload.data.outputParams[0].value)
    document.getElementById("networkInfo").value = JSON.stringify(data, null, 2);
  });
}

// document.getElementById("playback_time").value = new Date().toLocaleDateString() + " 00:00:00";
document.getElementById("playback_startTime").value = new Date().toLocaleDateString() + " 00:00:00";
document.getElementById("playback_endTime").value = new Date().toLocaleDateString() + " 23:59:59";
document.getElementById("download_startTime").value = new Date().toLocaleDateString() + " 00:00:00";
document.getElementById("download_endTime").value = new Date().toLocaleDateString() + " 23:59:59";

const loginBtn = document.getElementById('loginBtn')
const objectModel = document.getElementById('getObjectBtn')

loginBtn.addEventListener('click', async () => {
  const account = document.getElementById('login-account').value
  const password = document.getElementById('login-password').value
  if (!account || !password) {
    alert('please enter your account or password!')
    return
  }
  try {
    access_token = await ConnectApi.userLogin(account, password)
  } catch (error) {
    console.error(error)
    if (error.msg) {
      alert(error.msg)
    } else if (error.message) {
      alert(error.message)
    }
    return
  }

  if (access_token) {
    console.log(access_token)
    alert('login success!')
  }
})

objectModel.addEventListener('click', async () => {
  const devId = document.getElementById('dev_id').value.split(':')[1]
  if (!devId) {
    alert('deviceID can not be empty')
    return
  }
  if (!access_token) {
    alert('please login first')
    return
  }
  try {
    const res = await ConnectApi.getDeviceModal(devId)
    console.log('objectModel is:', res.data.data.productFun)
  } catch (error) {
    console.error(error)
    if (error.data.msg) {
      alert(error.data.msg)
    }
  }
})
async function getDeviceList() {
  if (!access_token) {
    alert('please login first')
    return
  }
  let res = await ConnectApi.getDeviceList()
  console.log("getDeviceList", res);
  let deviceList = res.data.data.list;
  let select = document.getElementById("dev_id");
  let option = ``;
  for (const device of deviceList) {
    let deviceParams = device.deviceParams;
    option += `<option value="${deviceParams.productId}:${deviceParams.deviceUuid}:${deviceParams.deviceSecret}">${deviceParams.deviceUuid}</option>`;
  }
  select.innerHTML = option;
}

async function getDeviceName(deviceId) {
  const res = await ConnectApi.getDeviceList()
  const device = res.data.data.list.find(item => item.deviceId === deviceId)
  if (!device) {
    alert('device not found')
    return
  }
  return device.nickname
}
async function startRecord() {
  const { deviceId } = getTripleId();
  if (!deviceId) return;
  const deviceName = await getDeviceName(deviceId)
  const date = new Date()
  const dateStr = `${date.getFullYear()}${date.getMonth()}${date.getDate()}${date.getHours()}${date.getMinutes()}${date.getSeconds()}`;
  const fileName = `${deviceName}_${dateStr}`
  Player.ctrlRecordOn(0, fileName, res => {
    if (!res) {
      alert('Record failed')
    }
  })
}

function endRecord() {
  Player.ctrlRecordOff(0)
}

function getProperty(propertys, callback) {
  console.log("propertyParams: ", propertys)
  const device = getTripleId();
  if (!device) return;
  callback = callback || ((code, res) => console.log("getDevicePropertyRes", code, res))
  MqttAction.getDeviceProperty(device.deviceId, device.deviceSecret, propertys, callback);
}

function setProperty(propertys, callback) {
  console.log('propertyParams: ', propertys)
  const device = getTripleId();
  if (!device) return;
  callback = callback || ((code, res) => console.log("setDevicePropertyRes", code, res))
  MqttAction.setDeviceProperty(device.deviceId, device.deviceSecret, propertys, callback);
}

async function getPropertyByName(propertyNames, callback) {
  const { productId, deviceId } = getId()
  const model = await getProductObjectModel(productId, deviceId)
  const propertys = model
    .filter(item => propertyNames.includes(item.funCode))
    .map(item => ({ propertyName: item.funCode, id: item.funId })
    )
  if (!propertys.length) {
    alert('Found nothing')
    return

  }
  getProperty(propertys, callback)
}

async function getProductObjectModel(productId, deviceId) {
  if (!productId || !deviceId) {
    const deviceInfo = getId()
    productId = deviceInfo.productId
    deviceId = deviceInfo.deviceId
  }
  if (productObjectModel[productId]) {
    return productObjectModel[productId]
  }
  if (!access_token) {
    alert('please login first')
    return
  }
  const res = await ConnectApi.getDeviceModal(deviceId)
  productObjectModel[productId] = res.data.data.productFun
  return res.data.data.productFun
}

// get deviceId and productId
function getId() {
  const deviceInfo = document.getElementById('dev_id').value
  if (!deviceInfo) {
    alert('deviceId can not be empty')
    return
  }
  const productId = deviceInfo.split(':')[0]
  const deviceId = deviceInfo.split(':')[1]
  return { productId, deviceId }
}

async function findObjectModel(funCodes) {
  const model = await getProductObjectModel()
  if (typeof funCodes === 'string') {
    return model.find(item => item.funCode === funCodes)
  } else if (Array.isArray(funCodes)) {
    return model.filter(item => funCodes.includes(item.funCode))
  }
}

async function getOptionsFromModel(propertyName, elementId) {
  const model = await getProductObjectModel()
  const property = model.find(item => item.funCode === propertyName)
  console.log('property', property)
  if (!property) {
    alert('Found nothing with propertyName: ' + propertyName)
    return
  }
  const select = document.getElementById(elementId)
  select.innerHTML = ''
  for (const option of property.funContent.typeSpec.range) {
    const optionElement = document.createElement('option')
    optionElement.value = option
    optionElement.textContent = option
    select.appendChild(optionElement)
  }
}

async function getStreamPara() {
  const params = [
    {
      propertyName: 'Video.Input[0].Venc[0].Resolution',  // main
      id: 20232
    },
    {
      propertyName: 'Video.Input[0].Venc[1].Resolution',  // sub
      id: 20233
    }
  ]
  await getOptionsFromModel(params[0].propertyName, 'mainResolution')
  await getOptionsFromModel(params[1].propertyName, 'subResolution')

  getProperty(
    params,
    (code, res) => {
      console.log('getStreamPara', res)
      const mainRes = res.find(item => item.propertyName === params[0].propertyName)
      document.getElementById('mainResolution').value = mainRes.value
      const subRes = res.find(item => item.propertyName === params[1].propertyName)
      document.getElementById('subResolution').value = subRes.value
    }
  )
}

async function getPropertyWithOptions(propertyName, id, elementId) {
  await getOptionsFromModel(propertyName, elementId)
  getStringProperty(propertyName, id, elementId)
}

async function setStreamPara() {
  const mainResolution = document.getElementById('mainResolution').value
  const subResolution = document.getElementById('subResolution').value
  if (!mainResolution || !subResolution) {
    alert('resolution can not be empty')
    return
  }
  const params = [
    {
      propertyName: 'Video.Input[0].Venc[0].Resolution',  // main
      type: 2,
      id: 20232,
      value: mainResolution
    },
    {
      propertyName: 'Video.Input[0].Venc[1].Resolution',  // sub
      type: 2,
      id: 20233,
      value: subResolution
    }
  ]
  setProperty(params)
}

function getFlipStatus() {
  const params = [{
    propertyName: 'Video.Input[0].FlipHorizontal',
    id: 20118
  }, {
    propertyName: 'Video.Input[0].FlipVertical',
    id: 20119
  }]
  getProperty(
    params,
    (code, res) => {
      console.log('getFlipStatus', res)
      const flipHorizontal = res.find(item => item.propertyName === params[0].propertyName)
      const flipVertical = res.find(item => item.propertyName === params[1].propertyName)
      document.getElementById('flipEnabled').checked = flipVertical.value
      document.getElementById('mirrorEnabled').checked = flipHorizontal.value
    }
  )
}

function setFlipStatus() {
  const flipEnabled = document.getElementById('flipEnabled').checked
  const mirrorEnabled = document.getElementById('mirrorEnabled').checked
  const params = [
    {
      propertyName: 'Video.Input[0].FlipHorizontal',
      type: 4,
      id: 20118,
      value: mirrorEnabled
    },
    {
      propertyName: 'Video.Input[0].FlipVertical',
      type: 4,
      id: 20119,
      value: flipEnabled
    }
  ]
  setProperty(params)
}

function getBooleanProperty(propertyName, id, elementId) {
  const params = [
    {
      propertyName,
      id
    }
  ]
  getProperty(
    params,
    (code, res) => {
      console.log('getBooleanProperty', res)
      if (res[0]?.value === undefined || res[0]?.value === null) {
        alert('There is something wrong with the property value. Maybe your device is not supported.')
        return
      }
      document.getElementById(elementId).checked = res[0].value
    }
  )
}

function setBooleanProperty(propertyName, id, elementId) {
  const value = document.getElementById(elementId).checked
  const params = [
    {
      propertyName,
      type: 4,
      id,
      value
    }
  ]
  setProperty(params)
}

function getIntProperty(propertyName, id, elementId) {
  const params = [
    {
      propertyName,
      id
    }
  ]
  getProperty(
    params,
    (code, res) => {
      console.log('getIntProperty', res)
      if (res[0]?.value === undefined || res[0]?.value === null) {
        alert('There is something wrong with the property value. Maybe your device is not supported.')
        return
      }
      document.getElementById(elementId).value = res[0].value
    }
  )
}

function setIntProperty(propertyName, id, elementId, min, max) {
  const value = document.getElementById(elementId).valueAsNumber
  if (min !== null && max !== null) {
    if (value < min || value > max) {
      alert(`value must be between ${min} and ${max}`)
      return
    }
  }
  const params = [
    {
      propertyName,
      type: 3,    // number
      id,
      value: parseInt(value)
    }
  ]
  setProperty(params)
}

function getStringProperty(propertyName, id, elementId) {
  const params = [
    {
      propertyName,
      id
    }
  ]
  getProperty(
    params,
    (code, res) => {
      console.log('getStringProperty', res)
      if (res[0]?.value === undefined || res[0]?.value === null) {
        alert('There is something wrong with the property value. Maybe your device is not supported.')
        return
      }
      const el = document.getElementById(elementId)
      if (el.tagName === 'SPAN' || el.tagName === 'div') {
        el.textContent = res[0].value
      } else {
        el.value = res[0].value
      }
    }
  )
}

function setStringProperty(propertyName, id, elementId) {
  const value = document.getElementById(elementId).value
  const params = [
    {
      propertyName,
      type: 1,  // string
      id,
      value
    }
  ]
  setProperty(params)
}

function displayRecList(event) {
  const frame = document.getElementById('div_recList')
  frame.style.left = `${event.pageX}px`
  frame.style.top = `${event.pageY}px`
  frame.style.display = 'block'
}

function hiddenRecList() {
  document.getElementById('div_recList').style.display = 'none'
}