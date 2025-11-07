// COMBINED CONTENT.JS - Google Meet & Microsoft Teams
let isInMeeting = false;
let recordingStarted = false;
let autoRecordEnabled = false;
let currentService = null;

// Meeting Detection + Timer + Duration (GMeet specific)
let timerEl = null;
let timerInterval = null;
let recordStartTime = null;
let meetingStarted = false;
let meetingStartTime = null;
let meetingEndTime = null;
let totalMeetingDuration = 0;

// Teams specific variables
let joinButtonObserver = null;
let lastLeaveButtonVisible = false;
let leaveButtonObserver = null;

// Service detection
function detectService() {
    const url = window.location.href;
    if (url.includes('meet.google.com')) return 'gmeet';
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
    return null;
}

// Initialize based on service
function initializeService() {
    currentService = detectService();
    console.log(`🔍 Detected service: ${currentService}`);
    
    if (currentService === 'gmeet') {
        initializeGMeet();
    } else if (currentService === 'teams') {
        initializeTeams();
    }
}

// ==================== COMMON FUNCTIONS ====================

async function checkAutoRecordPermission() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['autoRecordPermission'], (result) => {
            autoRecordEnabled = result.autoRecordPermission || false;
            console.log(`🔐 Auto record enabled for ${currentService}:`, autoRecordEnabled);
            resolve(autoRecordEnabled);
        });
    });
}

function showStatusNotification(message, duration = 4000) {
    const existing = document.getElementById('meeting-recorder-status');
    if (existing) existing.remove();

    const status = document.createElement('div');
    status.id = 'meeting-recorder-status';
    status.innerHTML = message.replace(/\n/g, '<br>');
    
    const styles = {
        gmeet: `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0,0,0,0.95);
            color: white;
            padding: 12px 16px;
            border-radius: 10px;
            font-family: 'Google Sans', Arial, sans-serif;
            font-size: 14px;
            z-index: 100000;
            font-weight: bold;
            border: 2px solid #4285f4;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
            max-width: 400px;
            word-wrap: break-word;
        `,
        teams: `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #464EB8;
            color: white;
            padding: 12px 18px;
            border-radius: 8px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            border: 2px solid #2B3178;
        `
    };

    status.style.cssText = styles[currentService] || styles.teams;
    document.body.appendChild(status);

    if (!message.includes("Recording...")) {
        setTimeout(() => {
            const currentStatus = document.getElementById('meeting-recorder-status');
            if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                currentStatus.remove();
            }
        }, duration);
    }
}

function startAutoRecording() {
    if (recordingStarted) {
        console.log("⚠️ Auto recording already started, skipping");
        return;
    }
    
    console.log(`🚀 Starting auto recording for ${currentService}...`);
    
    chrome.runtime.sendMessage({ 
        action: "autoStartRecording",
        service: currentService
    }, (response) => {
        if (response && response.success) {
            recordingStarted = true;
            chrome.storage.local.set({ isRecording: true });
            showStatusNotification(`🔴 Recording started for ${currentService}`);
        } else {
            console.log("❌ Failed to start auto recording:", response);
            recordingStarted = false;
            showStatusNotification("❌ Auto Recording Failed");
        }
    });
}

function stopAutoRecording() {
    if (!recordingStarted) return;
    
    console.log(`🛑 Stopping auto recording for ${currentService}...`);
    recordingStarted = false;

    chrome.runtime.sendMessage({ 
        action: "autoStopRecording",
        service: currentService
    }, (response) => {
        if (response && response.success) {
            showStatusNotification(`⏹️ Recording stopped for ${currentService}`);
        } else {
            console.log("❌ Failed to stop auto recording");
        }
    });
}

// ==================== GOOGLE MEET FUNCTIONS ====================

function initializeGMeet() {
    console.log("🔍 Initializing Google Meet detection...");
    
    // GMeet specific setup
    setupGMeetLeaveButtonObserver();
    setInterval(checkGMeetMeetingState, 2000);
    
    // Check initial state
    setTimeout(() => {
        checkGMeetMeetingState();
        aggressiveInitialCheck();
    }, 1000);
}

function findGMeetLeaveButton() {
    const selectors = [
        'button[aria-label="Leave call"]',
        'button[aria-label*="Leave call"]',
        'div[role="button"][data-tooltip="Leave call"]',
        'div[role="button"][aria-label*="Leave"]',
        'button[jscontroller][jsname][aria-label*="Leave"]',
    ];
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
    }
    return null;
}

function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           rect.width > 0 &&
           rect.height > 0 &&
           element.offsetParent !== null;
}

function checkGMeetMeetingState() {
    const leaveButton = findGMeetLeaveButton();
    const leaveVisible = leaveButton && isElementVisible(leaveButton);

    // Meeting joined
    if (leaveVisible && !lastLeaveButtonVisible) {
        console.log("✅ Leave button visible - Meeting joined");
        isInMeeting = true;
        meetingStarted = true;
        startGMeetMeetingTimer();

        const startTime = new Date(meetingStartTime).toLocaleTimeString();
        
        // Auto recording with proper delay
        if (autoRecordEnabled && !recordingStarted) {
            console.log("🔄 Auto-record enabled - starting recording in 3 seconds...");
            showStatusNotification(`📅 Meeting started at: ${startTime}\n🟡 Auto recording starting in 3 seconds...`);
            
            setTimeout(() => {
                if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                    startAutoRecording();
                }
            }, 3000);
        } else {
            showStatusNotification(`📅 Meeting started at: ${startTime}`, 5000);
        }
    }

    // Meeting ended
    if (!leaveVisible && lastLeaveButtonVisible) {
        console.log("❌ Leave button hidden - Meeting ended");
        isInMeeting = false;
        meetingStarted = false;
        stopGMeetMeetingTimer();
        
        chrome.storage.local.get(['isRecording'], (result) => {
            if (result.isRecording) {
                console.log("🛑 Meeting ended - stopping recording");
                stopAutoRecording();
            }
        });
    }

    lastLeaveButtonVisible = leaveVisible;
    chrome.storage.local.set({ isInMeeting });
}

function startGMeetMeetingTimer() {
    meetingStartTime = Date.now();
    const startTime = new Date(meetingStartTime).toLocaleTimeString();
    console.log(`%c📅 Meeting started at: ${startTime}`,"color: #0f9d58; font-weight: bold;");
    showStatusNotification(`📅 Meeting started at: ${startTime}`, 5000);
}

function stopGMeetMeetingTimer() {
    if (meetingStartTime) {
        meetingEndTime = Date.now();
        totalMeetingDuration = Math.floor((meetingEndTime - meetingStartTime) / 1000);
        
        const minutes = Math.floor(totalMeetingDuration / 60);
        const seconds = totalMeetingDuration % 60;
        const endTime = new Date(meetingEndTime).toLocaleTimeString();

        console.log(`%c📅 Meeting ended at: ${endTime}`, "color: #d93025; font-weight: bold;");
        console.log(`%c⏱️ Duration of meeting: ${minutes}m ${seconds}s`, "color: #f4b400; font-weight: bold;");

        showStatusNotification(`📅 Meeting ended at: ${endTime}\n Duration: ${minutes}m ${seconds}s`, 5000);

        chrome.storage.local.set({
            lastMeetingDuration: totalMeetingDuration,
            lastMeetingEndTime: meetingEndTime
        });
        
        meetingStartTime = null;
        meetingEndTime = null;
    }
}

function setupGMeetLeaveButtonObserver() {
    if (leaveButtonObserver) leaveButtonObserver.disconnect();
    leaveButtonObserver = new MutationObserver(() => {
        setTimeout(checkGMeetMeetingState, 500);
    });
    leaveButtonObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-hidden', 'disabled']
    });
}

function aggressiveInitialCheck() {
    setTimeout(() => {
        console.log("🔍 Aggressive initial meeting check...");
        checkGMeetMeetingState();
        setTimeout(checkGMeetMeetingState, 2000);
    }, 1000);
}

// ==================== MICROSOFT TEAMS FUNCTIONS ====================

function initializeTeams() {
    console.log("🔍 Initializing Microsoft Teams detection...");
    setupTeamsJoinButtonObserver();
    setupTeamsJoinButtonClickHandler();
    setupTeamsLeaveButtonClickHandler();
    setupTeamsMeetingEndDetection();
    
    // Check if join button already exists
    const existingJoinButton = findTeamsJoinButton();
    if (existingJoinButton) {
        console.log("✅ Join button already present on page");
    }
    
    // Monitor URL changes
    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            console.log("🔗 URL changed, reinitializing detection...");
            setTimeout(() => {
                initializeTeams();
            }, 2000);
        }
    });
    
    urlObserver.observe(document, { subtree: true, childList: true });
}

function findTeamsJoinButton() {
    // Look for the prejoin join button
    const joinButton = document.getElementById('prejoin-join-button');
    if (joinButton) {
        console.log("🔍 Found Join button:", {
            id: joinButton.id,
            text: joinButton.textContent,
            visible: isElementVisible(joinButton)
        });
        return joinButton;
    }
    
    // Fallback selectors
    const fallbackSelectors = [
        'button[data-tid="prejoin-join-button"]',
        'button[aria-label*="Join"]',
        'button[aria-label*="join"]',
        '.join-button',
        'button[title*="Join"]',
        'button[title*="join"]'
    ];
    
    for (const selector of fallbackSelectors) {
        const button = document.querySelector(selector);
        if (button && isElementVisible(button)) {
            console.log("🔍 Found Join button with selector:", selector);
            return button;
        }
    }
    
    return null;
}

function setupTeamsJoinButtonClickHandler() {
    document.removeEventListener('click', handleTeamsJoinButtonClick, true);
    document.addEventListener('click', handleTeamsJoinButtonClick, true);
    console.log("🖱️ Teams Join button click handler activated");
}

// Add to Teams functions section
function setupTeamsMeetingEndDetection() {
    // Monitor for meeting end by checking URL changes and button states
    setInterval(() => {
        if (isInMeeting) {
            // Check if we're still in a meeting by looking for leave button
            const leaveButton = document.querySelector('[data-tid="leave-button"], [aria-label*="Leave"], [title*="Leave"]');
            if (!leaveButton || !isElementVisible(leaveButton)) {
                console.log("🛑 Teams meeting ended - leave button not found");
                teamsMeetingEnded();
            }
            
            // Also check URL for meeting end
            const currentUrl = window.location.href;
            if (currentUrl.includes('/l/meeting/') && !currentUrl.includes('meetingJoin')) {
                // Still in meeting
            } else {
                console.log("🛑 Teams meeting ended - URL changed");
                teamsMeetingEnded();
            }
        }
    }, 3000);
}

function handleTeamsJoinButtonClick(event) {
    let target = event.target;
    
    while (target && target !== document.body) {
        if (isTeamsJoinButton(target)) {
            console.log("🎯 JOIN BUTTON CLICKED - User is joining meeting");
            console.log("⏰ Starting 3-second delay before recording...");
            
            setTimeout(() => {
                teamsMeetingStarted();
            }, 3000);
            
            break;
        }
        target = target.parentElement;
    }
}

function isTeamsJoinButton(element) {
    if (!element) return false;
    
    if (element.id === 'prejoin-join-button') return true;
    if (element.getAttribute('data-tid') === 'prejoin-join-button') return true;
    
    const ariaLabel = element.getAttribute('aria-label') || '';
    const title = element.getAttribute('title') || '';
    const textContent = element.textContent || '';
    
    return (ariaLabel.toLowerCase().includes('join') && 
            !ariaLabel.toLowerCase().includes('leave')) ||
           (title.toLowerCase().includes('join') &&
            !title.toLowerCase().includes('leave')) ||
           textContent.toLowerCase().includes('join now') ||
           textContent.trim() === 'Join now';
}

function setupTeamsLeaveButtonClickHandler() {
    document.removeEventListener('click', handleTeamsLeaveButtonClick, true);
    document.addEventListener('click', handleTeamsLeaveButtonClick, true);
    console.log("🖱️ Teams Leave button click handler activated");
}

function handleTeamsLeaveButtonClick(event) {
    let target = event.target;
    
    while (target && target !== document.body) {
        if (isTeamsLeaveButton(target)) {
            console.log("🛑 LEAVE BUTTON CLICKED - Meeting ended by user");
            teamsMeetingEnded();
            break;
        }
        target = target.parentElement;
    }
}

function isTeamsLeaveButton(element) {
    if (!element) return false;
    
    if (element.id === 'hangup-button') return true;
    
    const ariaLabel = element.getAttribute('aria-label') || '';
    const title = element.getAttribute('title') || '';
    const dataTid = element.getAttribute('data-tid') || '';
    
    return ariaLabel.toLowerCase().includes('leave') ||
           ariaLabel.toLowerCase().includes('hang up') ||
           title.toLowerCase().includes('leave') ||
           title.toLowerCase().includes('hang up') ||
           dataTid.includes('hangup') ||
           element.classList.contains('hangup-button');
}

function teamsMeetingStarted() {
    if (isInMeeting) return;
    
    const startTime = new Date().toLocaleTimeString();
    console.log(`🎯 TEAMS MEETING STARTED - 3-second delay completed at ${startTime}`);
    isInMeeting = true;
    
    // Start auto recording if enabled
    if (autoRecordEnabled && !recordingStarted) {
        console.log("🎬 AUTO RECORDING - Starting recording after delay");
        startAutoRecording();
    } else {
        console.log("ℹ️ Auto recording not enabled or already recording");
    }
    
    showStatusNotification(`🎯 Meeting Started - ${startTime}`);
    chrome.storage.local.set({ isInMeeting: isInMeeting });
}

function teamsMeetingEnded() {
    if (!isInMeeting) return;
    
    const endTime = new Date().toLocaleTimeString();
    console.log(`🎯 TEAMS MEETING ENDED - Leave button was clicked at ${endTime}`);
    isInMeeting = false;
    
    // Stop recording if active
    if (recordingStarted) {
        console.log("⏹️ AUTO STOPPING - Stopping recording due to meeting end");
        stopAutoRecording();
    }
    
    showStatusNotification(`⏹️ Meeting Ended - ${endTime}`);
    chrome.storage.local.set({ isInMeeting: isInMeeting });
}

function setupTeamsJoinButtonObserver() {
    if (joinButtonObserver) {
        joinButtonObserver.disconnect();
    }

    joinButtonObserver = new MutationObserver((mutations) => {
        let joinButtonAppeared = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && (
                        node.id === 'prejoin-join-button' || 
                        node.getAttribute('data-tid') === 'prejoin-join-button' ||
                        (node.getAttribute('aria-label') && node.getAttribute('aria-label').toLowerCase().includes('join'))
                    )) {
                        console.log("➕ Join button added to DOM");
                        joinButtonAppeared = true;
                    }
                });
            }
            
            if (mutation.type === 'attributes' && 
                (mutation.target.id === 'prejoin-join-button' || 
                 mutation.target.getAttribute('data-tid') === 'prejoin-join-button' ||
                 (mutation.target.getAttribute('aria-label') && mutation.target.getAttribute('aria-label').toLowerCase().includes('join')))) {
                console.log("⚡ Join button attribute changed:", mutation.attributeName);
                joinButtonAppeared = true;
            }
        });
        
        if (joinButtonAppeared) {
            console.log("🔍 Join button state changed, setting up click handler...");
            setTimeout(() => {
                setupTeamsJoinButtonClickHandler();
                setupTeamsLeaveButtonClickHandler();
            }, 500);
        }
    });

    joinButtonObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-hidden', 'disabled', 'id', 'data-tid', 'aria-label', 'title']
    });
}

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(`📨 ${currentService} content script received:`, message.action);
    
    if (message.action === "manualRecordingStarted") {
        console.log("🎬 Manual recording started via content script");
        // Notify background to start recording
        chrome.runtime.sendMessage({ 
            action: "manualStartRecording",
            service: currentService 
        });
        sendResponse({ success: true });
    }
    
    if (message.action === "manualRecordingStopped") {
        console.log("🛑 Manual recording stopped via content script");
        // Notify background to stop recording  
        chrome.runtime.sendMessage({ 
            action: "manualStopRecording",
            service: currentService 
        });
        sendResponse({ success: true });
    }
    
    if (message.action === "updateAutoRecordPermission") {
        autoRecordEnabled = message.enabled;
        console.log("🔐 Auto record permission updated:", autoRecordEnabled);
        
        if (autoRecordEnabled && isInMeeting && !recordingStarted) {
            console.log("🔄 Auto record enabled while in meeting - starting recording");
            setTimeout(startAutoRecording, 2000);
        }
        sendResponse({ success: true });
    }

    if (message.action === "checkMeetingStatus") {
        const response = { 
            isInMeeting, 
            recording: recordingStarted, 
            autoRecordEnabled,
            service: currentService
        };
        
        // Add service-specific data
        if (currentService === 'gmeet') {
            response.meetingDuration = getCurrentMeetingDuration();
        }
        
        sendResponse(response);
    }

    if (message.action === "autoStopRecording") {
        stopAutoRecording();
        sendResponse({ success: true });
    }

    if (message.action === "showStatus") {
        const duration = message.duration || 4000;
        showStatusNotification(message.message, duration);
        sendResponse({ success: true });
    }
    
    if (message.action === "recordingCompleted") {
        recordingStarted = false;
        showStatusNotification("✅ Recording Completed & Downloaded");
        sendResponse({ success: true });
    }

    return true;
});

// GMeet duration helper
function getCurrentMeetingDuration() {
    if (meetingStartTime) {
        const currentDuration = Math.floor((Date.now() - meetingStartTime) / 1000);
        const minutes = Math.floor(currentDuration / 60);
        const seconds = currentDuration % 60;
        return `${minutes}m ${seconds}s`;
    }
    return "0m 0s";
}

// ==================== INITIALIZATION ====================

// Initialize when script loads
setTimeout(async () => {
    await checkAutoRecordPermission();
    initializeService();
    console.log(`🔍 ${currentService} Auto Recorder content script fully loaded`);
}, 1000);
