// Popup script - displays huddle timing data

let currentStartTime = null;
let timerInterval = null;

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Popup opened");
    await loadHuddleData();
    startLiveTimer();
});

// Load saved huddle data from storage
async function loadHuddleData() {
    const result = await chrome.storage.local.get([
        'huddleStartTime', 
        'huddleEndTime', 
        'huddleDuration',
        'isInHuddle'
    ]);
    
    console.log("Loaded data:", result);
    
    if (result.huddleStartTime && !result.isInHuddle) {
        // Show last completed huddle
        const startDate = new Date(result.huddleStartTime);
        document.getElementById("startTime").textContent = startDate.toLocaleTimeString();
        
        if (result.huddleEndTime) {
            const endDate = new Date(result.huddleEndTime);
            document.getElementById("endTime").textContent = endDate.toLocaleTimeString();
        }
        
        if (result.huddleDuration) {
            document.getElementById("duration").textContent = result.huddleDuration;
        }
        
        updateStatusBadge(false);
        
    } else if (result.huddleStartTime && result.isInHuddle) {
        // Currently in a huddle
        currentStartTime = result.huddleStartTime;
        showCurrentHuddle(currentStartTime);
        updateStatusBadge(true);
        
    } else {
        // No huddle data
        document.getElementById("startTime").textContent = "--:--:--";
        document.getElementById("endTime").textContent = "--:--:--";
        document.getElementById("duration").textContent = "--m --s";
        updateStatusBadge(false);
    }
}

// Show current active huddle
function showCurrentHuddle(startTime) {
    const startDate = new Date(startTime);
    document.getElementById("currentStartTime").textContent = startDate.toLocaleTimeString();
    document.getElementById("currentHuddleCard").style.display = "block";
    updateCurrentDuration();
}

// Update current huddle duration live
function updateCurrentDuration() {
    if (!currentStartTime) return;
    
    const now = Date.now();
    const durationMs = now - currentStartTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);
    document.getElementById("currentDuration").textContent = `${minutes}m ${seconds}s`;
}

// Start live timer for current huddle
function startLiveTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(async () => {
        const result = await chrome.storage.local.get(['isInHuddle', 'huddleStartTime']);
        
        if (result.isInHuddle && result.huddleStartTime) {
            if (!currentStartTime || currentStartTime !== result.huddleStartTime) {
                currentStartTime = result.huddleStartTime;
                showCurrentHuddle(currentStartTime);
                updateStatusBadge(true);
            }
            updateCurrentDuration();
        } else {
            if (currentStartTime) {
                // Huddle ended, reload all data
                currentStartTime = null;
                document.getElementById("currentHuddleCard").style.display = "none";
                await loadHuddleData();
            }
        }
    }, 1000);
}

// Update status badge
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

// Listen for updates from background
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.huddleStartTime || changes.huddleEndTime || changes.huddleDuration || changes.isInHuddle) {
            loadHuddleData();
        }
    }
});