let mediaRecorder;
let recordedChunks = [];
let tabStream, micStream;
let audioEl;

// Listen for messages from content.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab || !sender.tab.id) return;
  const tabId = sender.tab.id;

  if (msg.type === "AUTO_START") {
    console.log("[Meet Recorder] AUTO_START received");
    startRecording(tabId);
  }

  if (msg.type === "AUTO_STOP") {
    console.log("[Meet Recorder] AUTO_STOP received");
    stopRecording(tabId);
  }
});

// Start recording function
async function startRecording(tabId) {
  console.log("[Meet Recorder] Capturing tab...");

  chrome.tabCapture.capture({ audio: true, video: true }, async (capturedTabStream) => {
    if (!capturedTabStream) return console.error("[Meet Recorder] Failed to capture tab");
    tabStream = capturedTabStream;

    // Play tab audio silently to keep it alive
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.srcObject = tabStream;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);

    let finalStream = tabStream;

    try {
      // Try to capture mic
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();

      if (tabStream.getAudioTracks().length > 0) ctx.createMediaStreamSource(tabStream).connect(dest);
      if (micStream.getAudioTracks().length > 0) ctx.createMediaStreamSource(micStream).connect(dest);

      finalStream = new MediaStream([
        ...tabStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);
      console.log("[Meet Recorder] Tab + Mic captured");
    } catch (err) {
      console.warn("[Meet Recorder] Mic not captured, recording tab only", err);
    }

    mediaRecorder = new MediaRecorder(finalStream, { mimeType: "video/webm; codecs=vp8,opus" });
    recordedChunks = [];

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      console.log("[Meet Recorder] Recording stopped");
      // Download recording
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: `gmeet_recording_${Date.now()}.webm` });
      cleanup();
    };

    mediaRecorder.start();
    console.log("[Meet Recorder] Recording started");

    // Show timer in tab
    chrome.tabs.sendMessage(tabId, { type: "SHOW_TIMER" });
  });
}

function stopRecording(tabId) {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    console.log("[Meet Recorder] Stopping recording...");
    mediaRecorder.stop();
    chrome.tabs.sendMessage(tabId, { type: "HIDE_TIMER" });
  }
}

function cleanup() {
  if (audioEl) { try { audioEl.pause(); audioEl.srcObject = null; audioEl.remove(); } catch(e) {} audioEl = null; }
  if (tabStream) { tabStream.getTracks().forEach(t => t.stop()); tabStream = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
}
