// COMBINED BACKGROUND.JS - Google Meet & Microsoft Teams
let userPermissionGranted = false;
let currentRecordingTab = null;
let isAutoRecording = false;
let autoStartTimeout = null;

// Service configuration
const SERVICE_CONFIG = {
    gmeet: {
        name: 'Google Meet',
        domains: ['meet.google.com/*'],
        tabQuery: { url: ["https://*.meet.google.com/*"] }
    },
    teams: {
        name: 'Microsoft Teams', 
        domains: ['teams.microsoft.com/*', 'teams.live.com/*'],
        tabQuery: { url: ["https://*.teams.microsoft.com/*", "https://*.teams.live.com/*"] }
    }
};

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
    userPermissionGranted = result.autoRecordPermission || false;
    console.log("🔐 Auto record permission:", userPermissionGranted);
});

// ==================== TAB MANAGEMENT ====================

// Listen for tab updates to detect meeting pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
        const service = detectServiceFromUrl(tab.url);
        if (service) {
            console.log(`✅ ${SERVICE_CONFIG[service].name} tab detected:`, tabId, tab.url);
            
            // Check if user has given permission for auto recording
            if (userPermissionGranted) {
                console.log(`🎬 Auto recording enabled for ${SERVICE_CONFIG[service].name} - Waiting for meeting detection...`);
                
                // Wait for content script to initialize
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { action: "checkMeetingStatus" }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log(`⚠️ ${SERVICE_CONFIG[service].name} content script not ready yet`);
                            return;
                        }
                        
                        if (response && response.isInMeeting && !response.recording) {
                            console.log(`✅ Meeting already in progress - starting auto recording for ${SERVICE_CONFIG[service].name}`);
                            startRecordingForTab(tabId, service);
                        }
                    });
                }, 3000);
            }
        }
    }
});

function detectServiceFromUrl(url) {
    for (const [service, config] of Object.entries(SERVICE_CONFIG)) {
        if (config.domains.some(domain => {
            const pattern = domain.replace('*', '.*');
            return new RegExp(pattern).test(url);
        })) {
            return service;
        }
    }
    return null;
}

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📨 Background received:", message.action, "from service:", message.service);
    
    const handleAsync = async () => {
        try {
            switch (message.action) {
                case "manualStartRecording":
                    await handleManualStartRecording(message, sender);
                    sendResponse({ success: true });
                    break;
    
                case "manualStopRecording":
                    await handleManualStopRecording(message, sender);
                    sendResponse({ success: true });
                    break;

                case "grantAutoRecordPermission":
                    await handleGrantPermission();
                    sendResponse({ success: true });
                    break;
                    
                case "revokeAutoRecordPermission":
                    await handleRevokePermission();
                    sendResponse({ success: true });
                    break;
                    
                case "getBackgroundState":
                    sendResponse({
                        currentRecordingTab: currentRecordingTab,
                        isAutoRecording: isAutoRecording,
                        userPermissionGranted: userPermissionGranted
                    });
                    break;
                    
                case "refreshExtensionState":
                    await handleRefreshState();
                    sendResponse({ success: true });
                    break;
                    
                case "autoStartRecording":
                    await handleAutoStartRecording(message, sender);
                    sendResponse({ success: true });
                    break;
                    
                case "autoStopRecording":
                    await handleAutoStopRecording(message, sender);
                    sendResponse({ success: true });
                    break;
                    
                case "recordingCompleted":
                    await handleRecordingCompleted(message, sender);
                    sendResponse({ success: true });
                    break;
                    
                case "checkMeetingStatus":
                    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
                    break;
                    
                case "closeRecorderTab":
                    await closeAllRecorderTabs();
                    sendResponse({ success: true });
                    break;
                    
                case "stopRecordingOnMeetingEnd":
                    await stopRecordingOnMeetingEnd();
                    sendResponse({ success: true });
                    break;
                    
                case "showStatus":
                case "updateMeetTimer":
                    await handleStatusMessage(message, sender);
                    sendResponse({ success: true });
                    break;
                    
                case "recordingStarted":
                    await handleRecordingStarted(sender);
                    sendResponse({ success: true });
                    break;
                    
                case "recordingStopped":
                    await handleRecordingStopped();
                    sendResponse({ success: true });
                    break;
                    
                case "timerUpdate":
                    chrome.storage.local.set({ recordingTime: message.time });
                    sendResponse({ success: true });
                    break;
                    
                case "getAutoRecordPermission":
                    sendResponse({ permission: userPermissionGranted });
                    break;

                
                    
                default:
                    sendResponse({ success: false, reason: "unknown_action" });
            }
        } catch (error) {
            console.error("❌ Error handling message:", error);
            sendResponse({ success: false, error: error.message });
        }
    };

    handleAsync();
    return true;
});

// ==================== PERMISSION HANDLERS ====================

async function handleManualStartRecording(message, sender) {
    const service = message.service || detectServiceFromUrl(sender.tab?.url);
    console.log(`🎬 Manual recording start for ${service}`);
    
    if (!sender.tab?.id) {
        console.log("❌ No sender tab ID for manual recording");
        return;
    }
    
    await startRecordingForTab(sender.tab.id, service);
}

async function handleManualStopRecording(message, sender) {
    console.log("🛑 Manual recording stop requested");
    await stopAllRecordings();
}

async function handleGrantPermission() {
    console.log("✅ User granted auto recording permission");
    userPermissionGranted = true;
    await chrome.storage.local.set({ autoRecordPermission: true });
    await notifyAllTabsAboutPermission(true);
}

async function handleRevokePermission() {
    console.log("❌ User revoked auto recording permission");
    userPermissionGranted = false;
    await chrome.storage.local.set({ autoRecordPermission: false });
    await notifyAllTabsAboutPermission(false);
}

async function notifyAllTabsAboutPermission(enabled) {
    for (const [service, config] of Object.entries(SERVICE_CONFIG)) {
        chrome.tabs.query(config.tabQuery, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    action: "updateAutoRecordPermission",
                    enabled: enabled
                });
            });
        });
    }
}

// ==================== RECORDING HANDLERS ====================

async function handleAutoStartRecording(message, sender) {
    const service = message.service || detectServiceFromUrl(sender.tab?.url);
    const serviceName = SERVICE_CONFIG[service]?.name || 'Unknown';
    
    console.log(`🎬 Auto-start recording requested for ${serviceName} from tab:`, sender.tab?.id);

    // Clear any pending auto-start
    if (autoStartTimeout) {
        clearTimeout(autoStartTimeout);
        autoStartTimeout = null;
    }

    if (!sender.tab?.id) {
        console.log("❌ No sender tab ID");
        return;
    }

    if (!userPermissionGranted) {
        console.log("❌ Auto recording denied - no permission");
        return;
    }

    // Reset states before auto-start
    console.log("🔄 Resetting states before auto-start...");
    currentRecordingTab = null;
    isAutoRecording = false;

    // Clear storage to ensure clean state
    await chrome.storage.local.set({ 
        isRecording: false,
        recordingStoppedByTabClose: true 
    });

    console.log(`✅ Starting auto recording for ${serviceName} tab:`, sender.tab.id);
    currentRecordingTab = sender.tab.id;
    isAutoRecording = true;

    // Start recording with delay
    setTimeout(() => {
        startRecordingForTab(sender.tab.id, service);
    }, 2000);
}

async function handleAutoStopRecording(message, sender) {
    const service = message.service || detectServiceFromUrl(sender.tab?.url);
    const serviceName = SERVICE_CONFIG[service]?.name || 'Unknown';
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`🛑 Auto stopping recording for ${serviceName} at ${timestamp}`);
    console.log("📍 Source tab:", sender.tab?.id);
    
    await stopAllRecordings();
}

async function handleRecordingCompleted(message, sender) {
    currentRecordingTab = null;
    isAutoRecording = false;
    
    const service = message.service || detectServiceFromUrl(sender.tab?.url);
    
    // Notify all tabs of the same service
    if (service && SERVICE_CONFIG[service]) {
        chrome.tabs.query(SERVICE_CONFIG[service].tabQuery, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "recordingCompleted",
                    service: service
                });
            });
        });
    }

    setTimeout(() => {
        closeAllRecorderTabs();
    }, 1000);
}

async function handleRecordingStarted(sender) {
    const timestamp = new Date().toLocaleTimeString();
    const service = detectServiceFromUrl(sender.tab?.url);
    const serviceName = SERVICE_CONFIG[service]?.name || 'Unknown';
    
    console.log(`✅ Recording started successfully for ${serviceName} at ${timestamp}`);
    console.log("📊 Recording tab:", sender.tab.id);
    currentRecordingTab = sender.tab.id;
    
    // Update storage
    await chrome.storage.local.set({ 
        isRecording: true,
        recordingStartTime: Date.now(),
        recordingTabId: sender.tab.id
    });
}

async function handleRecordingStopped() {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`✅ Recording stopped successfully at ${timestamp}`);
    currentRecordingTab = null;
    isAutoRecording = false;
    
    // Update storage
    await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
}

async function handleStatusMessage(message, sender) {
    const service = detectServiceFromUrl(sender.tab?.url);
    if (service && SERVICE_CONFIG[service]) {
        chrome.tabs.query(SERVICE_CONFIG[service].tabQuery, (tabs) => {
            tabs.forEach(tab => {
                if (tab.id !== sender.tab?.id) {
                    chrome.tabs.sendMessage(tab.id, message);
                }
            });
        });
    }
}

async function handleRefreshState() {
    console.log("🔄 Refreshing extension state in background");
    await closeAllRecorderTabs();
    currentRecordingTab = null;
    isAutoRecording = false;
    
    if (autoStartTimeout) {
        clearTimeout(autoStartTimeout);
        autoStartTimeout = null;
    }
}

// ==================== RECORDING MANAGEMENT ====================

function startRecordingForTab(tabId, service) {
    if (currentRecordingTab) {
        console.log("⚠️ Already recording in tab:", currentRecordingTab);
        return;
    }

    const serviceName = SERVICE_CONFIG[service]?.name || 'Unknown';
    console.log(`🎬 Starting recording for ${serviceName} tab:`, tabId);
    
    closeAllRecorderTabs().then(() => {
    // Validate the tab exists and is the correct service
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
            console.error("❌ Source tab not found or inaccessible:", chrome.runtime.lastError);
            currentRecordingTab = null;
            isAutoRecording = false;
            return;
        }
        
        const tabService = detectServiceFromUrl(tab.url);
        if (!tabService || tabService !== service) {
            console.error(`❌ Source tab is not a ${serviceName} tab:`, tab.url);
            currentRecordingTab = null;
            isAutoRecording = false;
            return;
        }
        
        // Create a new tab for recording
        chrome.tabs.create({
            url: chrome.runtime.getURL("recorder.html"),
            active: false
        }, (recorderTab) => {
            console.log("✅ Recorder tab opened:", recorderTab.id);
            
            const attemptStart = (retryCount = 0) => {
                chrome.tabs.sendMessage(recorderTab.id, { 
                    action: "startRecording", 
                    tabId: tabId,
                    autoRecord: true,
                    service: service
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log(`❌ Recorder tab not ready (attempt ${retryCount + 1}/3), retrying...`);
                        if (retryCount < 2) {
                            setTimeout(() => attemptStart(retryCount + 1), 1000);
                        } else {
                            console.error("❌ Failed to start recording after 3 attempts");
                            // Clean up the recorder tab if failed
                            chrome.tabs.remove(recorderTab.id);
                            currentRecordingTab = null;
                            isAutoRecording = false;
                        }
                    } else {
                        console.log(`✅ ${serviceName} recording started successfully`);
                        currentRecordingTab = tabId;
                        isAutoRecording = true;
                    }
                });
            };
            
            setTimeout(() => attemptStart(), 1500);
        });
    });
    });
}

async function stopAllRecordings() {
    console.log("🛑 Stopping all recordings");
    
    // Find and stop all recorder tabs
    chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
        if (tabs.length > 0) {
            console.log(`🛑 Stopping ${tabs.length} recorder tab(s)`);
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
            });
        } else {
            console.log("⚠️ No recorder tabs found");
        }
    });
    
    currentRecordingTab = null;
    isAutoRecording = false;
    
    // Clear storage
    await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
}

async function stopRecordingOnMeetingEnd() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length > 0) {
                let completed = 0;
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { 
                        action: "stopRecording",
                        forceAutoDownload: true 
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log("⚠️ Recorder tab not responding");
                        } else {
                            console.log("✅ Auto-download command sent");
                        }
                        completed++;
                        if (completed === tabs.length) {
                            currentRecordingTab = null;
                            isAutoRecording = false;
                            resolve();
                        }
                    });
                });
            } else {
                console.log("⚠️ No recorder tabs found");
                currentRecordingTab = null;
                isAutoRecording = false;
                resolve();
            }
        });
    });
}

// ==================== UTILITY FUNCTIONS ====================

function closeAllRecorderTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
            if (tabs.length === 0) {
                console.log("✅ No recorder tabs found to close");
                resolve();
                return;
            }
            
            let closedCount = 0;
            tabs.forEach(tab => {
                chrome.tabs.remove(tab.id, () => {
                    closedCount++;
                    console.log(`✅ Closed recorder tab: ${tab.id}`);
                    
                    if (closedCount === tabs.length) {
                        console.log("✅ All recorder tabs closed");
                        resolve();
                    }
                });
            });
        });
    });
}

// ==================== TAB MONITORING ====================

// Monitor tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentRecordingTab) {
        console.log("🛑 Recording source tab closed - stopping recording");
        stopAllRecordings();
    }
    
    // Also check if it's a recorder tab
    chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        
        if (tab.url && tab.url.includes("recorder.html")) {
            console.log("🛑 Recorder tab closed - cleaning up");
            chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
            currentRecordingTab = null;
            isAutoRecording = false;
        }
    });
});

// ==================== EXTENSION LIFECYCLE ====================

// Handle extension installation or update
chrome.runtime.onInstalled.addListener((details) => {
    console.log("🔧 Extension installed/updated:", details.reason);
    
    if (details.reason === 'install') {
        // Set default permissions
        chrome.storage.local.set({ autoRecordPermission: false });
        console.log("🔐 Auto recording disabled by default");
    }
});

// Keep service worker alive during recordings
setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
        if (currentRecordingTab) {
            // Log keep-alive every 30 seconds during recording
            if (Math.floor(Date.now() / 1000) % 30 === 0) {
                console.log("💓 Service worker keep-alive (Recording active)");
            }
        }
    });
}, 10000);

console.log("🔧 Universal Background script loaded successfully");
console.log("📋 Supported services: Google Meet & Microsoft Teams");
