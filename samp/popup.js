let mediaRecorder;
let recordedChunks = [];
let timerInterval;
let secondsElapsed = 0;

const startBtn = document.getElementById("startBtn");
const stopBtn  = document.getElementById("stopBtn");
const timerEl  = document.getElementById("timer");
const autoRecordToggle = document.getElementById("autoRecordToggle");

let tabStream, micStream, audioEl;

// ----------------- Timer -----------------
function startTimer() {
  secondsElapsed = 0;
  timerEl.textContent = "00:00";
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const minutes = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    const seconds = String(secondsElapsed % 60).padStart(2, "0");
    timerEl.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerEl.textContent = "00:00";
}

// ----------------- Auto-Record Toggle -----------------
autoRecordToggle.addEventListener("change", () => {
  if (autoRecordToggle.checked) {
    stopBtn.style.display = "none";
  } else {
    stopBtn.style.display = "inline-block";
  }
});

// ----------------- Monitor Leave Button -----------------
function monitorLeaveButton(tabId) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const observer = new MutationObserver(() => {
        const leaveBtn = document.querySelector('[aria-label="Leave call"]');
        if (leaveBtn && leaveBtn.offsetParent !== null) {
          chrome.runtime.sendMessage({ command: "leaveDetected" });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
}

// ----------------- Start Recording -----------------
async function startRecording() {
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (!tab || !tab.url.includes("meet.google.com")) return alert("Open a Google Meet tab");

    chrome.tabCapture.capture({ audio: true, video: true }, async (capturedTabStream) => {
      if (!capturedTabStream) return alert("Failed to capture tab");

      tabStream = capturedTabStream;

      // Play tab audio
      audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.srcObject = tabStream;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);

      // Try mic capture + merge
      let finalStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const ctx = new AudioContext();
        const destination = ctx.createMediaStreamDestination();

        if (tabStream.getAudioTracks().length) {
          const tabSource = ctx.createMediaStreamSource(tabStream);
          tabSource.connect(destination);
        }

        if (micStream.getAudioTracks().length) {
          const micSource = ctx.createMediaStreamSource(micStream);
          micSource.connect(destination);
        }

        finalStream = new MediaStream([...tabStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
      } catch {
        finalStream = tabStream;
      }

      mediaRecorder = new MediaRecorder(finalStream, { mimeType: "video/webm; codecs=vp8,opus" });
      recordedChunks = [];

      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };

      mediaRecorder.onstop = () => {
        stopTimer();
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({ url, filename: `gmeet_recording_${Date.now()}.webm` });

        if (audioEl) { audioEl.pause(); audioEl.remove(); audioEl = null; }
        if (tabStream) tabStream.getTracks().forEach(t => t.stop());
        if (micStream) micStream.getTracks().forEach(t => t.stop());

        startBtn.disabled = false;
        stopBtn.disabled = true;
      };

      mediaRecorder.start();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      startTimer();

      // Monitor leave button
      monitorLeaveButton(tab.id);
    });
  });
}

// ----------------- Event Listeners -----------------
startBtn.addEventListener("click", () => startRecording());
stopBtn.addEventListener("click", () => { if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop(); });
