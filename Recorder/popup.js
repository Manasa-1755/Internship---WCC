// UNIFIED POPUP.JS - Google Meet & Microsoft Teams
let activeTabId;
let isRecording = false;
let autoRecordEnabled = false;
let currentService = null; // 'gmeet', 'teams', or null
let detectedService = null;

// Service configuration
const SERVICE_CONFIG = {
    gmeet: {
        name: 'Google Meet',
        icon: '📹',
        domains: ['meet.google.com'],
        contentScript: 'content-gmeet.js',
        noteElement: 'gmeetNote',
        theme: 'gmeet-theme',
        checkMeetingAction: 'checkMeetingStatus',
        manualStartAction: 'manualRecordingStarted',
        manualStopAction: 'manualRecordingStopped'
    },
    teams: {
        name: 'Microsoft Teams',
        icon: '💼',
        domains: ['teams.microsoft.com', 'teams.live.com'],
        contentScript: 'content-teams.js',
        noteElement: 'teamsNote',
        theme: 'teams-theme',
        checkMeetingAction: 'checkMeetingStatus',
        manualStartAction: 'manualRecordingStarted',
        manualStopAction: 'manualRecordingStopped'
    }
};

// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🔍 Universal Recorder popup opened");
    
    try {
        await initializePopup();
        startUISyncChecker();
    } catch (error) {
        console.error("❌ Error initializing popup:", error);
        updateStatus("❌ Error initializing extension", "error");
    }
});

async function initializePopup() {
    setupEventListeners();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab && tab.url) {
        activeTabId = tab.id;
        detectedService = detectServiceFromUrl(tab.url);
        updateDetectionInfo(detectedService);
        
        await setCurrentService(detectedService || await getStoredServicePreference());
        
        if (detectedService) {
            await checkMeetingStatus();
        }
    }
    
    await checkRecordingStatus();
    await checkAutoRecordPermission();
}

function setupEventListeners() {
    // Service selection - FIXED: Proper radio button handling
    document.querySelectorAll('input[name="service"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.checked) {
                setCurrentService(e.target.value);
            }
        });
    });
    
    // Service selection
    document.getElementById('gmeetOption').addEventListener('click', () => setCurrentService('gmeet'));
    document.getElementById('teamsOption').addEventListener('click', () => setCurrentService('teams'));
    
    // Auto record toggle
    document.getElementById('autoRecordToggle').addEventListener('change', handleAutoRecordToggle);
    
    // Recording buttons
    document.getElementById("startBtn").addEventListener("click", handleStartRecording);
    document.getElementById("stopBtn").addEventListener("click", handleStopRecording);
    
    // Popup focus
    document.addEventListener('focus', handlePopupFocus);
    
    setupTooltips();
}

// ==================== SERVICE MANAGEMENT ====================
function detectServiceFromUrl(url) {
    for (const [service, config] of Object.entries(SERVICE_CONFIG)) {
        if (config.domains.some(domain => url.includes(domain))) {
            return service;
        }
    }
    return null;
}

async function setCurrentService(service) {
    if (!service || !SERVICE_CONFIG[service]) {
        console.log("⚠️ Invalid service:", service);
        return;
    }
    
    currentService = service;
    updateServiceUI(service);
    updateTheme(service);
    await chrome.storage.local.set({ preferredService: service });
    
    console.log(`✅ Service set to: ${SERVICE_CONFIG[service].name}`);
}

async function getStoredServicePreference() {
    const result = await chrome.storage.local.get(['preferredService']);
    return result.preferredService || 'gmeet';
}

// ==================== UI UPDATES ====================
function updateServiceUI(service) {
    // Update radio buttons
    document.querySelectorAll('.service-option').forEach(option => {
        option.classList.remove('active');
    });
    
    const selectedOption = document.getElementById(`${service}Option`);
    if (selectedOption) {
        selectedOption.classList.add('active');
        const radio = selectedOption.querySelector('input[type="radio"]');
        if (radio) {
            radio.checked = true;  
        }
    }
    
    // Update service-specific notes
    document.getElementById('gmeetNote').style.display = service === 'gmeet' ? 'block' : 'none';
    document.getElementById('teamsNote').style.display = service === 'teams' ? 'block' : 'none';
    
    // Update warning for Teams
    document.getElementById('warning').style.display = service === 'teams' && activeTabId ? 'block' : 'none';
    
    if (!activeTabId) {
        updateStatus(`❌ Please open ${SERVICE_CONFIG[service].name}`, "error");
    } else if (detectedService && detectedService !== service) {
        updateStatus(`⚠️ Manual override - ${SERVICE_CONFIG[service].name} selected`, "warning");
    }
}

function updateTheme(service) {
    const body = document.body;
    body.className = '';
    body.classList.add(SERVICE_CONFIG[service]?.theme || 'default-theme');
}

function updateDetectionInfo(detectedService) {
    const detectionInfo = document.getElementById('detectionInfo');
    const detectedServiceSpan = document.getElementById('detectedService');
    
    if (detectedService) {
        detectionInfo.style.display = 'block';
        detectedServiceSpan.textContent = SERVICE_CONFIG[detectedService].name;
        detectedServiceSpan.style.fontWeight = 'bold';
    } else {
        detectionInfo.style.display = 'none';
    }
}

function updateStatus(message, type = "info") {
    const statusElement = document.getElementById("status");
    statusElement.textContent = message;
    
    switch (type) {
        case "error":
            statusElement.style.color = "#f44336";
            break;
        case "warning":
            statusElement.style.color = "#FF9800";
            break;
        case "success":
            statusElement.style.color = "#4CAF50";
            break;
        default:
            statusElement.style.color = "#ffffff";
    }
}

function updateButtonStates() {
    const startBtn = document.getElementById("startBtn");
    const stopBtn = document.getElementById("stopBtn");
    
    if (autoRecordEnabled) {
        // Auto mode ON - disable manual buttons
        startBtn.disabled = true;
        stopBtn.disabled = true;
        startBtn.style.backgroundColor = "#666";
        stopBtn.style.backgroundColor = "#666";
        startBtn.title = "Manual recording disabled (Auto mode ON)";
        stopBtn.title = "Manual stop disabled (Auto mode ON)";
    } else {
        // Auto mode OFF - enable manual buttons based on recording status
        if (isRecording) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
            startBtn.style.backgroundColor = "#666";
            stopBtn.style.backgroundColor = "#f44336";
        } else {
            startBtn.disabled = !activeTabId || !currentService;
            stopBtn.disabled = true;
            startBtn.style.backgroundColor = (activeTabId && currentService) ? "#4CAF50" : "#666";
            stopBtn.style.backgroundColor = "#666";
        }
        startBtn.title = "Manually start recording";
        stopBtn.title = "Stop recording and download";
    }
}

function updateUIForRecording(recordingTime) {
    document.getElementById("timer").textContent = recordingTime;
    document.getElementById("status").textContent = "🟢 Recording in background...";
    document.getElementById("startBtn").textContent = "Recording...";
    document.getElementById("warning").style.display = currentService === 'teams' ? "block" : "none";
    updateButtonStates();
}

function updateUIForReady() {
    document.getElementById("timer").textContent = "00:00";
    
    if (activeTabId && currentService) {
        document.getElementById("status").textContent = "✅ Ready to record";
    } else if (!currentService) {
        document.getElementById("status").textContent = "❌ Please select a service";
    } else {
        document.getElementById("status").textContent = `❌ Please open ${SERVICE_CONFIG[currentService]?.name || 'a meeting service'}`;
    }
    
    document.getElementById("startBtn").textContent = "Start Recording";
    document.getElementById("warning").style.display = (activeTabId && currentService === 'teams') ? "block" : "none";
    updateButtonStates();
}

// ==================== AUTO RECORD MANAGEMENT ====================
async function checkAutoRecordPermission() {
    const result = await chrome.storage.local.get(['autoRecordPermission']);
    autoRecordEnabled = result.autoRecordPermission || false;
    updateToggleUI();
    return autoRecordEnabled;
}

function updateToggleUI() {
    const toggle = document.getElementById('autoRecordToggle');
    const label = document.getElementById('toggleLabel');
    const permissionText = document.getElementById('permissionText');
    
    if (toggle) toggle.checked = autoRecordEnabled;
    if (label) {
        label.textContent = autoRecordEnabled ? 'ON' : 'OFF';
        label.style.color = autoRecordEnabled ? '#edf0edff' : '#edf0edff';
        label.style.fontWeight = 'bold';
    }
    if (permissionText) {
        permissionText.textContent = autoRecordEnabled 
            ? 'Auto recording enabled ✅' 
            : 'Automatically record when joining meetings';
        permissionText.style.color = autoRecordEnabled ? '#edf0edff' : '#edf0edff';
    }
}

async function handleAutoRecordToggle(e) {
    const enabled = e.target.checked;
    
    if (enabled) {
        const serviceName = SERVICE_CONFIG[currentService]?.name || 'meeting';
        const confirmed = confirm(`Enable Auto Recording?\n\nThis will automatically start recording when you join ${serviceName} and stop when you leave.\n\nManual recording buttons will be disabled.\n\nYou can disable this anytime in the extension.`);
        
        if (confirmed) {
            try {
                await chrome.runtime.sendMessage({ action: "grantAutoRecordPermission" });
                autoRecordEnabled = true;
                updateToggleUI();
                updateButtonStates();
                showPopupMessage(`Auto recording enabled for ${serviceName}! 🎬\nManual buttons disabled`, "success");
            } catch (error) {
                console.error("❌ Failed to enable auto recording:", error);
                e.target.checked = false;
                showPopupMessage("Failed to enable auto recording", "error");
            }
        } else {
            e.target.checked = false;
        }
    } else {
        try {
            await chrome.runtime.sendMessage({ action: "revokeAutoRecordPermission" });
            autoRecordEnabled = false;
            updateToggleUI();
            updateButtonStates();
            showPopupMessage("Auto recording disabled\nManual buttons enabled", "info");
        } catch (error) {
            console.error("❌ Failed to disable auto recording:", error);
            e.target.checked = true;
            showPopupMessage("Failed to disable auto recording", "error");
        }
    }
}

// ==================== RECORDING MANAGEMENT ====================
async function checkRecordingStatus() {
    const result = await chrome.storage.local.get(['isRecording', 'recordingTime', 'recordingStoppedByTabClose']);
    isRecording = result.isRecording || false;

    if (result.recordingStoppedByTabClose) {
        console.log("🔄 Recording was stopped by tab closure - resetting UI");
        isRecording = false;
        await chrome.storage.local.remove(['recordingStoppedByTabClose']);
    }

    if (isRecording) {
        const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
        if (tabs.length === 0) {
            console.log("🔄 No recorder tabs found but storage says recording - resetting UI");
            isRecording = false;
            await chrome.storage.local.set({ isRecording: false });
            updateUIForReady();
        } else {
            updateUIForRecording(result.recordingTime || "00:00");
        }
    } else {
        updateUIForReady();
    }
}

async function handleStartRecording() {
    if (!activeTabId || !currentService) {
        alert(`❌ Please open ${SERVICE_CONFIG[currentService]?.name || 'a meeting service'} first`);
        return;
    }

    if (autoRecordEnabled) {
        alert("❌ Manual recording disabled while Auto Mode is ON\nPlease turn off Auto Mode to use manual recording");
        return;
    }

    try {
        document.getElementById("startBtn").disabled = true;
        document.getElementById("startBtn").textContent = "Starting...";
        document.getElementById("status").textContent = "🟡 Starting recording...";

        // Notify content script
        if (currentService && SERVICE_CONFIG[currentService].manualStartAction) {
            chrome.tabs.sendMessage(activeTabId, { action: SERVICE_CONFIG[currentService].manualStartAction }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("⚠️ Could not notify content script:", chrome.runtime.lastError.message);
                }
            });
        }

        // Create recorder tab
        chrome.tabs.create({
            url: chrome.runtime.getURL("recorder.html"),
            active: false
        }, (tab) => {
            console.log("✅ Recorder tab opened:", tab.id);
            
            setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "startRecording", 
                    tabId: activeTabId,
                    service: currentService
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("❌ Failed to start recording:", chrome.runtime.lastError);
                        document.getElementById("status").textContent = "❌ Failed to start recording";
                        updateUIForReady();
                        showPopupMessage("Failed to start recording", "error");
                    }
                });
            }, 1000);
        });

    } catch (error) {
        console.error("❌ Start recording failed:", error);
        document.getElementById("status").textContent = "❌ Failed to start";
        alert("Failed to start recording: " + error.message);
        updateUIForReady();
        showPopupMessage("Failed to start recording", "error");
    }
}

async function handleStopRecording() {
    if (autoRecordEnabled) {
        alert("❌ Manual stop disabled while Auto Mode is ON\nRecording will stop automatically when you leave the meeting");
        return;
    }

    try {
        document.getElementById("stopBtn").disabled = true;
        document.getElementById("stopBtn").textContent = "Stopping...";
        document.getElementById("status").textContent = "🟡 Stopping recording...";

        // Notify content script
        if (currentService && SERVICE_CONFIG[currentService].manualStopAction) {
            chrome.tabs.sendMessage(activeTabId, { action: SERVICE_CONFIG[currentService].manualStopAction }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("⚠️ Could not notify content script:", chrome.runtime.lastError.message);
                }
            });
        }

        await stopRecordingAndDownload();
        
    } catch (error) {
        console.error("❌ Stop recording failed:", error);
        document.getElementById("status").textContent = "❌ Stop failed";
        alert("Failed to stop recording: " + error.message);
        updateUIForReady();
        showPopupMessage("Failed to stop recording", "error");
    }
}

async function stopRecordingAndDownload() {
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
    if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "stopRecording" }, (response) => {
            if (chrome.runtime.lastError) {
                console.log("⚠️ Recorder tab not responding:", chrome.runtime.lastError.message);
            }
        });
    } else {
        await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStoppedByTabClose']);
        isRecording = false;
        updateUIForReady();
    }
}

// ==================== MEETING STATUS ====================
async function checkMeetingStatus() {
    if (!activeTabId || !currentService) return;
    
    chrome.tabs.sendMessage(activeTabId, { action: SERVICE_CONFIG[currentService].checkMeetingAction }, (response) => {
        if (chrome.runtime.lastError) {
            console.log("⚠️ Could not check meeting status:", chrome.runtime.lastError.message);
        } else if (response) {
            updateMeetingStatusUI(response.isInMeeting, response.recording);
        }
    });
}

function updateMeetingStatusUI(isInMeeting, isRecordingFlag) {
    const statusElement = document.getElementById("status");
    const serviceName = SERVICE_CONFIG[currentService]?.name || 'Meeting';

    if (isInMeeting) {
        if (isRecordingFlag) {
            statusElement.textContent = `🟢 In ${serviceName} - Recording...`;
            statusElement.style.color = "#4CAF50";
        } else {
            statusElement.textContent = `🟡 In ${serviceName} - Ready to Record`;
            statusElement.style.color = "#FF9800";
        }
    } else {
        statusElement.textContent = `⚪ Not in ${serviceName}`;
        statusElement.style.color = "#9E9E9E";
    }
}

// ==================== UTILITY FUNCTIONS ====================
function handlePopupFocus() {
    if (activeTabId && currentService) {
        checkMeetingStatus();
    }
}

function startUISyncChecker() {
    setInterval(async () => {
        if (isRecording) {
            const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") });
            if (tabs.length === 0) {
                console.log("🔄 UI Sync: No recorder tabs but recording flag true - resetting");
                isRecording = false;
                updateUIForReady();
                await chrome.storage.local.set({ isRecording: false });
            }
        }
    }, 3000);
}

async function closeAllRecorderTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length === 0) {
                resolve();
                return;
            }
            
            let closedCount = 0;
            tabs.forEach(tab => {
                chrome.tabs.remove(tab.id, () => {
                    closedCount++;
                    if (closedCount === tabs.length) {
                        resolve();
                    }
                });
            });
        });
    });
}

function showPopupMessage(message, type = "info") {
    const existingMessage = document.getElementById('popup-message');
    if (existingMessage) existingMessage.remove();

    const messageDiv = document.createElement('div');
    messageDiv.id = 'popup-message';
    messageDiv.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        font-weight: bold;
        z-index: 1000;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) messageDiv.parentNode.removeChild(messageDiv);
    }, 3000);
}

function setupTooltips() {
    const toggleContainer = document.querySelector('.permission-toggle');
    toggleContainer.title = "Automatically start/stop recording when join/leave meetings";
    document.getElementById('startBtn').title = "Manually start recording current meeting";
    document.getElementById('stopBtn').title = "Stop recording and download the video";
}

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        switch (message.action) {
            case "timerUpdate":
                document.getElementById("timer").textContent = message.time;
                break;
                
            case "recordingStarted":
                isRecording = true;
                updateUIForRecording("00:00");
                showPopupMessage("Recording started! 🎬", "success");
                break;
                
            case "recordingStopped":
            case "recordingCompleted":
                isRecording = false;
                updateUIForReady();
                showPopupMessage("Recording completed! ✅ Downloaded automatically", "success");
                setTimeout(closeAllRecorderTabs, 1000);
                break;
                
            case "autoStopRecording":
                stopRecordingAndDownload();
                break;
                
            case "recorderFailed":
                console.error("❌ Recorder reported failure:", message.error);
                isRecording = false;
                updateStatus("❌ Recording Failed: " + message.error, "error");
                updateUIForReady();
                break;
        }
        
        sendResponse({ success: true });
    } catch (error) {
        console.error("❌ Error handling message:", error);
        sendResponse({ success: false, error: error.message });
    }
    
    return true;
});

// Storage change listener for auto record permission
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.autoRecordPermission) {
        autoRecordEnabled = changes.autoRecordPermission.newValue;
        updateToggleUI();
        updateButtonStates();
    }
});
