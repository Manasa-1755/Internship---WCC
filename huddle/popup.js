// Popup script - displays huddle timing data

let currentStartTime = null;
let timerInterval = null;
let recordingTimerInterval = null;
let isCurrentlyInHuddle = false;
let recordingStartTime = null;
let isRecordingActive = false;

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Popup opened");
    await loadHuddleData();
    startLiveTimer();
    setupRecordingButtons();
    checkRecordingStatus();
    
    // Listen for user-stopped recording via browser UI
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "recordingStoppedByUser") {
            handleRecordingStoppedByUser();
        }
    });
});

function handleRecordingStoppedByUser() {
    console.log("Recording stopped by user via browser UI");
    
    document.getElementById("stopRecordingBtn").style.display = "none";
    document.getElementById("startRecordingBtn").style.display = "flex";
    document.getElementById("startRecordingBtn").disabled = isCurrentlyInHuddle;
    hideRecordingStatus();
    isRecordingActive = false;
    
    chrome.runtime.sendMessage({ action: "setRecordingStatus", isRecording: false });
    chrome.storage.local.set({ isRecording: false });
}

function setupRecordingButtons() {
    const startBtn = document.getElementById("startRecordingBtn");
    const stopBtn = document.getElementById("stopRecordingBtn");
    
    startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        startBtn.textContent = "🎥 Opening share picker...";
        await startRecording();
        startBtn.disabled = false;
        startBtn.textContent = "🎥 Start Recording";
    });
    
    stopBtn.addEventListener("click", async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = "⏹️ Stopping...";
        await stopRecording();
        stopBtn.disabled = false;
        stopBtn.textContent = "⏹️ Stop & Download";
    });
}

async function startRecording() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab || !tab.id) {
            alert("No active tab found. Please make sure Google Chat is open.");
            return;
        }
        
        if (!tab.url.includes("chat.google.com") && !tab.url.includes("mail.google.com")) {
            alert("Please navigate to Google Chat or Gmail to record a huddle.");
            return;
        }
        
        // Inject recorder script
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['recorder.js']
            });
            console.log("Recorder script injected");
        } catch (e) {
            console.log("Recorder script already injected");
        }
        
        // Start recording with screen picker
        chrome.tabs.sendMessage(tab.id, { action: "startRecording" }, (response) => {
            if (chrome.runtime.lastError) {
                alert("Failed to communicate with the page. Please refresh and try again.");
                document.getElementById("startRecordingBtn").disabled = isCurrentlyInHuddle;
                return;
            }
            
            if (response && response.success) {
                document.getElementById("startRecordingBtn").style.display = "none";
                document.getElementById("stopRecordingBtn").style.display = "flex";
                showRecordingStatus(true);
                startRecordingTimer();
                isRecordingActive = true;
                
                chrome.runtime.sendMessage({ action: "setRecordingStatus", isRecording: true });
                chrome.storage.local.set({ isRecording: true });
                
            } else if (response && response.error) {
                alert("Recording failed: " + response.error);
                document.getElementById("startRecordingBtn").disabled = isCurrentlyInHuddle;
            } else {
                alert("No response from recording script.");
                document.getElementById("startRecordingBtn").disabled = isCurrentlyInHuddle;
            }
        });
        
    } catch (error) {
        console.error("Recording error:", error);
        alert("Failed to start recording: " + error.message);
        document.getElementById("startRecordingBtn").disabled = isCurrentlyInHuddle;
    }
}

async function stopRecording() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
        }
        
        document.getElementById("stopRecordingBtn").style.display = "none";
        document.getElementById("startRecordingBtn").style.display = "flex";
        document.getElementById("startRecordingBtn").disabled = isCurrentlyInHuddle;
        hideRecordingStatus();
        isRecordingActive = false;
        
        chrome.runtime.sendMessage({ action: "setRecordingStatus", isRecording: false });
        chrome.storage.local.set({ isRecording: false });
        
    } catch (error) {
        console.error("Stop recording error:", error);
    }
}

function showRecordingStatus(show) {
    const statusDiv = document.getElementById("recordingStatus");
    statusDiv.style.display = show ? "flex" : "none";
}

function hideRecordingStatus() {
    document.getElementById("recordingStatus").style.display = "none";
    if (recordingTimerInterval) {
        clearInterval(recordingTimerInterval);
        recordingTimerInterval = null;
    }
}

function startRecordingTimer() {
    if (recordingTimerInterval) clearInterval(recordingTimerInterval);
    
    recordingStartTime = Date.now();
    
    recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById("recordingTime").textContent = `Recording: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

async function checkRecordingStatus() {
    const result = await chrome.storage.local.get(['isRecording']);
    if (result.isRecording) {
        document.getElementById("startRecordingBtn").style.display = "none";
        document.getElementById("stopRecordingBtn").style.display = "flex";
        showRecordingStatus(true);
        startRecordingTimer();
        isRecordingActive = true;
    }
}

function updateRecordingButtons(isInHuddle) {
    const startBtn = document.getElementById("startRecordingBtn");
    const stopBtn = document.getElementById("stopRecordingBtn");
    
    if (isInHuddle && stopBtn.style.display !== "flex") {
        startBtn.disabled = false;
    } else if (!isInHuddle) {
        startBtn.disabled = true;
    }
}

async function loadHuddleData() {
    const result = await chrome.storage.local.get([
        'huddleStartTime', 'huddleEndTime', 'huddleDuration', 'isInHuddle'
    ]);
    
    isCurrentlyInHuddle = result.isInHuddle || false;
    updateRecordingButtons(isCurrentlyInHuddle);
    
    if (result.huddleStartTime && !result.isInHuddle) {
        document.getElementById("startTime").textContent = new Date(result.huddleStartTime).toLocaleTimeString();
        if (result.huddleEndTime) {
            document.getElementById("endTime").textContent = new Date(result.huddleEndTime).toLocaleTimeString();
        }
        if (result.huddleDuration) {
            document.getElementById("duration").textContent = result.huddleDuration;
        }
        updateStatusBadge(false);
        
    } else if (result.huddleStartTime && result.isInHuddle) {
        currentStartTime = result.huddleStartTime;
        showCurrentHuddle(currentStartTime);
        updateStatusBadge(true);
        
    } else {
        document.getElementById("startTime").textContent = "--:--:--";
        document.getElementById("endTime").textContent = "--:--:--";
        document.getElementById("duration").textContent = "--m --s";
        updateStatusBadge(false);
    }
}

function showCurrentHuddle(startTime) {
    document.getElementById("currentStartTime").textContent = new Date(startTime).toLocaleTimeString();
    document.getElementById("currentHuddleCard").style.display = "block";
    updateCurrentDuration();
}

function updateCurrentDuration() {
    if (!currentStartTime) return;
    const durationMs = Date.now() - currentStartTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    document.getElementById("currentDuration").textContent = `${minutes}m ${seconds}s`;
}

function startLiveTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(async () => {
        const result = await chrome.storage.local.get(['isInHuddle', 'huddleStartTime']);
        
        if (result.isInHuddle && result.huddleStartTime) {
            if (!currentStartTime || currentStartTime !== result.huddleStartTime) {
                currentStartTime = result.huddleStartTime;
                showCurrentHuddle(currentStartTime);
                updateStatusBadge(true);
                isCurrentlyInHuddle = true;
                updateRecordingButtons(true);
            }
            updateCurrentDuration();
        } else if (currentStartTime) {
            currentStartTime = null;
            document.getElementById("currentHuddleCard").style.display = "none";
            isCurrentlyInHuddle = false;
            updateRecordingButtons(false);
            loadHuddleData();
        }
    }, 1000);
}

function updateStatusBadge(isInHuddle) {
    const icon = document.getElementById("huddleStatusIcon");
    const text = document.getElementById("huddleStatusText");
    
    if (isInHuddle) {
        icon.textContent = "🔴";
        text.textContent = "In a huddle";
        text.style.color = "#ff6b6b";
    } else {
        icon.textContent = "⚪";
        text.textContent = "Not in huddle";
        text.style.color = "#aaa";
    }
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.huddleStartTime || changes.huddleEndTime || changes.huddleDuration || changes.isInHuddle) {
        loadHuddleData();
    }
});