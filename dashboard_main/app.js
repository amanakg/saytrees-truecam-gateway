// d:\enarxi\Cam\truecam\dashboard_main\app.js

const debugLogs = [];
function addDebugLog(msg, type = 'info') {
  console.log(`[Dashboard Debug] ${msg}`);
  debugLogs.unshift(`[${new Date().toLocaleTimeString()}] [${type.toUpperCase()}] ${msg}`);
  const logBox = document.getElementById('debugLogBox');
  if (logBox) {
    logBox.innerHTML = debugLogs.slice(0, 10).join('<br>');
  }
}

window.onerror = function (message, source, lineno, colno, error) {
  addDebugLog(`JS Error: ${message} (${lineno}:${colno})`, 'error');
};

let CAMERAS = [];
const playInstances = {};

function updateClock() {
  const now = new Date();
  const s = now.toLocaleTimeString('en-IN', { hour12: false });
  const d = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  document.getElementById('live-clock').textContent = `${d}  ${s}`;
  CAMERAS.forEach(cam => {
    const el = document.getElementById(`clock${cam.id}`);
    if (el) el.textContent = s;
  });
}
setInterval(updateClock, 1000);
updateClock();

function setupPlayer(videoEl, whepUrl, camIdx, onLive, onError, onRenewRequired) {
  addDebugLog(`Connecting WebRTC for Cam ${camIdx}...`);
  return mountCameraPlayer(videoEl, whepUrl, {
    onLive: onLive,
    onError: (err) => {
      addDebugLog(`Cam ${camIdx} WebRTC Error: ${err}`, 'error');
      onError && onError(err);
    },
    onDebug: (msg, type) => {
      addDebugLog(`Cam ${camIdx}: ${msg}`, type);
    },
    onRenewRequired: onRenewRequired
  });
}

function setCamState(idx, state, errorMsg = '') {
  const indicator = document.getElementById(`dot${idx}`);
  const statusOverlay = document.getElementById(`statusOverlay${idx}`);
  const loader = document.getElementById(`loader${idx}`);
  const txt = document.getElementById(`statusText${idx}`);

  if (!indicator || !statusOverlay || !loader || !txt) return;

  indicator.className = 'status-indicator';
  statusOverlay.classList.remove('hidden');
  loader.style.display = 'block';

  if (state === 'live') {
    indicator.classList.add('live');
    statusOverlay.classList.add('hidden');
  } else if (state === 'error') {
    indicator.classList.add('error');
    loader.style.display = 'none';
    txt.textContent = `⚠ ${errorMsg || 'Stream offline — retrying…'}`;
  } else {
    txt.textContent = 'Connecting…';
  }
}

function initCamera(cam) {
  const idx = cam.id;
  setCamState(idx, 'connecting');

  if (playInstances[idx]) {
    try { playInstances[idx].activeReader?.close(); } catch (e) { }
    try { playInstances[idx].standbyReader?.close(); } catch (e) { }
    delete playInstances[idx];
  }

  const state = {
    activeLayer: 'a',
    activeReader: null,
    standbyReader: null,
  };
  playInstances[idx] = state;

  connectLayer(cam, state, 'a');
}

function connectLayer(cam, state, layer) {
  const idx = cam.id;
  const video = document.getElementById(`video${idx}_${layer}`);
  if (!video) return;
  video.srcObject = null;

  let isSwapped = false;

  const reader = setupPlayer(
    video,
    cam.whepUrl,
    idx,
    () => {
      // onLive
      if (state.activeLayer !== layer) {
        // Swap visibility
        const oldLayer = state.activeLayer;
        const newVideo = document.getElementById(`video${idx}_${layer}`);
        const oldVideo = document.getElementById(`video${idx}_${oldLayer}`);
        
        // Wait for actual frames to render before hiding the old video
        let frameCount = 0;
        const onTimeUpdate = () => {
          frameCount++;
          if (frameCount > 2) finishSwap(); // Wait for 2 frames
        };
        
        const finishSwap = () => {
          isSwapped = true;
          newVideo.removeEventListener('timeupdate', onTimeUpdate);
          if (state.activeLayer === layer) return; // Already swapped
          
          newVideo.className = 'cam-video active';
          oldVideo.className = 'cam-video standby';
          oldVideo.srcObject = null;
          
          if (state.activeReader) {
             state.activeReader.close();
          }
          state.activeReader = reader;
          state.standbyReader = null;
          state.activeLayer = layer;
          addDebugLog(`Cam ${idx}: Seamless swap completed`, 'success');
        };

        newVideo.addEventListener('timeupdate', onTimeUpdate);
        
        // Ensure new video is in front but old video is still visible behind it
        newVideo.style.opacity = '1';
        newVideo.style.zIndex = '3';
        
        // Fallback timeout in case timeupdate doesn't fire fast enough
        setTimeout(finishSwap, 4000);
      } else {
         setCamState(idx, 'live');
      }
    },
    (err) => {
      // onError
      if (state.activeLayer !== layer) {
         addDebugLog(`Cam ${idx}: Background swap failed, retrying...`, 'warn');
         state.standbyReader = null;
         setTimeout(() => {
           if (playInstances[idx] === state && state.activeLayer !== layer) {
             connectLayer(cam, state, layer);
           }
         }, 5000);
      } else {
         setCamState(idx, 'error', err);
         setTimeout(() => {
           if (playInstances[idx] === state) {
             initCamera(cam);
           }
         }, 7000);
      }
    },
    () => {
      // onRenewRequired
      if (state.activeLayer === layer) {
        addDebugLog(`Cam ${idx}: Starting background connection for seamless swap...`);
        const nextLayer = layer === 'a' ? 'b' : 'a';
        connectLayer(cam, state, nextLayer);
      }
    }
  );

  if (state.activeLayer === layer) {
     state.activeReader = reader;
  } else {
     state.standbyReader = reader;
     
     // Watchdog: If the background player hangs for 15 seconds without swapping, roll it back
     setTimeout(() => {
       if (!isSwapped && playInstances[idx] === state && state.activeLayer !== layer) {
         addDebugLog(`Cam ${idx}: Background connection timed out. Rolling back...`, 'warn');
         if (state.standbyReader) {
           try { state.standbyReader.close(); } catch(e){}
           state.standbyReader = null;
         }
         // Retry the background connection in 30 seconds
         setTimeout(() => {
           if (playInstances[idx] === state && state.activeLayer !== layer) {
             connectLayer(cam, state, layer);
           }
         }, 30000);
       }
     }, 15000);
  }
}

let expandedCam = null;
function toggleExpand(idx) {
  const card = document.getElementById(`card${idx}`);
  const btn = document.getElementById(`expandBtn${idx}`);

  if (expandedCam === idx) {
    card.classList.remove('focused');
    CAMERAS.forEach(cam => {
      if (cam.id !== idx) {
        const other = document.getElementById(`card${cam.id}`);
        if (other) other.style.display = '';
      }
    });
    expandedCam = null;
    btn.classList.remove('active');
  } else {
    if (expandedCam !== null) {
      document.getElementById(`card${expandedCam}`).classList.remove('focused');
      document.getElementById(`expandBtn${expandedCam}`).classList.remove('active');
    }
    card.classList.add('focused');
    CAMERAS.forEach(cam => {
      if (cam.id !== idx) {
        const other = document.getElementById(`card${cam.id}`);
        if (other) other.style.display = 'none';
      }
    });
    expandedCam = idx;
    btn.classList.add('active');
  }
}

function goFullscreen(videoId) {
  const el = document.getElementById(videoId);
  if (!el) return;
  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
}

function reloadCamera(idx) {
  const cam = CAMERAS.find(c => c.id === idx);
  if (!cam) return;
  initCamera(cam);
}

function refreshAll() {
  CAMERAS.forEach(cam => reloadCamera(cam.id));
}

function renderCameraDOM() {
  const grid = document.getElementById('camGrid');
  grid.innerHTML = '';

  const displayCams = CAMERAS.slice(0, 8);

  for (let i = 0; i < 8; i++) {
    if (i < displayCams.length) {
      const cam = displayCams[i];
      const idx = cam.id;

      const card = document.createElement('div');
      card.className = 'cam-card';
      card.id = `card${idx}`;
      card.ondblclick = () => goFullscreen(`container${idx}`);

      card.innerHTML = `
        <div class="video-container" id="container${idx}">
          <video id="video${idx}_a" class="cam-video active" autoplay muted playsinline></video>
          <video id="video${idx}_b" class="cam-video standby" autoplay muted playsinline></video>
          
          <div class="overlay-tl">
            <div class="status-indicator" id="dot${idx}"></div>
            <div class="cam-badge">CAM ${idx}</div>
          </div>
          
          <div class="overlay-tr" id="clock${idx}"></div>
          
          <div class="overlay-bl">
            <div class="stream-meta" id="meta${idx}"></div>
          </div>
          
          <div class="cam-state-overlay" id="statusOverlay${idx}">
            <div class="loader" id="loader${idx}"></div>
            <div class="state-msg" id="statusText${idx}">Connecting…</div>
          </div>
        </div>
        
        <div class="cam-footer">
          <div class="cam-info">
            <div class="cam-name">${cam.name}</div>
            <div class="cam-id">${cam.deviceId}</div>
          </div>
          <div class="cam-controls">
            <button class="btn-icon" title="Refresh" onclick="reloadCamera(${idx})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.32"/></svg>
            </button>
            <button class="btn-icon" title="Expand" id="expandBtn${idx}" onclick="toggleExpand(${idx})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button class="btn-icon" title="Fullscreen" onclick="goFullscreen('container${idx}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="8 3 3 3 3 8"/><polyline points="21 8 21 3 16 3"/><polyline points="3 16 3 21 8 21"/><polyline points="16 21 21 21 21 16"/></svg>
            </button>
          </div>
        </div>
      `;
      grid.appendChild(card);

    } else {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'cam-card empty';
      emptyCard.innerHTML = `
        <svg width="32" height="32" opacity="0.3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:12px;">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
          <line x1="7" y1="2" x2="7" y2="22"></line>
          <line x1="17" y1="2" x2="17" y2="22"></line>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <line x1="2" y1="7" x2="7" y2="7"></line>
          <line x1="2" y1="17" x2="7" y2="17"></line>
          <line x1="17" y1="17" x2="22" y2="17"></line>
          <line x1="17" y1="7" x2="22" y2="7"></line>
        </svg>
        <div>Slot ${i + 1}</div>
      `;
      grid.appendChild(emptyCard);
    }
  }
}

let isInitialized = false;

async function fetchMetadata() {
  try {
    const response = await fetch('/api/clients/enarxi/cameras', {
      headers: {
        'x-api-key': 'dummy_hash_for_testing'
      }
    });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    
    const realCameras = data.filter(c => !c.streamName.startsWith('mock_cam_'));

    if (realCameras.length !== CAMERAS.length || !isInitialized) {
      CAMERAS = realCameras.map((c, i) => ({
        id: i + 1,
        name: c.name,
        deviceId: c.id,
        whepUrl: c.whepUrl
      }));
      
      renderCameraDOM();
      
      Object.keys(playInstances).forEach(k => { 
        try{ playInstances[k].activeReader?.close(); } catch(e){} 
        try{ playInstances[k].standbyReader?.close(); } catch(e){} 
        delete playInstances[k]; 
      });
      
      CAMERAS.forEach(cam => initCamera(cam));
      isInitialized = true;
    }

    let activeCount = 0;

    data.forEach(cam => {
      const matched = CAMERAS.find(c => c.deviceId === cam.id);
      if (matched) {
        // Only count truly streaming cameras (connected + has valid resolution from FFmpeg)
        const isStreaming = cam.status === 'connected' && cam.metadata && cam.metadata.resolution && cam.metadata.resolution !== 'unknown';
        if (isStreaming) activeCount++;
        
        const idx = matched.id;
        const metaDiv = document.getElementById(`meta${idx}`);
        if (isStreaming) {
          const metaStr = `${cam.metadata.resolution} · ${cam.metadata.fps} fps · ${cam.metadata.codec.toUpperCase()}`;
          
          if (metaDiv) {
            metaDiv.textContent = metaStr;
            metaDiv.style.display = 'block';
          }
        } else {
          if (metaDiv) metaDiv.style.display = 'none';
        }
      }
    });
    
    const countEl = document.getElementById('activeCamCount');
    if (countEl) countEl.textContent = `${activeCount} Active`;
  } catch (e) {
    console.warn('Failed to fetch camera metadata:', e.message);
  }
}

setInterval(fetchMetadata, 5000);
fetchMetadata();

// Expose to window for inline onclicks
window.reloadCamera = reloadCamera;
window.toggleExpand = toggleExpand;
window.goFullscreen = goFullscreen;
