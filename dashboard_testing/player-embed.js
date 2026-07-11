/**
 * player-embed.js
 * Extracted, reusable library to embed MediaMTX WebRTC WHEP camera streams.
 */

/**
 * Mounts a camera player to a video element and connects to the MediaMTX WHEP endpoint.
 * 
 * @param {HTMLVideoElement} videoEl The HTML5 `<video>` element to attach the stream to.
 * @param {string} whepUrl The WHEP endpoint URL of the stream (e.g., http://168.144.84.199:8889/live/mycamera_hd/whep).
 * @param {object} options Callback hooks:
 *                         - `onLive`: Called when the video track is successfully connected and playing.
 *                         - `onError`: Called when a connection or playback error occurs.
 *                         - `onDebug`: Called with diagnostic debug log messages.
 * @returns {MediaMTXWebRTCReader|null} The WebRTC WHEP reader instance, or null if initialization fails.
 */
function mountCameraPlayer(videoEl, whepUrl, options = {}) {
  const { onLive, onError, onDebug } = options;
  
  const logDebug = (msg, type = 'info') => {
    if (onDebug) {
      onDebug(msg, type);
    } else {
      console.log(`[PlayerEmbed] [${type.toUpperCase()}] ${msg}`);
    }
  };

  logDebug(`Initializing WHEP connection for player...`);

  try {
    // Verify that the core reader.js class is loaded
    if (typeof MediaMTXWebRTCReader === 'undefined') {
      throw new Error("MediaMTXWebRTCReader class is missing. Make sure dashboard/reader.js is imported before player-embed.js.");
    }

    const reader = new MediaMTXWebRTCReader({
      url: whepUrl,
      onError: (err) => {
        logDebug(`WebRTC stream error: ${err}`, 'error');
        if (onError) onError(err);
      },
      onTrack: (evt) => {
        logDebug(`WebRTC track received. Binding stream to video element...`);
        videoEl.srcObject = evt.streams[0];
        
        videoEl.play()
          .then(() => {
            logDebug(`Playback started successfully. Stream is live.`, 'success');
            if (onLive) onLive();
          })
          .catch((e) => {
            logDebug(`Autoplay blocked or interrupted: ${e.message}`, 'warn');
          });
      }
    });

    return reader;
  } catch (e) {
    logDebug(`Failed to initialize WebRTC reader: ${e.message}`, 'error');
    if (onError) onError(e.message);
    return null;
  }
}
