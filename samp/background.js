let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// Start recording from popup or background
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {

  if (msg.command === "start") {
    if (isRecording) return sendResponse({ status: "Already recording" });

    chrome.tabCapture.capture({ audio: true, video: true }, async (stream) => {
      if (!stream) return sendResponse({ status: "Failed to capture tab" });

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp8,opus" });

      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const filename = `gmeet_recording_${Date.now()}.webm`;
        chrome.downloads.download({ url, filename });
        recordedChunks = [];
      };

      mediaRecorder.start();
      isRecording = true;
      chrome.storage.local.set({ isRecording: true });
      sendResponse({ status: "Recording started" });
    });
    return true; // async response
  }

  if (msg.command === "stop") {
    if (!isRecording || !mediaRecorder) return sendResponse({ status: "Not recording" });
    mediaRecorder.stop();
    isRecording = false;
    chrome.storage.local.set({ isRecording: false });
    sendResponse({ status: "Recording stopped" });
  }

  if (msg.command === "leaveDetected") {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      isRecording = false;
      chrome.storage.local.set({ isRecording: false });
    }
  }
});
