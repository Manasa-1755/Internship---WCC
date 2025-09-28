(function () {
  let meetingStarted = false;
  let startTime = null;

  // Floating timer
  let timerEl = null;
  let timerInterval = null;

  function showTimer() {
    if (timerEl) return;
    timerEl = document.createElement("div");
    Object.assign(timerEl.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      background: "#202124",
      color: "#fff",
      padding: "10px 15px",
      borderRadius: "8px",
      fontSize: "14px",
      zIndex: "9999"
    });
    timerEl.innerText = "Recording: 00:00";
    document.body.appendChild(timerEl);

    timerInterval = setInterval(updateTimer, 1000);
  }

  function updateTimer() {
    if (!startTime || !timerEl) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const seconds = String(elapsed % 60).padStart(2, "0");
    timerEl.innerText = `Recording: ${minutes}:${seconds}`;
  }

  function hideTimer() {
    if (timerEl) timerEl.remove();
    timerEl = null;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  // Detect if meeting is active
  function isMeetingActive() {
    return document.querySelector('[aria-label^="Leave call"], [aria-label^="Leave meeting"]');
  }

  function checkMeeting() {
    const active = isMeetingActive();

    if (active && !meetingStarted) {
      meetingStarted = true;
      startTime = Date.now();
      console.log(`%cMeeting started at ${getCurrentTime()}`, "color: #0f9d58; font-weight: bold;");
      chrome.runtime.sendMessage({ type: "AUTO_START" });
      showTimer();
    } else if (!active && meetingStarted) {
      meetingStarted = false;
      const endTime = Date.now();
      const durationSec = Math.floor((endTime - startTime) / 1000);

      console.log(`%cMeeting ended at ${getCurrentTime()}`, "color: #d93025; font-weight: bold;");
      console.log(
        `%cDuration: ${Math.floor(durationSec / 60)} min ${durationSec % 60} sec`,
        "color: #f4b400; font-weight: bold;"
      );

      chrome.runtime.sendMessage({ type: "AUTO_STOP" });
      hideTimer();
      startTime = null;
    }
  }

  const observer = new MutationObserver(checkMeeting);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });

  // Fallback interval
  setInterval(checkMeeting, 3000);

  console.log("%c[Meet Detector] Initialized, watching for meeting start/stop...", "color: #1a73e8; font-weight: bold;");
})();
