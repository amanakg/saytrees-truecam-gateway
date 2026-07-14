let SearchRecList = []; //
let playerList = []; //
let sessionList = []; //
let useHttps = true; //httpswss
const Player = {};
/**
 * ID
 * @method GetSessionById
 * @param {string} devid ID
 * @return {object} session 
 */
function GetSessionById(devid) {
  // console.log("GetSessionById", sessionList);
  for (let i = 0; i < sessionList.length; i++) {
    // console.log("GetSessionById", sessionList);

    if (sessionList[i].deviceid == devid) {
      // console.log(sessionList[i]);
      return sessionList[i];
    }
  }
  return null;
}
/**
 * ip
 * @method GetSessionByIp
 * @param {string} ip ip
 *
 * 
 * @return {object} session 
 */
function GetSessionByIp(ip) {
  for (let i = 0; i < sessionList.length; i++) {
    if (sessionList[i].ip == ip) {
      // console.log(sessionList[i]);
      return sessionList[i];
    }
  }
  return null;
}
function setChunk(target, source) {
  let tmp = new Uint8Array(target.length + source.length);
  tmp.set(target, 0);
  tmp.set(source, target.length);
  target = tmp;
  return target;
}
/**
 *
 * 
 * @method GetSessionByWinindex
 * @param {number} winindex 
 * @return {object} session 
 */
function GetSessionByWinindex(winindex) {
  // console.log(sessionList);
  for (let i = 0; i < sessionList.length; i++) {
    for (let j = 0; j < sessionList[i].streamlist.length; j++) {
      if (sessionList[i].streamlist[j].winindex == winindex) {
        return sessionList[i];
      }
    }
  }
  return null;
}
/**
 * 
 * @method GetChannelByWinindex
 * @param {number} winindex 
 *
 * 
 * @return {number} channel 
 */
function GetChannelByWinindex(winindex) {
  for (let i = 0; i < sessionList.length; i++) {
    for (let j = 0; j < sessionList[i].streamlist.length; j++) {
      if (sessionList[i].streamlist[j].winindex == winindex) {
        return j; //channel
      }
    }
  }
  return -1;
}
function getRecordList(params) {
  return SearchRecList;
}
//p2p
/**
 * 
 * @method onrecvframeex
 * @param {object} api_conn 	
 * @param {number} frametype 	
 * @param {Buffer} data 		
 * @param {number} channel 		
 * @param {number} width 		
 * @param {number} height 		
 */
ConnectApi.onrecvframeex = function (api_conn, frametype, data, datalen, channel, width, height, enc, fps, timestamp) {
  //
  if (api_conn.streamlist[channel].winindex == -1) {
    return;
  }
  if (api_conn.isRecord) {
    if (frametype === 1) {
      api_conn.startRecord = true
    }
    if (api_conn.startRecord) {
      if (frametype != 0) {
        api_conn.recordObject.recordVideoChunk = setChunk(api_conn.recordObject.recordVideoChunk, data)
        api_conn.recordObject.recordVideoEnc = enc
        api_conn.recordObject.recordTimeStamp.push(timestamp)
      } else {
        api_conn.recordObject.recordAudioChunk = setChunk(api_conn.recordObject.recordAudioChunk, data)
        api_conn.recordObject.recordAudioEnc = enc
      }
    }
  }
  //，0
  if (frametype != 0) {
    data.recvtime = new Date().getTime();
    if (frametype == 1 || frametype == 2) {
      playerList[api_conn.streamlist[channel].winindex].fillframe_v2(
        data,
        datalen,
        enc,
        timestamp,
        width,
        height,
        frametype
      );
    } else {
      console.log("[onrecvframeex]", frametype, data);
    }
  } else {
    if (api_conn.streamlist[channel].isSound) {
      JAaudioplay.audioPlay(data, enc, datalen, width);
    }
  }
};


function setDownloadTimer(ts_ms, uid, channel) {
  downloadTimer = setTimeout(() => {
    if (window.downloadEndTime - ts_ms <= 3000) {
      exportChunkToVideo();
    } else {
      alert('The network is abnormal, the download has stopped, please try again later')
    }
    Player.StopPlayBack(uid, '', channel);
    resetDownloadChunk();
    window.downloadBeginTime = null;
    window.downloadEndTime = null;
    downloadTimer = null;
  }, 10000)
}

function exportChunkToVideo() {
  console.log("exportChunkToVideo", downloadVideoChunks, downloadAudiaoChunks);
  let videoEnc = videoEncode.includes("H264") ? 'h264' : 'h265';
  let audioEnc = audioEncode.includes("G711A") ? 'g711' : 'aac';
  const date = new Date(window.downloadBeginTime + new Date().getTimezoneOffset() * 60 * 1000);
  const year = date.getFullYear();
  const format = (num) => num < 10 ? `0${num}` : num.toString();
  const month = format(date.getMonth() + 1);
  const day = format(date.getDate());
  const hours = format(date.getHours());
  const minutes = format(date.getMinutes());
  const seconds = format(date.getSeconds());
  const fileName = `${year}${month}${day}${hours}${minutes}${seconds}_${(window.downloadEndTime - window.downloadBeginTime) / 1000}`
  p2papi.downloadChunk(downloadVideoChunks, chunkTimeStamps, videoEnc, downloadAudiaoChunks, audioEnc, fileName)
}

let downloadVideoChunks = new Uint8Array();
let downloadAudiaoChunks = new Uint8Array()
let chunkTimeStamps = [];
let videoEncode = '';
let audioEncode = '';
let downloadTimer = null;

function resetDownloadChunk() {
  downloadVideoChunks = new Uint8Array();
  downloadAudiaoChunks = new Uint8Array()
  chunkTimeStamps = [];
  videoEncode = '';
  audioEncode = '';
  downloadTimer = null;
}
/**
 * 
 * @method onrecvrecframe
 * @param {object} api_conn     
 * @param {number} frametype    
 * @param {Buffer} data         
 * @param {number} channel      
 * @param {number} width        
 * @param {number} height 		
 * @param {number} enc 			
 * @param {number} fps 			
 * @param {number} ts_ms 		
 */
ConnectApi.onrecvrecframe = function (
  api_conn,
  frametype,
  data,
  datalen,
  channel,
  width,
  height,
  enc,
  fps,
  ts_ms,
  tasktype
) {
  if (frametype == 15) {
    return;
  }
  if (api_conn.streamlist[channel].winindex == -1) {
    return;
  }
  if (!api_conn.streamlist[channel].firstFrame) {
    api_conn.streamlist[channel].firstFrame = true;
  }
  if (window.downloadEndTime && data) {
    if (frametype != 0) {
      const tmpChunk = new Uint8Array(downloadVideoChunks.length + data.length);
      tmpChunk.set(downloadVideoChunks, 0);
      tmpChunk.set(data, downloadVideoChunks.length);
      downloadVideoChunks = tmpChunk;
      chunkTimeStamps.push(ts_ms);
      videoEncode = enc;
      if (window.downloadEndTime) {
        // const timestamp = ts_ms - new Date().getTimezoneOffset() * 60 * 1000;
        const timestamp = ts_ms;
        clearTimeout(downloadTimer);
        setDownloadTimer(timestamp, api_conn.deviceid, channel);
        if (timestamp >= window.downloadEndTime) {
          clearTimeout(downloadTimer);
          exportChunkToVideo();
          resetDownloadChunk();
          window.downloadBeginTime = null
          window.downloadEndTime = null
          Player.StopPlayBack(api_conn.deviceid, '', channel);
        }
        // UI
        const processElem = window.downloadSpecifyTime ? document.getElementById("downSpecifyTimeProcess") : document.getElementById("process");
        let percent = (timestamp - window.downloadBeginTime) / (window.downloadEndTime - window.downloadBeginTime) * 100;
        if (percent > 100) {
          percent = 100
        } else if (percent < 0) {
          percent = 0
        }
        processElem.style.width = percent + "%";
        const useTime = (Date.now() - window.useTimeStart) / 1000;
        window.downloadSize += data.length;
        let speed = 0;
        if (useTime > 0) {
          speed = parseInt(window.downloadSize / useTime / 1000);
        }
        processElem.textContent = useTime + "s";
        if (!window.downloadSpecifyTime) {
          document.getElementById("downSpeed").textContent = "Speed: " + speed + " kbps";
        }
      }
    } else {
      console.log("frametype", frametype);
      const tmpChunk = new Uint8Array(downloadAudiaoChunks.length + data.length);
      tmpChunk.set(downloadAudiaoChunks, 0);
      tmpChunk.set(data, downloadAudiaoChunks.length);
      downloadAudiaoChunks = tmpChunk;
      audioEncode = enc
    }
  }
  if (api_conn.isRecord) {
    if (frametype === 1) {
      api_conn.startRecord = true
    }
    if (api_conn.startRecord) {
      if (frametype != 0) {
        api_conn.recordObject.recordVideoChunk = setChunk(api_conn.recordObject.recordVideoChunk, data)
        api_conn.recordObject.recordVideoEnc = enc
        api_conn.recordObject.recordTimeStamp.push(ts_ms)
      } else {
        api_conn.recordObject.recordAudioChunk = setChunk(api_conn.recordObject.recordAudioChunk, data)
        api_conn.recordObject.recordAudioEnc = enc
      }
    }
  }
  if (playerList[api_conn.streamlist[channel].winindex]) {
    if (frametype != 0) {
      data.recvtime = new Date().getTime();
      playerList[api_conn.streamlist[channel].winindex].fillframe_v2(
        data,
        datalen,
        enc,
        ts_ms,
        width,
        height,
        frametype
      );
    } else {
      if (api_conn.streamlist[channel].isSound) {
        JAaudioplay.audioPlay(data, enc, datalen, width);
        // playerList[api_conn.streamlist[channel].winindex].audioPlayer.audioPlay(data, enc, datalen, width);
      }
    }
  }
};
/**
 * 
 * @method onrecplaybacktimestamp
 * @param {int} ts_ms   
 */
ConnectApi.onrecplaybacktimestamp = function (ts_ms) {
  // console.log('onrecplaybacktimestamp',new Date(ts_ms + new Date().getTimezoneOffset()*60*1000));
};
/**
 * 
 * @method onconnect
 * @param {object} api_conn 
 * @param {number} code  0:， ：
 */
ConnectApi.onconnect = function (api_conn, code) {
  if (code == 0) {
    console.log('[logs][p2p]' + (api_conn.deviceid ? api_conn.deviceid : api_conn.ip) + "Connect succeeded");
    ConnectApi.login(api_conn, api_conn.user, api_conn.pwd);
  } else {
    console.log(
      '[logs][p2p]' + (api_conn.deviceid ? api_conn.deviceid : api_conn.ip) + " Connect failed " + "Error code:" + code
    );
  }
};
/**
 * 
 * @method onloginresult
 * @param {object} api_conn 
 * @param {number} result  0:， ：
 */
ConnectApi.onloginresult = function (api_conn, result) {
  if (result == 0) {
    api_conn.logined = true;
    console.log('[logs][p2p]' + (api_conn.deviceid ? api_conn.deviceid : api_conn.ip) + "login succeeded");
    for (let i = 0; i < api_conn.streamlist.length; i++) {
      if (api_conn.streamlist[i].winindex >= 0 && api_conn.connectType == 1) {
        ConnectApi.open_stream(api_conn, i, api_conn.streamlist[i].streamid);
        playerList[api_conn.streamlist[i].winindex].open();
      }
    }
  } else {
    console.log(
      (api_conn.deviceid ? api_conn.deviceid : api_conn.ip) + "Login failed " + "Error code:" + result
    );
  }
};
/**
 * p2p
 * @method onp2perror
 * @param {object} api_conn 
 * @param {number} code 
 */
ConnectApi.onp2perror = function (api_conn, code) {
  console.log(code);
  console.log((api_conn.deviceid ? api_conn.deviceid : api_conn.ip) + "Device p2p error p2p");
};

/**
 * p2p
 * @method ondisconnect
 * @param {object} api_conn 
 * @param {number} code 
 */
ConnectApi.ondisconnect = function (api_conn, code) {
  console.log((api_conn.deviceid ? api_conn.deviceid : api_conn.ip) + "Device disconnect ");
};

/**
 * 
 * @method onopenstream
 * @param {object} api_conn 
 * @param {number} channel 
 * @param {number} streamid  0/ 1/
 * @param {number} result 
 */
ConnectApi.onopenstream = function (api_conn, channel, streamid, result, cam_desc) {
  console.log(
    api_conn.deviceid + "Open stream succeeded at channel ," + channel + "Streamid " + streamid
  );
  if (result != 0) {
  }
};
/**
 * 
 * @method onptzresult
 * @param {object} api_conn 
 * @param {number} result 
 */
ConnectApi.onptzresult = function (api_conn, result) {
  // console.log('');
  // console.log(api_conn);
  // console.log(result);
};

/**
 * 
 * @method onsearchrec
 * @param {object} api_conn 
 * @param {number} channel 
 * @param {string} file_type 
 * @param {string} file_begintime 
 * @param {string} file_endtime 
 * @param {string} file_total 
 */
ConnectApi.onsearchrec = function (api_conn, channel, file_type, file_begintime, file_endtime, file_total) {
  let data = {};
  data.deviceid = api_conn.deviceid;
  data.ip = api_conn.ip;
  data.channel = channel;
  data.file_type = file_type;
  data.file_begintime = file_begintime;
  data.file_endtime = file_endtime;
  data.file_total = file_total;
  SearchRecList.push(data);
};

/**
 * ，
 * @method onsearchrecend
 * @param {object} api_conn 
 */
ConnectApi.onsearchrecend = function (api_conn) {
  function flieSort(list) {
    let file = JSON.parse(JSON.stringify(list));
    //，
    for (let i = 0; i < file.length; i++) {
      for (let j = 0; j < file.length - i - 1; j++) {
        if (file[j].file_begintime < file[j + 1].file_begintime) {
          let t = JSON.parse(JSON.stringify(file[j]));
          file[j] = JSON.parse(JSON.stringify(file[j + 1]));
          file[j + 1] = JSON.parse(JSON.stringify(t));
        }
      }
    }
    for (let i = 0; i < file.length; i++) {
      for (let j = 0; j < file.length - i - 1; j++) {
        if (file[j].file_begintime === file[j + 1].file_begintime) {
          file.splice(j + 1, 1);
          j--;
        }
      }
    }
    return file;
  }
  SearchRecList = flieSort(SearchRecList);
  showRecordList(SearchRecList);
};

/**
 * 
 * @method onclosestream
 * @param {object} api_conn 
 * @param {number} channel 
 * @param {number} streamid  0/ 1/
 * @param {number} result 
 */
ConnectApi.onclosestream = function (api_conn, channel, streamid, result) {

};

//onvop2pcallresult
ConnectApi.onvop2pcallresult = function (api_conn, result) {
  if (result === 0) {
    console.log("/");
  } else {
    console.log("/，：" + result, api_conn);
  }
};
/**
 * 
 * @method init
 * @param {array} playerArr ，canvas，
 */
Player.init = function (playerArr) {
  playerList = [];
  for (let i = 0; i < playerArr.length; i++) {
    let player = new kp2pPlayer(playerArr[i], false, i, true, false);
    playerList.push(player);
  }
};

/**
 * 
 * @method ConnectDevice
 * @param {string} devid ID
 * @param {string} ip ip
 * @param {string} user 
 * @param {string} pwd 
 * @param {number} winindex 
 * @param {number} port ip
 * @param {number} connectType  0： 1：
 * @param {number} channel 
 * @param {number} streamid ，1
 *
 * :IDIP，ID，IPport
 */
Player.ConnectDevice = function (devid, ip, user, pwd, winindex, port, connectType, channel, streamid, wss, cb) {
  //ID
  if (devid) {
    let session = GetSessionById(devid);
    let bConnect = false;
    if (session == null) {
      session = ConnectApi.create(winindex, user, pwd, connectType, channel, streamid);
      sessionList.push(session);
      session.isRecord = false;
      session.startRecord = false;
      session.recordObject = {};
    }
    bConnect = true;
    var ngwPort = 80;
    if (bConnect) {
      if (wss == "wss") {
        useHttps = true;
        ngwPort = 443;
      } else {
        useHttps = false;
      }

      let tmp = devid.split(":");
      if (tmp.length == 3) {
        session.isdmp = true;
        ConnectApi.connectbykey(session, "ngw-api.warner.co.in", ngwPort, tmp[0], tmp[1], tmp[2], useHttps, cb)
      } else {
        ConnectApi.connectbyid(session, devid, useHttps, cb);
      }
    }
  } else {
    // IP
    let session = GetSessionByIp(ip);
    let bConnect = false;
    if (session == null) {
      session = ConnectApi.create(winindex, user, pwd, connectType);
      if (bConnect) {
        var useHttps;
        if (wss == "wss") {
          useHttps = true;
        } else {
          useHttps = false;
        }
        ConnectApi.connectbyip(session, ip, port, useHttps, cb);
      }
    }
  };
}

/**
 * 
 * @method OpenStream
 * @param {number} deviceid id
 * @param {number} ip ip
 * @param {number} channel 
 * @param {number} streamid  0/，1/
 * @param {number} winindex 
 */
Player.OpenStream = function (deviceid, ip, channel, streamid, winindex) {
  let session = null;
  if (deviceid) {
    session = GetSessionById(deviceid);
  } else {
    session = GetSessionByIp(ip);
  }
  if (session != null && session.logined) {
    session.refs++;
    session.streamlist[channel].winindex = winindex;
    session.streamlist[channel].streamid = streamid;
    ConnectApi.open_stream(session, channel, streamid);
    playerList[winindex].open();
  }
};
/**
 * 
 * @method CloseStream
 * @param {number} keyindex 
 */
Player.CloseStream = function (keyindex) {
  let session = GetSessionByWinindex(keyindex);
  if (session != null) {
    let channel = GetChannelByWinindex(keyindex);
    if (channel >= 0) {
      ConnectApi.close_stream(session, channel, session.streamlist[channel].streamid);
      playerList[keyindex].close();
      // player1.close()
      session.refs--;
      session.streamlist[channel] = {
        winindex: -1,
        streamid: -1,
        isSound: false,
        firstFrame: false
      };
    }
  }
};
/**
 * 
 * @method DisConnectDevice
 * @param {string} deviceid ID
 * @param {string} ip IP
 * :IDIP
 */
Player.DisConnectDevice = function (deviceid, ip) {
  if (deviceid) {
    let session = GetSessionById(deviceid);
    if (session) {
      ConnectApi.close_socket(session);
      /* Do not remove from sessionList to prevent memory leaks in the underlying SDK when reconnecting
      for (let i = 0; i < sessionList.length; i++) {
        if (sessionList[i].deviceid === session.deviceid) {
          sessionList.splice(i, 1);
          break;
        }
      }
      */
    }
  } else if (ip) {
    let session = GetSessionByIp(ip);
    if (session) {
      ConnectApi.close_socket(session);
      /* Do not remove from sessionList to prevent memory leaks in the underlying SDK when reconnecting
      for (let i = 0; i < sessionList.length; i++) {
        if (sessionList[i].ip === session.ip) {
          sessionList.splice(i, 1);
          break;
        }
      }
      */
    }
  }
};
/**
 * 
 * @method OpenAudio
 * @param {number} keyindex 
 */
Player.OpenAudio = function (keyindex) {
  let session = GetSessionByWinindex(keyindex);
  if (session != null) {
    let channel = GetChannelByWinindex(keyindex);
    if (channel >= 0) {
      console.log("");
      playerList[keyindex].audioPlayer.openVolume();
      session.streamlist[channel].isSound = true;
    }
  }
};
/**
 * 
 * @method CloseAudio
 * @param {number} keyindex 
 */
Player.CloseAudio = function (keyindex) {
  let session = GetSessionByWinindex(keyindex);
  console.log(session);
  if (session != null) {
    let channel = GetChannelByWinindex(keyindex);
    if (channel >= 0) {
      session.streamlist[channel].isSound = false;
    }
  }
  playerList[keyindex].audioPlayer.audioStop();
};

/**
 * start record
 * @method ctrlRecordOn
 * @param { number }     winindex
 * @param { string }     name File name, formatted, currently supports MP4 and webm
 */

Player.ctrlRecordOn = function (winindex, name, callback) {
  let session = GetSessionByWinindex(winindex);
  console.log("ctrlRecord", session);
  const account = localStorage.getItem("account");
  const userStorageList = localStorage.getItem("userStorageList")
    ? JSON.parse(localStorage.getItem("userStorageList"))
    : {};
  let path = "";
  if (userStorageList[account]?.length > 0) {
    userStorageList[account].forEach(item => {
      if (item.key == "video") {
        path = item.value;
      }
    });
  }
  if (session != null) {
    session.isRecord = true
    session.recordObject = {
      recordVideoChunk: new Uint8Array(),
      recordVideoEnc: "",
      recordAudioChunk: new Uint8Array(),
      recordAudioEnc: "",
      recordTimeStamp: [],
      recordName: name
    }
    playerList[winindex].ctrlRecord(name, path, callback);
  }
};
/**
 * stop record
 * @method ctrlRecordOff
 * @param { number }     winindex
 */
Player.ctrlRecordOff = function (winindex) {
  let session = GetSessionByWinindex(winindex);
  if (session != null) {
    session.isRecord = false
    session.startRecord = false
    let { recordVideoChunk, recordAudioChunk, recordTimeStamp, recordVideoEnc, recordAudioEnc } = session.recordObject
    let videoEnc = recordVideoEnc.includes("H264") ? 'h264' : 'h265';
    let audioEnc = recordAudioEnc.includes("G711A") ? 'g711' : 'aac';
    p2papi.downloadChunk(recordVideoChunk, recordTimeStamp, videoEnc, recordAudioChunk, audioEnc, session.recordObject.recordName);
    // playerList[winindex].ctrlRecordOff();
  }
};

/**
 * 
 * @function SreachRecord
 * ，，
 * @param {string} id id
 * @param {string} ip ip
 * @param {number} channel 
 * @param {number} begintime  
 * @param {number} endtime  
 * @param {number} type ，15
 */

Player.SreachRecord = function (id, ip, channel, begintime, endtime, type) {
  SearchRecList = [];
  let session = null;
  let chnlist = new Array(128);
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }
  for (let i = 0; i < chnlist.length; i++) {
    chnlist[i] = 0;
    if (i == channel) {
      chnlist[i] = 1;
    }
  }
  if (session) {
    ConnectApi.find_file_start_2(session, chnlist, begintime, endtime, type);
  }
};

/**
 * 
 * * @function Stopsearch
 * @param {number} id id
 * @param {number} ip ip
 */
Player.Stopsearch = function (id, ip) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }
  if (session) {
    ConnectApi.find_file_stop_2(session);
  }
};

/**
 * 
 * @function Playbackplay
 * @param {number} id id
 * @param {number} ip ip
 * @param {string} channel 
 * @param {string} begintime  10
 * @param {string} endtime  10
 * @param {string} type ，15
 * @param {string} winindex 
 * @param {string} isSound 
 * @param {int} tasktype 
 */
Player.StartPlayBack = function (id, ip, channel, begintime, endtime, type, winindex, isSound, tasktype) {
  console.log("StartPlayBack", { id, ip, channel, begintime, endtime, type, winindex, isSound, tasktype });
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session != null && session.logined) {
    //
    session.refs++;
    session.streamlist[channel].winindex = winindex;
    session.streamlist[channel].streamid = 0;
    if (isSound) {
      session.streamlist[channel].isSound = true;
    }
    ConnectApi.replay_start(session, channel, begintime, endtime, type, tasktype);
    resetDownloadChunk();
    if (tasktype == 1) return;
    playerList[winindex].playbackPause = false;
    playerList[winindex].open();
  }
};

Player.SetStreamMode = function (id, ip, channel, streaMode) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }
  if (session != null && session.logined) {
    var winIndex = session.streamlist[channel].winindex;
    playerList[winIndex].SetStreamMode(streaMode);
  }
};

/**
 * 
 * @function Playbacksuspended
 * @param {number} id id
 * @param {number} ip ip
 */

Player.PausePlayBack = function (id, ip, windowIndex) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session) {
    playerList[windowIndex].playbackPause = true;
    ConnectApi.replay_pause(session);
  }
};

/**
 * 
 * @function Playbackcontinue
 * @param {number} id id
 * @param {number} ip ip
 */

Player.ContinuePlayBack = function (id, ip, windowIndex) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }
  if (session) {
    playerList[windowIndex].playbackPause = false;
    ConnectApi.replay_continue(session);
  }
};

/**
 * 
 * @function Playbackstop
 * @param {number} id id
 * @param {number} ip ip
 * @param {number} channel 
 */
Player.StopPlayBack = function (id, ip, channel) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session) {
    ConnectApi.replay_stop(session);
    playerList[session.streamlist[channel].winindex].close();
    session.streamlist[channel].firstFrame = false;
    session.streamlist[channel].isSound = false;
    session.streamlist[channel].winindex = -1;
  }
};
/**
 * 
 * @function ChangeStream
 * @param {string} id id
 * @param {string} ip ip
 * @param {number} channel 
 * @param {number} newstreamid  0/ 1/
 */
Player.ChangeStream = function (id, ip, channel, newstreamid) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session) {
    session.streamlist[channel].firstFrame = false;
    ConnectApi.change_stream(session, channel, newstreamid);
  }
};
/**
 * @description: 
 * @param {String} id ID
 * @param {String} ip ID
 * @param {Number} channel 
 * @return {*}
 */
Player.OpenCall = function (id, ip, channel) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session) {
    session.streamlist[channel].calling = true;
    ConnectApi.vop2p_call(session, channel);
  }
};
//
/**
 * @description: 
 * @param {String} id ID
 * @param {String} ip IP
 * @param {Number} channel 
 * @param {Number} time_stamp 
 * @param {String} enc ，G711A
 * @param {Number} sample_rate ，8K
 * @param {Number} sample_width ，16
 * @param {Number} channels ，，1
 * @param {Number} compress_ratio ，1
 * @param {Uint8Array} voice_data 
 * @param {Number} voice_data_size 
 * @return {*}
 */
Player.CallSend = function (
  id,
  ip,
  channel,
  time_stamp,
  enc,
  sample_rate,
  sample_width,
  channels,
  compress_ratio,
  voice_data,
  voice_data_size
) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session) {
    session.streamlist[channel].calling = true;
    ConnectApi.vop2p_send(
      session,
      channel,
      time_stamp,
      enc,
      sample_rate,
      sample_width,
      channels,
      compress_ratio,
      voice_data,
      voice_data_size
    );
  }
};
/**
 * @description: 
 * @param {String} id ID
 * @param {String} ip IP
 * @param {Number} channel 
 * @return {*}
 */
Player.CallHangup = function (id, ip, channel) {
  let session = null;
  if (id) {
    session = GetSessionById(id);
  } else {
    session = GetSessionByIp(ip);
  }

  if (session) {
    session.streamlist[channel].calling = false;
    ConnectApi.vop2p_hangup(session, channel);
  }
};
/**
 * 
 * @method Snapshot
 * @param { number }     winindex ，
 * @param { mode }       mode  0：canvas 1：
 * @param { string }     name ，，pngjpeg，：snapshot.png
 * @param { number }     width  canvas，
 * @param { number }     height  canvas，
 * @param { function }   callback ，，，
 * callback param ，callback
 * @param { string } 	dataURL dataURL，
 */
Player.Snapshot = function (winindex, mode, name, width, height, callback) {
  let session = GetSessionByWinindex(winindex);
  if (session != null) {
    const path = "";
    playerList[winindex].Snapshot(name, width, height, path, callback);
  }
};
/**
 * @method: CleanFrame
 * @description: 
 * @param {number} winindex	
 * @return {*}
 */
Player.CleanFrame = function name(winindex) {
  playerList[winindex].cleanFrame();
};

Player.changeSpeed = function (winindex, speed) {
  let session = GetSessionByWinindex(winindex);
  if (session != null) {
    playerList[winindex].changeSpeed(speed);
  }
};
