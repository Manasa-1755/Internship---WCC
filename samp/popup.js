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
function startTimer(initialSeconds = 0) {
  secondsElapsed = initialSeconds;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    secondsElapsed++;
    updateTimerDisplay();
  }, 1000);
}

function updateTimerDisplay() {
  const minutes = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
  const seconds = String(secondsElapsed % 60).padStart(2, "0");
  timerEl.textContent = `${minutes}:${seconds}`;
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

// ----------------- Restore Timer State on Popup Load -----------------
chrome.storage.local.get(["isRecording", "recordingStartTime"], ({ isRecording, recordingStartTime }) => {
  if (isRecording && recordingStartTime) {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    startTimer(elapsed);
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    stopTimer(); // make sure timer is reset if not recording
  }
});

// ----------------- Start Recording -----------------
async function startRecording() {
  chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    if (!tab || !tab.url.includes("meet.google.com")) return alert("Open a Google Meet tab");

    chrome.tabCapture.capture({ audio: true, video: true }, async (capturedTabStream) => {
      if (!capturedTabStream) return alert("Failed to capture tab");
      tabStream = capturedTabStream;

      // Play tab audio (hidden)
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

        if (tabStream.getAudioTracks().length) ctx.createMediaStreamSource(tabStream).connect(destination);
        if (micStream.getAudioTracks().length) ctx.createMediaStreamSource(micStream).connect(destination);

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

        chrome.storage.local.set({ isRecording: false, recordingStartTime: null });
      };

      mediaRecorder.start();
      startBtn.disabled = true;
      stopBtn.disabled = false;

      chrome.storage.local.set({ isRecording: true, recordingStartTime: Date.now() });

      startTimer(0);

      // Monitor leave button
      monitorLeaveButton(tab.id);
    });
  });
}

// ----------------- Event Listeners -----------------
startBtn.addEventListener("click", startRecording);
// ----------------- Stop Recording -----------------
stopBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    stopTimer(); // STOP the timer immediately
  }
});
