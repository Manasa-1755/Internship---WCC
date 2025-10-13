//WORKING CODE

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let originalAudioContext = null;
let muteCheckInterval = null;
let autoRecordEnabled = false;
let shouldDownloadOnClose = false;


console.log("🎬 GMeet Recorder tab loaded");

// Function to sync toggle state
async function syncToggleState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔄 Recorder: Auto record permission:", autoRecordEnabled);
      // Update UI in real time
      updateToggleDisplay();
      resolve(autoRecordEnabled);
    });
  });
}

// Function to update the toggle
function updateToggleDisplay() {
  const statusElement = document.getElementById("status");
  const indicatorElement = document.getElementById("autoRecordIndicator");
  
  if (indicatorElement) {
    indicatorElement.textContent = `Auto Record: ${autoRecordEnabled ? 'ON' : 'OFF'}`;
    indicatorElement.className = `auto-record-indicator ${autoRecordEnabled ? 'auto-on' : 'auto-off'}`;
  }
  
  if (statusElement) {
    if (isRecording) {
      statusElement.textContent = autoRecordEnabled ? "🟢 Auto Recording..." : "🟢 Recording...";
    } else {
      statusElement.textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record...";
    }
  }
}

// Add tab closure detection
function setupTabClosureDetection(tabId) {
  // Check if source tab still exists periodically
  const tabCheckInterval = setInterval(async () => {
    if (!isRecording) {
      clearInterval(tabCheckInterval);
      return;
    }
    
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        console.log("❌ Source tab closed - stopping recording");
        stopRecording();
        clearInterval(tabCheckInterval);
      }
    } catch (error) {
      console.log("❌ Source tab closed or inaccessible - stopping recording");
      stopRecording();
      clearInterval(tabCheckInterval);
    }
  }, 2000); // Check every 2 seconds
}

// To listen for toggle state changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoRecordPermission) {
    autoRecordEnabled = changes.autoRecordPermission.newValue;
    console.log("🔄 Recorder: Toggle state updated to:", autoRecordEnabled);
    
    updateToggleDisplay();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Recorder received:", message.action);

  if (message.action === "startRecording") {
    isAutoRecord = message.autoRecord || false;
    startRecording(message.tabId);
    sendResponse({ success: true });
  }

  if (message.action === "stopRecording") {
     // 🆕 Force auto-download if specified
  if (message.forceAutoDownload) {
    isAutoRecord = true;
  }
    stopRecording();
    sendResponse({ success: true });
  }

  return true;
});

async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);

  // Sync toggle state at start
  await syncToggleState();

  if (isRecording) {
    console.log("⚠️ Already recording");
    return;
  }

  try {
    document.getElementById("status").textContent = "🟡 Starting recording...";

    // Capture the tab stream (video + Meet audio)
    const tabStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: true,
        audioConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
          }
        },
        videoConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      }, (stream) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!stream) reject(new Error("No tab stream returned"));
        else resolve(stream);
      });
    });

    console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                "Video tracks:", tabStream.getVideoTracks().length);

    // Create audio context for mixing and playback
    const audioContext = new AudioContext();
    const recordingDestination = audioContext.createMediaStreamDestination();
    const playbackDestination = audioContext.createMediaStreamDestination();
    
    // Get Meet audio from tab stream
    const meetAudioSource = audioContext.createMediaStreamSource(
      new MediaStream(tabStream.getAudioTracks())
    );
    
    // 🆕 CRITICAL FIX: Split audio for recording AND playback
    // Create a splitter to duplicate the audio
    const splitter = audioContext.createChannelSplitter(2);
    const recordingMerger = audioContext.createChannelMerger(2);
    const playbackMerger = audioContext.createChannelMerger(2);
    
    meetAudioSource.connect(splitter);
    
    // 🎧 Branch 1: Send audio to playback (so you can hear participants)
    splitter.connect(playbackMerger, 0, 0);
    splitter.connect(playbackMerger, 1, 1);
    playbackMerger.connect(audioContext.destination);
    
    // 🎤 Branch 2: Send audio to recording (mixed with microphone)
    splitter.connect(recordingMerger, 0, 0);
    splitter.connect(recordingMerger, 1, 1);
    
    // Get microphone audio for recording
    let micStream = null;
    let micSource = null;
    let micGainNode = null;
    
    try {
      console.log("🎤 Requesting microphone access...");
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });

      console.log("✅ Microphone access granted");
      micSource = audioContext.createMediaStreamSource(micStream);
      micGainNode = audioContext.createGain();
      micSource.connect(micGainNode);
      
      // Start with microphone muted (gain = 0)
      micGainNode.gain.value = 0;
      
      // Connect microphone to recording (not to playback)
      micGainNode.connect(recordingMerger, 0, 0); // Mono mic to left channel
      micGainNode.connect(recordingMerger, 0, 1); // Mono mic to right channel
      
      console.log("✅ Microphone connected to recording (initially muted)");
      
    } catch (micError) {
      console.error("❌ Microphone access denied:", micError);
    }

    // Connect recording merger to recording destination
    recordingMerger.connect(recordingDestination);
    
    console.log("✅ Audio setup: Meet audio → Recording + Playback, Microphone → Recording only");

    // Function to check mute status and update microphone gain
    const updateMicrophoneMute = async () => {
      try {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getMuteStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ isMuted: true });
            } else {
              resolve(response || { isMuted: true });
            }
          });
        });

        if (micGainNode) {
          if (response.isMuted) {
            micGainNode.gain.value = 0;
            console.log("🔇 Microphone muted in recording (Meet is muted)");
          } else {
            micGainNode.gain.value = 1.0;
            console.log("🎤 Microphone UNMUTED in recording (Meet is unmuted)");
          }
        }
      } catch (error) {
        console.log("⚠️ Could not check mute status, keeping microphone muted");
        if (micGainNode) micGainNode.gain.value = 0;
      }
    };

    // Check mute status every 2 seconds
    muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
    updateMicrophoneMute();

    // Create final recording stream: video + mixed audio
    const videoTrack = tabStream.getVideoTracks()[0];
    const mixedAudioTrack = recordingDestination.stream.getAudioTracks()[0];

    // Track closure detection
    const sourceVideoTrack = tabStream.getVideoTracks()[0];
    const sourceAudioTrack = tabStream.getAudioTracks()[0];

    if (sourceVideoTrack) {
      sourceVideoTrack.onended = () => {
        console.log("❌ Source video track ended - Meet tab closed");
        stopRecording();
      };
    }

    if (sourceAudioTrack) {
      sourceAudioTrack.onended = () => {
        console.log("❌ Source audio track ended - Meet tab closed");
        stopRecording();
      };
    }

    if (!videoTrack) {
      throw new Error("No video track available from tab capture");
    }

    if (!mixedAudioTrack) {
      throw new Error("No audio track available after mixing");
    }

    const finalStream = new MediaStream([videoTrack, mixedAudioTrack]);
    console.log("✅ Final recording stream created with dual audio paths");

    // Choose MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    console.log("🎥 Using MIME type:", supportedType);

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: supportedType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    originalAudioContext = audioContext;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        console.log("📦 Data chunk:", e.data.size, "bytes");
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();
      downloadRecording();
      cleanup();
    };

    mediaRecorder.onerror = e => {
      console.error("❌ MediaRecorder error:", e);
      document.getElementById("status").textContent = "❌ Recording error";
      cleanup();
    };

    mediaRecorder.start(1000);
    updateToggleDisplay();
    startTimer();

    setupTabClosureDetection(tabId);

    await chrome.storage.local.set({ isRecording: true, recordingStartTime });
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    
    console.log("✅ Recording started successfully!");
    console.log("🎧 Meet audio is now audible in the tab while recording");
    console.log("🎤 Recording follows Google Meet mute/unmute status");

  } catch (err) {
    console.error("❌ Recording start failed:", err);
    document.getElementById("status").textContent = "❌ Recording failed: " + err.message;
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    console.log("🛑 Stopping recording...");
    mediaRecorder.stop();
  } else {
    console.log("⚠️ No active recording to stop");
  }
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeStr = `${mins}:${secs}`;
    timerEl.textContent = timeStr;
    chrome.storage.local.set({ recordingTime: timeStr });
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function downloadRecording() {
  if (!recordedChunks.length) {
    console.error("❌ No recording data available");
    document.getElementById("status").textContent = "❌ No recording data";
    return;
  }

  console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
  const filename = `gmeet-recording-${timestamp}.webm`;

  // 🆕 AUTO DOWNLOAD FOR BOTH MODES
  chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
      // Fallback direct download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } else {
      console.log("✅ AUTO-DOWNLOAD started with ID:", downloadId);
    }
    document.getElementById("status").textContent = "✅ Recording Auto-Downloaded!";
  });
}

function fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  // 🆕 ALWAYS DIRECT DOWNLOAD - NO SAVE AS DIALOG
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  document.getElementById("status").textContent = "✅ Recording Auto-Downloaded!";
}

function cleanup() {
  console.log("🧹 Cleaning up recording resources");
  isRecording = false;
  stopTimer();

  // Clear mute check interval
  if (muteCheckInterval) {
    clearInterval(muteCheckInterval);
    muteCheckInterval = null;
  }

  // Close audio context
  if (originalAudioContext) {
    originalAudioContext.close();
    originalAudioContext = null;
  }

  if (mediaRecorder?.stream) {
    mediaRecorder.stream.getTracks().forEach(track => {
      track.stop();
      console.log("🔴 Stopped track:", track.kind);
    });
  }
  
  recordedChunks = [];
  chrome.storage.local.remove(['isRecording','recordingTime','recordingStartTime','recordingStoppedByTabClose']);
  chrome.runtime.sendMessage({ action: "recordingStopped" });
  document.getElementById("status").textContent = "✅ Recording completed";

  // 🆕 CLOSE TAB FOR BOTH MODES AFTER DOWNLOAD COMPLETES
  console.log("🤖 Closing recorder tab in 3 seconds");
  setTimeout(() => {
    window.close();
  }, 3000);

  // Close tab for ALL recording types (manual + auto)
  //setTimeout(() => window.close(), 2000);
}

// Keep tab alive for auto-recording
setInterval(() => { 
  if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer").textContent); 
}, 30000);

//--------------------Handle tab closure during recording

// FIXED VERSION - Replace with this:
window.addEventListener('beforeunload', (event) => {
  if (isRecording && recordedChunks.length > 0) {
    console.log("🚨 Recorder tab closing during recording");
    
    // Store recording data for potential download
    const recordingData = {
      timestamp: Date.now(),
      chunkCount: recordedChunks.length
    };
    sessionStorage.setItem('pendingRecording', JSON.stringify(recordingData));
    
    // Show the Leave/Cancel dialog
    event.preventDefault();
    event.returnValue = '';
    return '';
  }
});

// This only fires when they actually LEAVE the page
window.addEventListener('unload', () => {
  const pendingRecording = sessionStorage.getItem('pendingRecording');
  
  if (pendingRecording && recordedChunks.length > 0) {
    console.log("✅ User confirmed Leave - AUTO-DOWNLOADING recording");

    // Reset UI state
    chrome.storage.local.set({ 
      recordingStoppedByTabClose: true,
      isRecording: false 
    });

    chrome.runtime.sendMessage({ action: "recordingStopped" });
    
    // 🆕 AUTO-DOWNLOAD WITHOUT DIALOG
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
    const filename = `gmeet-recording-${timestamp}.webm`;
    
    chrome.downloads.download({ 
      url: url, 
      filename: filename, 
      saveAs: false // 🆕 NO DIALOG
    });
    
    sessionStorage.removeItem('pendingRecording');
  }
});

/*
/// recorder.js – runs in a dedicated tab for recording
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let originalAudioContext = null;

console.log("🎬 GMeet Recorder tab loaded");

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Recorder received:", message.action);

  if (message.action === "startRecording") {
    isAutoRecord = message.autoRecord || false;
    startRecording(message.tabId);
    sendResponse({ success: true });
  }

  if (message.action === "stopRecording") {
    stopRecording();
    sendResponse({ success: true });
  }

  return true;
});

async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);

  if (isRecording) {
    console.log("⚠️ Already recording");
    return;
  }

  try {
    document.getElementById("status").textContent = "🟡 Starting recording...";

    // First, ensure the Meet tab continues to play audio normally
    // We'll capture the tab but create a duplicate audio stream
    
    // Capture the tab stream (video + Meet audio)
    const tabStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: true,
        audioConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
            // Don't suppress audio processing - let Meet handle it
            googEchoCancellation: true,
            googAutoGainControl: true,
            googNoiseSuppression: true,
            googHighpassFilter: true
          }
        },
        videoConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      }, (stream) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!stream) reject(new Error("No tab stream returned"));
        else resolve(stream);
      });
    });

    console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                "Video tracks:", tabStream.getVideoTracks().length);

    // Create duplicate audio streams - one for recording, one for playback
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    
    // Source from the captured tab audio
    const audioSource = audioContext.createMediaStreamSource(
      new MediaStream(tabStream.getAudioTracks())
    );
    
    // Split the audio: one branch goes to recording, one goes to speakers
    const splitter = audioContext.createChannelSplitter(2);
    const merger = audioContext.createChannelMerger(2);
    
    audioSource.connect(splitter);
    
    // Branch 1: Send to speakers (so you can hear Meet audio)
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // Full volume for playback
    splitter.connect(gainNode, 0);
    gainNode.connect(audioContext.destination);
    
    // Branch 2: Send to recording (mixed with microphone)
    splitter.connect(merger, 1, 0);
    
    let finalAudioStream = destination.stream;
    
    // Try to add microphone audio to the recording
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      console.log("✅ Microphone stream captured");

      if (micStream.getAudioTracks().length > 0) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        // Mix microphone with the Meet audio for recording
        micSource.connect(merger, 0, 1);
        console.log("✅ Microphone audio mixed with Meet audio for recording");
      }
      
    } catch (micError) {
      console.warn("⚠️ Microphone unavailable, recording Meet audio only:", micError);
    }
    
    // Connect the merged audio to destination for recording
    merger.connect(destination);
    
    // Create final stream for recording: video + mixed audio
    const videoTrack = tabStream.getVideoTracks()[0];
    const audioTrack = destination.stream.getAudioTracks()[0];
    
    let finalStream;
    if (videoTrack && audioTrack) {
      finalStream = new MediaStream([videoTrack, audioTrack]);
      console.log("✅ Final recording stream created with video + mixed audio");
    } else {
      console.warn("⚠️ Using original tab stream as fallback");
      finalStream = tabStream;
    }

    // Choose MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    console.log("🎥 Using MIME type:", supportedType);

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: supportedType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    originalAudioContext = audioContext;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        console.log("📦 Data chunk:", e.data.size, "bytes");
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();
      downloadRecording();
      cleanup();
    };

    mediaRecorder.onerror = e => {
      console.error("❌ MediaRecorder error:", e);
      document.getElementById("status").textContent = "❌ Recording error";
      cleanup();
    };

    mediaRecorder.start(1000);
    document.getElementById("status").textContent = isAutoRecord ? "🟢 Auto Recording..." : "🟢 Recording...";
    startTimer();

    await chrome.storage.local.set({ isRecording: true, recordingStartTime });
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    console.log("✅ Recording started! Meet audio should still be audible in the original tab");

  } catch (err) {
    console.error("❌ Recording start failed:", err);
    document.getElementById("status").textContent = "❌ Recording failed: " + err.message;
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    console.log("🛑 Stopping recording...");
    mediaRecorder.stop();
  } else {
    console.log("⚠️ No active recording to stop");
  }
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeStr = `${mins}:${secs}`;
    timerEl.textContent = timeStr;
    chrome.storage.local.set({ recordingTime: timeStr });
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function downloadRecording() {
  if (!recordedChunks.length) {
    console.error("❌ No recording data available");
    document.getElementById("status").textContent = "❌ No recording data";
    return;
  }

  console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
  const filename = `gmeet-recording-${timestamp}.webm`;

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
      fallbackDownload(blob, filename);
    } else {
      console.log("✅ Download started with ID:", downloadId);
      document.getElementById("status").textContent = "✅ Recording saved!";
    }
  });
}

function fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  document.getElementById("status").textContent = "✅ Recording saved!";
}

function cleanup() {
  console.log("🧹 Cleaning up recording resources");
  isRecording = false;
  stopTimer();

  // Close audio context to stop audio playback
  if (originalAudioContext) {
    originalAudioContext.close();
    originalAudioContext = null;
  }

  if (mediaRecorder?.stream) {
    mediaRecorder.stream.getTracks().forEach(track => {
      track.stop();
      console.log("🔴 Stopped track:", track.kind);
    });
  }
  
  recordedChunks = [];
  chrome.storage.local.remove(['isRecording','recordingTime','recordingStartTime']);
  chrome.runtime.sendMessage({ action: "recordingStopped" });
  document.getElementById("status").textContent = "✅ Recording completed";

  if (isAutoRecord) {
    console.log("🤖 Auto-record mode - closing tab in 3 seconds");
    setTimeout(() => window.close(), 3000);
  }
}

// Keep tab alive for auto-recording
setInterval(() => { 
  if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer").textContent); 
}, 30000);
*/


/*
//FINAL PART
/// recorder.js – runs in a dedicated tab for recording
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let originalAudioContext = null;
let muteCheckInterval = null;

console.log("🎬 GMeet Recorder tab loaded");

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Recorder received:", message.action);

  if (message.action === "startRecording") {
    isAutoRecord = message.autoRecord || false;
    startRecording(message.tabId);
    sendResponse({ success: true });
  }

  if (message.action === "stopRecording") {
    stopRecording();
    sendResponse({ success: true });
  }

  return true;
});

async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);

  if (isRecording) {
    console.log("⚠️ Already recording");
    return;
  }

  try {
    document.getElementById("status").textContent = "🟡 Starting recording...";

    // Capture the tab stream (video + Meet audio)
    const tabStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: true,
        audioConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
          }
        },
        videoConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      }, (stream) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!stream) reject(new Error("No tab stream returned"));
        else resolve(stream);
      });
    });

    console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                "Video tracks:", tabStream.getVideoTracks().length);

    // Create audio context for mixing
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    
    // Get Meet audio from tab stream (other participants)
    const meetAudioSource = audioContext.createMediaStreamSource(
      new MediaStream(tabStream.getAudioTracks())
    );
    
    // Get microphone audio (your voice) but don't connect it yet
    let micStream = null;
    let micSource = null;
    let micGainNode = null;
    
    try {
      console.log("🎤 Requesting microphone access...");
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });

      console.log("✅ Microphone access granted");
      micSource = audioContext.createMediaStreamSource(micStream);
      micGainNode = audioContext.createGain();
      micSource.connect(micGainNode);
      
      // Start with microphone muted (gain = 0)
      micGainNode.gain.value = 0;
      micGainNode.connect(destination);
      console.log("✅ Microphone connected but MUTED (gain = 0)");
      
    } catch (micError) {
      console.error("❌ Microphone access denied:", micError);
    }

    // Connect Meet audio to destination (always on)
    meetAudioSource.connect(destination);
    console.log("✅ Meet audio connected to recording");

    // Function to check mute status and update microphone gain
    const updateMicrophoneMute = async () => {
      try {
        // Ask the content script in the Meet tab about mute status
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getMuteStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ isMuted: true }); // Default to muted if error
            } else {
              resolve(response || { isMuted: true });
            }
          });
        });

        if (micGainNode) {
          if (response.isMuted) {
            micGainNode.gain.value = 0;
            console.log("🔇 Microphone muted in recording (Meet is muted)");
          } else {
            micGainNode.gain.value = 1.0;
            console.log("🎤 Microphone UNMUTED in recording (Meet is unmuted)");
          }
        }
      } catch (error) {
        console.log("⚠️ Could not check mute status, keeping microphone muted");
        if (micGainNode) micGainNode.gain.value = 0;
      }
    };

    // Check mute status every 2 seconds
    muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
    
    // Initial mute check
    updateMicrophoneMute();

    // Create final stream: video + mixed audio
    const videoTrack = tabStream.getVideoTracks()[0];
    const mixedAudioTrack = destination.stream.getAudioTracks()[0];
    
    if (!videoTrack) {
      throw new Error("No video track available from tab capture");
    }
    
    if (!mixedAudioTrack) {
      throw new Error("No audio track available after mixing");
    }

    const finalStream = new MediaStream([videoTrack, mixedAudioTrack]);
    console.log("✅ Final recording stream created");

    // Choose MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    console.log("🎥 Using MIME type:", supportedType);

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: supportedType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    originalAudioContext = audioContext;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        console.log("📦 Data chunk:", e.data.size, "bytes");
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();
      downloadRecording();
      cleanup();
    };

    mediaRecorder.onerror = e => {
      console.error("❌ MediaRecorder error:", e);
      document.getElementById("status").textContent = "❌ Recording error";
      cleanup();
    };

    mediaRecorder.start(1000);
    document.getElementById("status").textContent = isAutoRecord ? "🟢 Auto Recording..." : "🟢 Recording...";
    startTimer();

    await chrome.storage.local.set({ isRecording: true, recordingStartTime });
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    
    console.log("✅ Recording started successfully!");
    console.log("🎯 Recording will follow Google Meet mute/unmute status");

  } catch (err) {
    console.error("❌ Recording start failed:", err);
    document.getElementById("status").textContent = "❌ Recording failed: " + err.message;
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    console.log("🛑 Stopping recording...");
    mediaRecorder.stop();
  } else {
    console.log("⚠️ No active recording to stop");
  }
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeStr = `${mins}:${secs}`;
    timerEl.textContent = timeStr;
    chrome.storage.local.set({ recordingTime: timeStr });
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function downloadRecording() {
  if (!recordedChunks.length) {
    console.error("❌ No recording data available");
    document.getElementById("status").textContent = "❌ No recording data";
    return;
  }

  console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
  const filename = `gmeet-recording-${timestamp}.webm`;

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
      fallbackDownload(blob, filename);
    } else {
      console.log("✅ Download started with ID:", downloadId);
      document.getElementById("status").textContent = "✅ Recording saved!";
    }
  });
}

function fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  document.getElementById("status").textContent = "✅ Recording saved!";
}

function cleanup() {
  console.log("🧹 Cleaning up recording resources");
  isRecording = false;
  stopTimer();

  // Clear mute check interval
  if (muteCheckInterval) {
    clearInterval(muteCheckInterval);
    muteCheckInterval = null;
  }

  // Close audio context
  if (originalAudioContext) {
    originalAudioContext.close();
    originalAudioContext = null;
  }

  if (mediaRecorder?.stream) {
    mediaRecorder.stream.getTracks().forEach(track => {
      track.stop();
      console.log("🔴 Stopped track:", track.kind);
    });
  }
  
  recordedChunks = [];
  chrome.storage.local.remove(['isRecording','recordingTime','recordingStartTime']);
  chrome.runtime.sendMessage({ action: "recordingStopped" });
  document.getElementById("status").textContent = "✅ Recording completed";

  if (isAutoRecord) {
    console.log("🤖 Auto-record mode - closing tab in 3 seconds");
    setTimeout(() => window.close(), 3000);
  }
}

// Keep tab alive for auto-recording
setInterval(() => { 
  if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer").textContent); 
}, 30000);
*/


/*
/// recorder.js – runs in a dedicated tab for recording
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let timerInterval;
let recordingStartTime;
let isAutoRecord = false;
let originalAudioContext = null;
let muteCheckInterval = null;
let autoRecordEnabled = false;
let shouldDownloadOnClose = false;


console.log("🎬 GMeet Recorder tab loaded");

// Function to sync toggle state
async function syncToggleState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      autoRecordEnabled = result.autoRecordPermission || false;
      console.log("🔄 Recorder: Auto record permission:", autoRecordEnabled);
      // Update UI in real time
      updateToggleDisplay();
      resolve(autoRecordEnabled);
    });
  });
}

// Function to update the toggle
function updateToggleDisplay() {
  const statusElement = document.getElementById("status");
  const indicatorElement = document.getElementById("autoRecordIndicator");
  
  if (indicatorElement) {
    indicatorElement.textContent = `Auto Record: ${autoRecordEnabled ? 'ON' : 'OFF'}`;
    indicatorElement.className = `auto-record-indicator ${autoRecordEnabled ? 'auto-on' : 'auto-off'}`;
  }
  
  if (statusElement) {
    if (isRecording) {
      statusElement.textContent = autoRecordEnabled ? "🟢 Auto Recording..." : "🟢 Recording...";
    } else {
      statusElement.textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record...";
    }
  }
}

// Add tab closure detection
function setupTabClosureDetection(tabId) {
  // Check if source tab still exists periodically
  const tabCheckInterval = setInterval(async () => {
    if (!isRecording) {
      clearInterval(tabCheckInterval);
      return;
    }
    
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) {
        console.log("❌ Source tab closed - stopping recording");
        stopRecording();
        clearInterval(tabCheckInterval);
      }
    } catch (error) {
      console.log("❌ Source tab closed or inaccessible - stopping recording");
      stopRecording();
      clearInterval(tabCheckInterval);
    }
  }, 2000); // Check every 2 seconds
}

// To listen for toggle state changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoRecordPermission) {
    autoRecordEnabled = changes.autoRecordPermission.newValue;
    console.log("🔄 Recorder: Toggle state updated to:", autoRecordEnabled);
    
    updateToggleDisplay();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Recorder received:", message.action);

  if (message.action === "startRecording") {
    isAutoRecord = message.autoRecord || false;
    startRecording(message.tabId);
    sendResponse({ success: true });
  }

  if (message.action === "stopRecording") {
    stopRecording();
    sendResponse({ success: true });
  }

  return true;
});

async function startRecording(tabId) {
  console.log("🎬 Starting recording for tab:", tabId);

  // Sync toggle state at start
  await syncToggleState();

  if (isRecording) {
    console.log("⚠️ Already recording");
    return;
  }

  try {
    document.getElementById("status").textContent = "🟡 Starting recording...";

    // Capture the tab stream (video + Meet audio)
    const tabStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({
        audio: true,
        video: true,
        audioConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
          }
        },
        videoConstraints: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: tabId,
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      }, (stream) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!stream) reject(new Error("No tab stream returned"));
        else resolve(stream);
      });
    });

    console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                "Video tracks:", tabStream.getVideoTracks().length);

    // Create audio context for mixing
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    
    // Get Meet audio from tab stream (other participants)
    const meetAudioSource = audioContext.createMediaStreamSource(
      new MediaStream(tabStream.getAudioTracks())
    );
    
    // Get microphone audio (your voice) but don't connect it yet
    let micStream = null;
    let micSource = null;
    let micGainNode = null;
    
    try {
      console.log("🎤 Requesting microphone access...");
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });

      console.log("✅ Microphone access granted");
      micSource = audioContext.createMediaStreamSource(micStream);
      micGainNode = audioContext.createGain();
      micSource.connect(micGainNode);
      
      // Start with microphone muted (gain = 0)
      micGainNode.gain.value = 0;
      micGainNode.connect(destination);
      console.log("✅ Microphone connected but MUTED (gain = 0)");
      
    } catch (micError) {
      console.error("❌ Microphone access denied:", micError);
    }

    // Connect Meet audio to destination (always on)
    meetAudioSource.connect(destination);
    console.log("✅ Meet audio connected to recording");

    // Function to check mute status and update microphone gain
    const updateMicrophoneMute = async () => {
      try {
        // Ask the content script in the Meet tab about mute status
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { action: "getMuteStatus" }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ isMuted: true }); // Default to muted if error
            } else {
              resolve(response || { isMuted: true });
            }
          });
        });

        if (micGainNode) {
          if (response.isMuted) {
            micGainNode.gain.value = 0;
            console.log("🔇 Microphone muted in recording (Meet is muted)");
          } else {
            micGainNode.gain.value = 1.0;
            console.log("🎤 Microphone UNMUTED in recording (Meet is unmuted)");
          }
        }
      } catch (error) {
        console.log("⚠️ Could not check mute status, keeping microphone muted");
        if (micGainNode) micGainNode.gain.value = 0;
      }
    };

    // Check mute status every 2 seconds
    muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
    
    // Initial mute check
    updateMicrophoneMute();

    // Create final stream: video + mixed audio
    // Create final stream: video + mixed audio
const videoTrack = tabStream.getVideoTracks()[0];
const mixedAudioTrack = destination.stream.getAudioTracks()[0];

// 🆕 Check the ORIGINAL source tracks from tabStream for closure detection
const sourceVideoTrack = tabStream.getVideoTracks()[0];
const sourceAudioTrack = tabStream.getAudioTracks()[0];

if (sourceVideoTrack) {
  sourceVideoTrack.onended = () => {
    console.log("❌ Source video track ended - Meet tab closed");
    stopRecording();
  };
}

if (sourceAudioTrack) {
  sourceAudioTrack.onended = () => {
    console.log("❌ Source audio track ended - Meet tab closed");
    stopRecording();
  };
}

// ✅ Now these variables are properly defined
if (!videoTrack) {
  throw new Error("No video track available from tab capture");
}

if (!mixedAudioTrack) {
  throw new Error("No audio track available after mixing");
}

const finalStream = new MediaStream([videoTrack, mixedAudioTrack]);
console.log("✅ Final recording stream created");

    // Choose MIME type
    const mimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus', 
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    console.log("🎥 Using MIME type:", supportedType);

    mediaRecorder = new MediaRecorder(finalStream, {
      mimeType: supportedType,
      videoBitsPerSecond: 2500000,
      audioBitsPerSecond: 128000
    });

    recordedChunks = [];
    isRecording = true;
    recordingStartTime = Date.now();
    originalAudioContext = audioContext;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
        console.log("📦 Data chunk:", e.data.size, "bytes");
      }
    };

    mediaRecorder.onstop = () => {
      console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
      stopTimer();
      downloadRecording();
      cleanup();
    };

    mediaRecorder.onerror = e => {
      console.error("❌ MediaRecorder error:", e);
      document.getElementById("status").textContent = "❌ Recording error";
      cleanup();
    };

    mediaRecorder.start(1000);
    updateToggleDisplay();
    startTimer();

    setupTabClosureDetection(tabId);


    await chrome.storage.local.set({ isRecording: true, recordingStartTime });
    chrome.runtime.sendMessage({ action: "recordingStarted" });
    
    console.log("✅ Recording started successfully!");
    console.log("🎯 Recording will follow Google Meet mute/unmute status");

  } catch (err) {
    console.error("❌ Recording start failed:", err);
    document.getElementById("status").textContent = "❌ Recording failed: " + err.message;
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    console.log("🛑 Stopping recording...");
    mediaRecorder.stop();
  } else {
    console.log("⚠️ No active recording to stop");
  }
}

function startTimer() {
  let seconds = 0;
  const timerEl = document.getElementById("timer");
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    const timeStr = `${mins}:${secs}`;
    timerEl.textContent = timeStr;
    chrome.storage.local.set({ recordingTime: timeStr });
    chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function downloadRecording() {
  if (!recordedChunks.length) {
    console.error("❌ No recording data available");
    document.getElementById("status").textContent = "❌ No recording data";
    return;
  }

  console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
  const filename = `gmeet-recording-${timestamp}.webm`;

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
      fallbackDownload(blob, filename);
    } else {
      console.log("✅ Download started with ID:", downloadId);
      document.getElementById("status").textContent = "✅ Recording saved!";
    }
  });
}

function fallbackDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  document.getElementById("status").textContent = "✅ Recording saved!";
}

function cleanup() {
  console.log("🧹 Cleaning up recording resources");
  isRecording = false;
  stopTimer();

  // Clear mute check interval
  if (muteCheckInterval) {
    clearInterval(muteCheckInterval);
    muteCheckInterval = null;
  }

  // Close audio context
  if (originalAudioContext) {
    originalAudioContext.close();
    originalAudioContext = null;
  }

  if (mediaRecorder?.stream) {
    mediaRecorder.stream.getTracks().forEach(track => {
      track.stop();
      console.log("🔴 Stopped track:", track.kind);
    });
  }
  
  recordedChunks = [];
  chrome.storage.local.remove(['isRecording','recordingTime','recordingStartTime','recordingStoppedByTabClose']);
  chrome.runtime.sendMessage({ action: "recordingStopped" });
  document.getElementById("status").textContent = "✅ Recording completed";

  // Close tab for ALL recording types (manual + auto)
  //setTimeout(() => window.close(), 2000);
}

// Keep tab alive for auto-recording
setInterval(() => { 
  if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer").textContent); 
}, 30000);

//--------------------Handle tab closure during recording

// FIXED VERSION - Replace with this:
window.addEventListener('beforeunload', (event) => {
  if (isRecording && recordedChunks.length > 0) {
    console.log("🚨 Recorder tab closing during recording");
    
    // Store recording data for potential download
    const recordingData = {
      timestamp: Date.now(),
      chunkCount: recordedChunks.length
    };
    sessionStorage.setItem('pendingRecording', JSON.stringify(recordingData));
    
    // Show the Leave/Cancel dialog
    event.preventDefault();
    event.returnValue = '';
    return '';
  }
});

// This only fires when they actually LEAVE the page
window.addEventListener('unload', () => {
  const pendingRecording = sessionStorage.getItem('pendingRecording');
  
  if (pendingRecording && recordedChunks.length > 0) {
    console.log("✅ User confirmed Leave - downloading recording");
    
    // Use chrome.downloads API which works in unload
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
    const filename = `gmeet-recording-${timestamp}.webm`;
    
    chrome.downloads.download({ 
      url: url, 
      filename: filename, 
      saveAs: true 
    });
    
    // Clean up sessionStorage
    sessionStorage.removeItem('pendingRecording');

    // 🆕 USE STORAGE INSTEAD OF MESSAGING (more reliable during unload)
    chrome.storage.local.set({ 
      recordingStoppedByTabClose: true 
    });
    
    // URL will be cleaned up when tab closes
  }
});
*/
