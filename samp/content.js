let recordingPopupEl;
let recordingStartTime = null;
let timerIntervalId = null;

function showRecordingPopup() {
  if (recordingPopupEl) return;

  recordingStartTime = Date.now();
  recordingPopupEl = document.createElement("div");
  recordingPopupEl.innerText = "Recording: 00:00";

  Object.assign(recordingPopupEl.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    background: "#202124",
    color: "white",
    padding: "12px 18px",
    borderRadius: "8px",
    fontSize: "14px",
    zIndex: "9999",
    opacity: "0",
    transition: "opacity 0.4s ease"
  });

  document.body.appendChild(recordingPopupEl);
  setTimeout(() => { recordingPopupEl.style.opacity = "1"; }, 50);

  timerIntervalId = setInterval(updateRecordingTimer, 1000);
}

function updateRecordingTimer() {
  if (!recordingPopupEl || !recordingStartTime) return;
  const elapsedMs = Date.now() - recordingStartTime;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  recordingPopupEl.innerText = `Recording: ${minutes}:${seconds}`;
}

function hideRecordingPopup() {
  if (!recordingPopupEl) return;
  clearInterval(timerIntervalId);
  recordingPopupEl.remove();
  recordingPopupEl = null;
  recordingStartTime = null;
  timerIntervalId = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SHOW_TIMER") showRecordingPopup();
  if (msg.type === "HIDE_TIMER") hideRecordingPopup();
});
