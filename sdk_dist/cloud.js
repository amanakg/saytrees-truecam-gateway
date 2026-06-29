document.getElementById('searchCloudDate').value = new Date().toLocaleDateString()
let jessibucaPlayer = null
let m3u8TsList = []
function initJessibucaPlayer() {
  jessibucaPlayer = new JessibucaPro({
    "container": document.getElementById('container'),
    videoBuffer: 9999999,
    videoBufferDelay: 1, // 1000s
    isResize: false,
    text: "",
    loadingText: "loading",
    debug: false,
    debugLevel: "debug",
    useMSE: false,
    useSIMD: true,
    useWCS: false,
    showBandwidth: false,
    showPerformance: false,
    timeout: 1000,
    heartTimeoutReplayUseLastFrameShow: true,
    audioEngine: "worklet",
    forceNoOffscreen: true,
    heartTimeout: 10000000,
    ptzZoomShow: true,
    useCanvasRender: false,
    useWebGPU: true,
    supportHls265: true,
    operateBtns: {
      "audio": true,
    },
  });
  jessibucaPlayer.on('loadM3U8End', (playlist) => {
    m3u8TsList.map((item, index) => {
      playlist.segments[index].url = item
    })
  })
}
initJessibucaPlayer()
async function searchCloudFile() {
  var device = document.getElementById("dev_id").value;
  var deviceId = device.split(":")[1];
  let channel = document.getElementById('channel').value
  let cloudPlaybackDate = getCloudPlaybackDate()
  let playbackDate = `${cloudPlaybackDate.year}/${cloudPlaybackDate.month}/${cloudPlaybackDate.day}`
  p2papi.getCloudFileList({ deviceId, playbackDate, channel: Number(channel) }, (res) => {
    console.log("getCloudFileList", res);
    if (res.code === "200") {
      createCloudFileTable(res.cloudFileList)
    }
  })
}
function createCloudFileTable(m3u8List) {
  var recListTable = document.getElementById("cloud_recListTable");
  for (var i = recListTable.rows.length - 1; i >= 1; i--) {
    recListTable.deleteRow(i);
  }
  console.log("searchCloudFile", m3u8List);
  m3u8List.map((item) => {
    const newRow = recListTable.insertRow(1);
    const td_begin = newRow.insertCell(0);
    const td_times = newRow.insertCell(1);
    const td_type = newRow.insertCell(2);
    const td_download = newRow.insertCell(3);
    const td_play = newRow.insertCell(4);
    td_download.innerHTML = `<button onclick="downloadm3u8Video('${item.cloudKey}')">download</button>`
    td_play.innerHTML = `<button onclick="playCloudVideo('${item.cloudKey}')">play</button>`

    td_begin.innerText = new Date(item.file_begintime * 1000).toLocaleString()
    td_times.innerText = item.duration
    if (item.file_type == "1") {
      td_type.innerText = "Schedule recording"
    }
    else {
      td_type.innerText = "Alarm recording"
    }
    // td_type.innerText = td_type.innerText + '-' + file_type
  })
}
async function playCloudVideo(m3u8Key) {
  p2papi.getM3u8Url(m3u8Key, (res) => {
    m3u8TsList = res.tsUrl
    startPlayCloudVideo(res)
  })
}
async function startPlayCloudVideo(res) {
  await jessibucaPlayer.destroy()
  initJessibucaPlayer()
  jessibucaPlayer.play(res.m3u8Url)
}
function getCloudPlaybackDate() {
  let cloudPlaybackDate = new Date(document.getElementById('searchCloudDate').value)
  let year = cloudPlaybackDate.getFullYear()
  let month = cloudPlaybackDate.getMonth() + 1 + ''
  let day = '' + cloudPlaybackDate.getDate() + ''
  if (month.length < 2) {
    month = '0' + month
  }
  if (day.length < 2) {
    day = '0' + day
  }
  return {
    year,
    month,
    day
  }
}
async function stopPlayCloudVideo() {
  await jessibucaPlayer.destroy()
  initJessibucaPlayer()
}
function cloudSnapshot() {
  jessibucaPlayer.screenshot('test')
}
async function downloadm3u8Video(cloudKey) {
  p2papi.getM3u8Url(cloudKey, (res) => {
    downloadTSFiles(res.tsUrl)
  })
}
async function downloadTSFiles(tsUrls) {
  try {
    const responses = await Promise.all(tsUrls.map(async url => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      return response.arrayBuffer();
    }));
    blob = new Blob(
      responses,
      { type: 'video/MP2T' }
    )
    const downloadUrl = URL.createObjectURL(blob);
    console.log('downloadblob', blob);
    const a = document.createElement('a')
    a.href = downloadUrl
    a.target = '_blank'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.download = 'test.ts'
    a.click()
    window.URL.revokeObjectURL(downloadUrl)
    document.body.removeChild(a)
    document.getElementById('cloudVideoDownloadTip').innerText = 'download success'
  } catch (error) {
    console.error('Error downloading files:', error);
  }
}
function formatStartTime(timestamp) {
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(8, 10);
  const minute = timestamp.slice(10, 12);
  const second = timestamp.slice(12, 14);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}