let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let tabStream, micStream;

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {

  if (msg.type === "START_RECORDING") {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab || !tab.url.includes("meet.google.com")) {
        return sendResponse({ error: "Open an active Google Meet tab" });
      }

      // Capture tab video + audio
      chrome.tabCapture.capture({ audio: true, video: true }, async (capturedTabStream) => {
        if (!capturedTabStream) return sendResponse({ error: "Failed to capture tab" });

        tabStream = capturedTabStream;

        // Capture mic
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const ctx = new AudioContext();
          const dest = ctx.createMediaStreamDestination();

          if (tabStream.getAudioTracks().length > 0) {
            ctx.createMediaStreamSource(tabStream).connect(dest);
          }
          if (micStream.getAudioTracks().length > 0) {
            ctx.createMediaStreamSource(micStream).connect(dest);
          }

          const finalStream = new MediaStream([
            ...tabStream.getVideoTracks(),
            ...dest.stream.getAudioTracks()
          ]);

          startMediaRecorder(finalStream);
          isRecording = true;
          sendResponse({ ok: true });

        } catch (err) {
          console.warn("Mic failed, fallback to tab only", err);
          startMediaRecorder(tabStream);
          isRecording = true;
          sendResponse({ ok: true });
        }
      });
    } catch (err) {
      sendResponse({ error: "Recording failed" });
    }
    return true; // keep channel open
  }

  if (msg.type === "STOP_RECORDING") {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    isRecording = false;
    sendResponse({ ok: true });
  }

  if (msg.type === "GET_RECORDING_STATE") {
    sendResponse({ isRecording });
  }
});

function startMediaRecorder(stream) {
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp8,opus" });
  recordedChunks = [];

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: `gmeet_recording_${Date.now()}.webm` });

    if (tabStream) tabStream.getTracks().forEach(t => t.stop());
    if (micStream) micStream.getTracks().forEach(t => t.stop());
  };

  mediaRecorder.start();

  // Tell content script to show timer
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, { type: "SHOW_TIMER" });
  });
}
