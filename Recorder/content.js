
// UNIFIED CONTENT.JS - Google Meet, Microsoft Teams & Zoom

(function() {
    'use strict';

    // Service detection
    function detectService() {
        const url = window.location.href;
        if (url.includes('meet.google.com')) return 'gmeet';
        if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
        if (url.includes('zoom.us') || url.includes('zoom.com')) return 'zoom'; 
        return null;
    }

    const currentService = detectService();

    // Initialize based on service
    if (currentService === 'gmeet') {
        gmeetContent();
    } else if (currentService === 'teams') {
        teamsContent();
    } else if (currentService === 'zoom') {
        zoomContent();
    }

    // ==================== GOOGLE MEET ====================
    function gmeetContent() {
        console.log("🔍 Initializing Google Meet content script");

        let isInMeeting = false;
        let recordingStarted = false;
        let autoRecordEnabled = false;
        let leaveButtonObserver = null;
        let lastLeaveButtonVisible = false;

        // Meeting Detection + Timer + Duration        
        let meetingStarted = false;
        let meetingStartTime = null;
        let meetingEndTime = null;
        let totalMeetingDuration = 0;

        function showMeetStatus(message, duration = 4000) {
            const existing = document.getElementById('meet-recorder-status');
            
            if (existing && message.includes("Recording...")) {
                existing.innerHTML = message.replace(/\n/g, '<br>');
                return;
            }
            
            if (existing) existing.remove();
            
            const status = document.createElement('div');
            status.id = 'meet-recorder-status';
            status.innerHTML = message.replace(/\n/g, '<br>');
            status.style.cssText = `
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
            `;
            
            document.body.appendChild(status);

            if (!message.includes("Recording...")) {
                setTimeout(() => {
                    const currentStatus = document.getElementById('meet-recorder-status');
                    if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                        currentStatus.remove();
                    }
                }, duration);
            }
        }

        function startMeetingTimer() {
            meetingStartTime = Date.now();
            const startTime = new Date(meetingStartTime).toLocaleTimeString();
            console.log(`%c📅 Meeting started at : ${startTime}`,"color: #0f9d58; font-weight: bold;");
            showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
        }

        function stopMeetingTimer() {
            if (meetingStartTime) {
                meetingEndTime = Date.now();
                totalMeetingDuration = Math.floor((meetingEndTime - meetingStartTime) / 1000);
                
                const minutes = Math.floor(totalMeetingDuration / 60);
                const seconds = totalMeetingDuration % 60;
                const endTime = new Date(meetingEndTime).toLocaleTimeString();

                console.log(`%c📅 Meeting ended at : ${new Date(meetingEndTime).toLocaleTimeString()}`, "color: #d93025; font-weight: bold;");
                console.log(`%c⏱️ Duration of meeting : ${minutes}m ${seconds}s`, "color: #f4b400; font-weight: bold;");

                showMeetStatus(`📅 Meeting ended at : ${endTime}\n Duration: ${minutes}m ${seconds}s`, 5000);

                chrome.storage.local.set({
                    lastMeetingDuration: totalMeetingDuration,
                    lastMeetingEndTime: meetingEndTime
                });
                
                meetingStartTime = null;
                meetingEndTime = null;
            }
        }

        function getCurrentMeetingDuration() {
            if (meetingStartTime) {
                const currentDuration = Math.floor((Date.now() - meetingStartTime) / 1000);
                const minutes = Math.floor(currentDuration / 60);
                const seconds = currentDuration % 60;
                return `${minutes}m ${seconds}s`;
            }
            return "0m 0s";
        }

        function isMeetingActive() {
            return document.querySelector('[aria-label^="Leave call"], [aria-label^="Leave meeting"]');
        }

        async function initializeAutoRecord() {
            await checkAutoRecordPermission();
        
            // If auto-record is enabled, immediately check if we're in a meeting
            if (autoRecordEnabled) {
                console.log("🔄 Auto-record enabled - checking current meeting state");
                setTimeout(() => {
                    checkMeetingState();
                    // Force a re-check after a delay to catch any late-loading meetings
                    setTimeout(() => {
                        checkMeetingState();
                        // If we're in a meeting and auto-record is enabled, start recording
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            console.log("🚀 Auto-record enabled and in meeting - starting recording");
                            startAutoRecording();
                        }
                    }, 3000);
                }, 1000);
            }
        }

        async function checkAutoRecordPermission() {
            return new Promise((resolve) => {
                chrome.storage.local.get(['autoRecordPermissions'], (result) => {
                    autoRecordEnabled = result.autoRecordPermissions?.['gmeet'] || false;
                    console.log(`🔐 Auto record enabled for gmeet:`, autoRecordEnabled);
                    resolve(autoRecordEnabled);
                });
            });
        }
        
        function startAutoRecordingImmediately() {
            if (isInMeeting && autoRecordEnabled) {
                console.log("🚀 Auto-record toggled ON mid-meeting - starting recording immediately");
                showMeetStatus("🟡 Auto recording starting now...");
                // Force reset recording state to ensure fresh start
                recordingStarted = false;
        
                // Clear any existing recording timeouts
                if (window.autoRecordTimeout) {
                    clearTimeout(window.autoRecordTimeout);
                    window.autoRecordTimeout = null;
                }
                startAutoRecording();
            }
        }

        function findLeaveButton() {
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

        function checkMeetingState() {

            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);

            if (leaveVisible && !lastLeaveButtonVisible) {
                console.log("✅ Leave button visible - Meeting joined");
                isInMeeting = true;
                meetingStarted = true;
                startMeetingTimer();

                const startTime = new Date(meetingStartTime).toLocaleTimeString();
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🔄 Auto-record enabled - starting recording in 3 seconds...");
                    showMeetStatus(`📅 Meeting started at: ${startTime}\n🟡 Auto recording starting in 3 seconds...`);

                    // Clear any existing timeout
                    if (window.autoRecordTimeout) {
                        clearTimeout(window.autoRecordTimeout);
                    }
                    
                    window.autoRecordTimeout = setTimeout(async () => {
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            await startAutoRecording();
                        }
                    }, 3000);
                } else {
                    showMeetStatus(`📅 Meeting started at: ${startTime}`, 5000);
                }
            }

            if (!leaveVisible && lastLeaveButtonVisible) {
                console.log("❌ Leave button hidden - Meeting ended");
                isInMeeting = false;
                meetingStarted = false;
                stopMeetingTimer();
                
                // Clear auto-record timeout if meeting ended
                if (window.autoRecordTimeout) {
                    clearTimeout(window.autoRecordTimeout);
                    window.autoRecordTimeout = null;
                }
        
                if (recordingStarted) {
                    console.log("🛑 Meeting ended - stopping recording");
                    chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
                }
            }

            lastLeaveButtonVisible = leaveVisible;
            chrome.storage.local.set({ isInMeeting });
        }

        function forceMeetingRedetection() {
            console.log("🔍 Force re-detecting meeting state...");
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);
            
            if (leaveVisible && !isInMeeting) {
                console.log("✅ Force detected: In meeting");
                isInMeeting = true;
                meetingStarted = true;
                if (!meetingStartTime) {
                    startMeetingTimer();
                }
                return true;
            } else if (!leaveVisible && isInMeeting) {
                console.log("✅ Force detected: Not in meeting");
                isInMeeting = false;
                meetingStarted = false;
                return false;
            }
            return isInMeeting;
        }

        function aggressiveInitialCheck() {
            setTimeout(() => {
                console.log("🔍 Aggressive initial meeting check...");
                checkMeetingState();
                setTimeout(() => {
                    if (!isInMeeting) {
                        checkMeetingState();
                    }
                }, 2000);
            }, 1000);
        }

        async function startAutoRecording() {
            if (recordingStarted) {
                console.log("⚠️ Auto recording already started, skipping");
                return;
            }
            
            console.log("🚀 Starting auto recording...");

            chrome.storage.local.set({ isRecording: false });

            
            try {
                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: "autoStartRecording" }, resolve);
                });
                
                if (response?.success) {
                    recordingStarted = true;            
                    chrome.storage.local.set({ isRecording: true });

                } else {
                    console.log("❌ Failed to start auto recording:", response);
                    recordingStarted = false;
                    showMeetStatus("❌ Auto Recording Failed");
                    // Retry after 3 seconds if failed
                    setTimeout(() => {
                        if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                            console.log("🔄 Retrying auto recording...");
                            startAutoRecording();
                        }
                    }, 3000);
                }
            } catch (error) {
                console.log("❌ Error starting auto recording:", error);
                recordingStarted = false;
                showMeetStatus("❌ Auto Recording Error");
            }
        }

        async function initializeWithStateRecovery() {
            await checkAutoRecordPermission();
            setupLeaveButtonObserver();
            
            const storageState = await new Promise(resolve => {
                chrome.storage.local.get(['isRecording', 'isInMeeting'], resolve);
            });
            
            console.log("🔄 State recovery check:", storageState);
            
            if (storageState.isInMeeting && !isInMeeting) {
                console.log("🔄 Recovering meeting state from storage");
                forceMeetingRedetection();
            }
            
            if (storageState.isRecording && !recordingStarted) {
                console.log("🔄 Resetting inconsistent recording state");
                chrome.storage.local.set({ isRecording: false });
            }
            
            checkInitialMeetingState();
            setInterval(checkMeetingState, 2000);
            aggressiveInitialCheck();
        }

        function stopAutoRecording() {
            if (!recordingStarted) return;
            recordingStarted = false;

            chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
                if (response?.success) {
                    console.log("✅ Auto recording stopped");
                    if (autoRecordEnabled) {
                        chrome.runtime.sendMessage({ action: "closeRecorderTab" });
                    }
                } else {
                    console.log("❌ Failed to stop auto recording");
                }
            });
        }

        function setupLeaveButtonObserver() {
            if (leaveButtonObserver) leaveButtonObserver.disconnect();
            leaveButtonObserver = new MutationObserver(() => {
                setTimeout(checkMeetingState, 500);
            });
            leaveButtonObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'aria-hidden', 'disabled']
            });
        }

        function checkInitialMeetingState() {
            const leaveButton = findLeaveButton();
            const leaveVisible = leaveButton && isElementVisible(leaveButton);
            
            if (leaveVisible && !isInMeeting) {
                console.log("🔍 Already in meeting - will auto-start recording in 3 seconds");
                isInMeeting = true;
                meetingStarted = true;
                
                if (!meetingStartTime) {
                    startMeetingTimer();
                }
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🚀 Auto-starting recording for existing meeting");
                    showMeetStatus("🟡 Auto recording starting in 3 seconds...", 3000);
                    setTimeout(async () => {
                        await startAutoRecording();
                    }, 3000);
                }
            }
        }

        function getMuteStatus() {
            const muteButton = document.querySelector('[aria-label*="microphone"]') || 
                             document.querySelector('[data-tooltip*="microphone"]') ||
                             document.querySelector('[jscontroller*="microphone"]');
            
            if (muteButton) {
                const ariaLabel = muteButton.getAttribute('aria-label') || '';
                const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
                return { isMuted: isMuted };
            }
            
            const muteIcon = document.querySelector('svg[aria-label*="microphone"]');
            if (muteIcon) {
                const ariaLabel = muteIcon.getAttribute('aria-label') || '';
                const isMuted = ariaLabel.includes('unmute') || ariaLabel.includes('Turn on');
                return { isMuted: isMuted };
            }
            
            return { isMuted: true };
        }

        function forceResetAndRetry() {
            console.log("🔄 FORCE RESET - Resetting everything...");
            recordingStarted = false;
            forceMeetingRedetection();
            
            const existingStatus = document.getElementById('meet-recorder-status');
            if (existingStatus) existingStatus.remove();
            
            chrome.storage.local.set({ 
                isRecording: false,
                recordingStoppedByTabClose: true
            });
            
            chrome.runtime.sendMessage({ action: "refreshExtensionState" });
            
            showMeetStatus("🔄 Force reset - checking meeting state...");
            
            setTimeout(() => {
                console.log("🔄 Attempting auto-record after reset...");
                forceMeetingRedetection();
                
                if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                    console.log("✅ Conditions met - starting auto recording");
                    startAutoRecording();
                } else {
                    console.log("❌ Conditions not met after reset:", {
                        isInMeeting,
                        autoRecordEnabled,
                        recordingStarted
                    });
                }
            }, 3000);
        } 

        // Message listener for Google Meet
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === "updateAutoRecordPermission") {
                autoRecordEnabled = message.enabled;
                console.log(`🔄 Auto record permission updated for ${currentService}:`, autoRecordEnabled);
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStarted") {
                console.log("🎬 Manual recording started - showing timer in Meet");
                recordingStarted = true;
                sendResponse({ success: true });
            }
    
            if (message.action === "manualRecordingStopped") {
                console.log("🛑 Manual recording stopped");
                recordingStarted = false;
                sendResponse({ success: true });
            }

            if (message.action === "autoRecordToggledOn") {
                autoRecordEnabled = message.enabled;
                console.log("🔄 Auto-record toggled ON, checking if we're in a meeting...");
                startAutoRecordingImmediately();
                sendResponse({ success: true });
            }

            if (message.action === "checkMeetingStatus") {
                sendResponse({ 
                    isInMeeting, 
                    recording: recordingStarted, 
                    autoRecordEnabled,
                    meetingDuration: getCurrentMeetingDuration()
                });
            }

            if (message.action === "autoStopRecording") {
                stopAutoRecording();
                sendResponse({ success: true });
            }

            if (message.action === "getMeetingDuration") {
                const duration = getCurrentMeetingDuration();
                sendResponse({ 
                    duration: duration,
                    isInMeeting: isInMeeting,
                    startTime: meetingStartTime
                });
            }

            if (message.action === "getLastMeetingStats") {
                chrome.storage.local.get(['lastMeetingDuration', 'lastMeetingEndTime'], (result) => {
                    sendResponse({
                        lastDuration: result.lastMeetingDuration || 0,
                        lastEndTime: result.lastMeetingEndTime || null
                    });
                });
                return true;
            }

            if (message.action === "getMuteStatus") {
                const status = getMuteStatus();
                sendResponse(status);
            }

            if (message.action === "showMeetStatus") {
                const duration = message.duration || 4000;
                showMeetStatus(message.message, duration);
                sendResponse({ success: true });
            }
            
            if (message.action === "updateMeetTimer") {
                const status = document.getElementById('meet-recorder-status');
                if (status && status.textContent.includes('Recording')) {
                    status.textContent = `🔴 Recording... ${message.time}`;
                } else if (isInMeeting && recordingStarted) {
                    showMeetStatus(`🔴 Recording... ${message.time}`);
                }
                sendResponse({ success: true });
            }

            if (message.action === "recordingCompleted") {
                recordingStarted = false;
                if (autoRecordEnabled) {
                    showMeetStatus("✅ Auto Recording Completed & Downloaded");
                } else {
                    showMeetStatus("✅ Recording Completed & Downloaded");
                }
                sendResponse({ success: true });
            }

            if (message.action === "forceResetAndRetry") {
                console.log("📨 Received force reset command");
                forceResetAndRetry();
                sendResponse({ success: true });
            }
            
            return true;
        });      

        // Initialize
        setTimeout(async () => {
            await initializeWithStateRecovery();
            await initializeAutoRecord();
            console.log("🔍 Meet Auto Recorder content script fully loaded with state recovery");
    
            // Show initial status based on auto-record setting
            if (autoRecordEnabled) {
                showMeetStatus("✅ Google Meet's Auto Recording Enabled \nPermission needed - please click the extension icon once to grant access", 3000);
            } else {
                showMeetStatus("✅ Google Meet's Manual Recorder Is Ready", 3000);
            }
        }, 1000);
    }

    // ==================== MICROSOFT TEAMS ====================
    function teamsContent() {
        console.log("🔍 Initializing Microsoft Teams content script");

        let isInMeeting = false;
        let recordingStarted = false;
        let autoRecordEnabled = false;
        let joinButtonObserver = null;

        function getTeamsMuteStatus() {
            // Teams mute button selectors (you may need to adjust these)
            const muteButton = document.querySelector('[data-tid="toggle-mute"]') ||
                      document.querySelector('button[aria-label*="Mute"]') ||
                      document.querySelector('button[aria-label*="Unmute"]') ||
                      document.querySelector('[aria-label*="microphone"]') ||
                      document.querySelector('[data-tid*="mute"]');
    
            if (muteButton) {
                const ariaLabel = muteButton.getAttribute('aria-label') || '';
                // If aria-label contains "Unmute", that means currently muted
                const isMuted = ariaLabel.toLowerCase().includes('unmute');
                return { isMuted: isMuted };
            }
            return { isMuted: false }; // Default to unmuted if can't detect
        }

        // ==================== TEAMS TIMER FUNCTIONS ====================
        function showTeamsStatus(message, duration = 4000) {
            const existing = document.getElementById('teams-recorder-status');
            
            if (existing && message.includes("Recording...")) {
                existing.innerHTML = message.replace(/\n/g, '<br>');
                return;
            }
    
            if (existing) existing.remove();
    
            const status = document.createElement('div');
            status.id = 'teams-recorder-status';
            status.innerHTML = message.replace(/\n/g, '<br>');
            status.style.cssText = `
                position: fixed;
                top: 150px;
                right: 20px;
                background: rgba(0,0,0,0.95);
                color: white;
                padding: 12px 16px;
                border-radius: 10px;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 14px;
                z-index: 100000;
                font-weight: bold;
                border: 2px solid #6264a7;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                backdrop-filter: blur(10px);
                max-width: 400px;
                word-wrap: break-word;
            `;
    
            document.body.appendChild(status);

            if (!message.includes("Recording...")) {
                setTimeout(() => {
                    const currentStatus = document.getElementById('teams-recorder-status');
                    if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                        currentStatus.remove();
                    }
                }, duration);
            }
        }

        function broadcastTimerUpdateToTeams(timeStr) {
            chrome.runtime.sendMessage({
                action: "updateTeamsTimer",
                time: timeStr
            });
        }

        function broadcastToTeamsTab(message, duration = 4000) {
            chrome.runtime.sendMessage({
                action: "showTeamsStatus", 
                message: message,
                duration: duration
            });
        }

        function startAutoRecordingImmediately() {
            if (isInMeeting && autoRecordEnabled && !recordingStarted) {
                console.log("🚀 Auto-record toggled ON mid-meeting - starting recording immediately");
                showMeetingNotification("autoRecordingStarted");
                startAutoRecording();
            }
        }

        async function initializeAutoRecord() {
            //await checkAutoRecordPermision();
        
            // If auto-record is enabled, immediately check meeting status
            if (autoRecordEnabled) {
                console.log("🔄 Auto-record enabled - checking current meeting state");
                setTimeout(() => {
                    handleMidMeetingAutoRecord();
                    // Additional check after everything loads
                    setTimeout(() => {
                        handleMidMeetingAutoRecord();
                    }, 5000);
                }, 2000);
            }
        }

        async function checkAutoRecordPermission() {
            return new Promise((resolve) => {
                chrome.storage.local.get(['autoRecordPermissions'], (result) => {
                    // Get service-specific permission for Teams
                    autoRecordEnabled = result.autoRecordPermissions?.['teams'] || false;
                    console.log("🔐 Auto record enabled for teams:", autoRecordEnabled);
                    resolve(autoRecordEnabled);
                });
            });
        }

        function findJoinButton() {
            const joinButton = document.getElementById('prejoin-join-button');
            if (joinButton) {
                console.log("🔍 Found Join button:", {
                    id: joinButton.id,
                    text: joinButton.textContent,
                    visible: isElementVisible(joinButton)
                });
                return joinButton;
            }
            
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

        function setupJoinButtonClickHandler() {
            document.removeEventListener('click', handleJoinButtonClick, true);
            document.addEventListener('click', handleJoinButtonClick, true);
            console.log("🖱️ Join button click handler activated");
        }

        function handleJoinButtonClick(event) {
            let target = event.target;
            
            while (target && target !== document.body) {
                if (isJoinButton(target)) {
                    console.log("🎯 JOIN BUTTON CLICKED - User is joining meeting");
                    console.log("⏰ Starting 3-second delay before recording...");
                    
                    setTimeout(() => {
                        meetingStarted();
                    }, 3000);
                    
                    break;
                }
                target = target.parentElement;
            }
        }

        function isJoinButton(element) {
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

        function setupLeaveButtonClickHandler() {
            document.removeEventListener('click', handleLeaveButtonClick, true);
            document.addEventListener('click', handleLeaveButtonClick, true);
            console.log("🖱️ Leave button click handler activated");
        }

        function handleLeaveButtonClick(event) {
            let target = event.target;
            
            while (target && target !== document.body) {
                if (isLeaveButton(target)) {
                    console.log("🛑 LEAVE BUTTON CLICKED - Meeting ended by user");

                     if (recordingStarted && !autoRecordEnabled) {
                        console.log("🛑 Manual recording active - will stop recording");
                        // The meetingEnded() function will handle stopping the recording
                    }
        
                    meetingEnded();
                    break;
                }
                target = target.parentElement;
            }
        }

        function isLeaveButton(element) {
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

        function meetingStarted() {
            if (isInMeeting) return;
            
            const startTime = new Date().toLocaleTimeString();
            console.log(`🎯 MEETING STARTED - 3-second delay completed at ${startTime}`);
            isInMeeting = true;
            
            if (autoRecordEnabled && !recordingStarted) {
                console.log("🎬 AUTO RECORDING - Starting recording after delay");
                startAutoRecording();
            } else {
                console.log("ℹ️ Auto recording not enabled or already recording");
            }
            
            showMeetingNotification("started");
            chrome.storage.local.set({ isInMeeting: isInMeeting });
        }

        function meetingEnded() {
            if (!isInMeeting) return;
            
            const endTime = new Date().toLocaleTimeString();
            console.log(`🎯 MEETING ENDED - Leave button was clicked at ${endTime}`);
            isInMeeting = false;
            
            if (recordingStarted) {
                if (autoRecordEnabled) {
                    console.log("⏹️ AUTO STOPPING - Stopping recording due to meeting end");
                    stopAutoRecording();
                } else {
                    console.log("⏹️ MANUAL RECORDING - Meeting ended, stopping recording");
                    handleManualMeetingEnd();
                }
            }
            
            showMeetingNotification("ended");
            chrome.storage.local.set({ isInMeeting: isInMeeting });
        }

        // ==================== TEAMS MEETING END DETECTION ====================
        function setupTeamsMeetingEndDetection() {
            console.log("🔍 Setting up Teams meeting end detection for manual recording");
    
            // Monitor for meeting end indicators
            const meetingEndObserver = new MutationObserver((mutations) => {
                if (!recordingStarted || autoRecordEnabled) return;
        
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) {
                                checkForMeetingEndIndicators();
                            }
                        });
                    }
                });
            });
    
            meetingEndObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: false
            });
    
            // Also check periodically for meeting end
            const periodicCheck = setInterval(() => {
                if (!recordingStarted || autoRecordEnabled) return;
                checkForMeetingEndIndicators();
            }, 3000);
        }

        function checkForMeetingEndIndicators() {
            // Check if we're still in a meeting
            const stillInMeeting = checkIfInMeeting();
            
            if (!stillInMeeting && isInMeeting && recordingStarted && !autoRecordEnabled) {
                console.log("🛑 Manual recording: Meeting ended - stopping recording");
                handleManualMeetingEnd();
            }
    
            // Update our meeting state
            if (stillInMeeting !== isInMeeting) {
                isInMeeting = stillInMeeting;
                chrome.storage.local.set({ isInMeeting: isInMeeting });
        
                if (!isInMeeting && recordingStarted && !autoRecordEnabled) {
                    console.log("🛑 Manual recording: Meeting state changed to ended - stopping recording");
                    handleManualMeetingEnd();
                }
            }
        }

        function handleManualMeetingEnd() {
            if (!recordingStarted || autoRecordEnabled) return;
    
            console.log("🛑 Manual recording: Meeting ended, stopping recording and downloading");
            showTeamsStatus("🟡 Meeting ended - stopping recording...");
    
            // Stop the recording
            stopManualRecording();
        }

        function stopManualRecording() {
            if (!recordingStarted) return;
    
            console.log("🛑 Stopping manual recording due to meeting end");
            showTeamsStatus("🟡 Meeting ended - stopping recording...");
    
            chrome.runtime.sendMessage({ action: "stopRecordingOnMeetingEnd" });
    
            recordingStarted = false;     
        }

        function startAutoRecording() {
            if (recordingStarted) return;
            
            console.log("🎬 Attempting auto recording start...");
            recordingStarted = true;
            
            chrome.runtime.sendMessage({ 
                action: "autoStartRecording"
            }, (response) => {
                if (response && response.success) {
                    console.log("✅ Auto recording started successfully");
                    showRecordingNotification("started");
                } else {
                    console.log("❌ Auto recording failed to start");
                    recordingStarted = false;
                }
            });
        }

        function startManualRecording() {
            if (recordingStarted) return;
    
            console.log("🎬 Starting manual recording...");
            recordingStarted = true;
    
            // Show recording status immediately
            showTeamsStatus("🔴 Recording... 00:00");
    
            chrome.runtime.sendMessage({ 
                action: "manualRecordingStarted"
            }, (response) => {
                if (response && response.success) {
                    console.log("✅ Manual recording started successfully");
                    showRecordingNotification("started");
                } else {
                    console.log("❌ Manual recording failed to start");
                    recordingStarted = false;
                    showTeamsStatus("❌ Recording failed to start");
                }
            });
        }

        function stopAutoRecording() {
            if (!recordingStarted) return;
            
            console.log("🛑 Attempting auto recording stop...");
            
            chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
                if (response && response.success) {
                    console.log("✅ Auto recording stopped successfully");
                    recordingStarted = false;
                    showRecordingNotification("stopped");
                } else {
                    console.log("❌ Auto recording failed to stop");
                }
            });
        }

        function showMeetingNotification(type) {
            const existingNotification = document.getElementById('meeting-status-notification');
            if (existingNotification) {
                existingNotification.remove();
            }

            const notification = document.createElement('div');
            notification.id = 'meeting-status-notification';
            
            const currentTime = new Date().toLocaleTimeString();
            
            if (type === "started") {
                notification.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #4CAF50;
                    color: white;
                    padding: 12px 18px;
                    border-radius: 8px;
                    z-index: 10000;
                    font-family: Arial, sans-serif;
                    font-size: 14px;
                    font-weight: bold;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    border: 2px solid #45a049;
                `;
                notification.textContent = `🔴 Meeting Started - ${currentTime}`;
            }  else if (type === "autoRecordingStarted") {
                notification.style.cssText = `
                position: fixed;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: #2196F3;
                color: white;
                padding: 12px 18px;
                border-radius: 8px;
                z-index: 10000;
                font-family: Arial, sans-serif;
                font-size: 14px;
                font-weight: bold;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                border: 2px solid #1976D2;
                `;
                notification.textContent = `🎬 Auto Recording Started - ${currentTime}`;
            } else {
                notification.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #f44336;
                    color: white;
                    padding: 12px 18px;
                    border-radius: 8px;
                    z-index: 10000;
                    font-family: Arial, sans-serif;
                    font-size: 14px;
                    font-weight: bold;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    border: 2px solid #d32f2f;
                `;
                notification.textContent = `⏹️ Meeting Ended - ${currentTime}`;
            }
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 5000);
        }

        function showRecordingNotification(type) {
            const notification = document.createElement('div');
            notification.id = 'recording-status-notification';
            notification.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                background: ${type === 'started' ? '#2196F3' : '#FF9800'};
                color: white;
                padding: 8px 12px;
                border-radius: 5px;
                z-index: 9999;
                font-family: Arial, sans-serif;
                font-size: 11px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            `;
            notification.textContent = type === 'started' 
                ? '🔴 Recording Started' 
                : '⏹️ Recording Stopped - Downloading...';
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 4000);
        }

        function checkIfInMeeting() {
            // Check for various indicators that we're in a Teams meeting
            const indicators = [
                // Video container
                '[data-tid="video-layout"]',
                '[data-tid="meeting-container"]',
                // Participant list
                '[data-tid="roster-list"]',
                // Meeting controls
                '[data-tid="meeting-controls"]',
                '[data-tid="call-controls"]',
                // Leave button
                '[data-tid="hangup-button"]',
                'button[aria-label*="Leave"]',
                'button[aria-label*="Hang up"]',
                // Active speaker video
                '[data-tid="active-speaker-video"]',
                // More specific meeting indicators
                'div[role="main"][data-tid*="meeting"]',
                '.ts-calling-stage',
                '.call-stage'
            ];
        
            for (const selector of indicators) {
                const element = document.querySelector(selector);
                if (element && isElementVisible(element)) {
                    console.log("✅ Teams meeting detected with selector:", selector);
                    return true;
                }
            }
        
            // Additional check: look for multiple video elements which indicate active meeting
            const videoElements = document.querySelectorAll('video');
            const visibleVideos = Array.from(videoElements).filter(video => 
                video.readyState > 0 && 
                video.videoWidth > 0 && 
                video.videoHeight > 0 &&
                isElementVisible(video)
            );
        
            if (visibleVideos.length > 0) {
                console.log("✅ Teams meeting detected via active video elements:", visibleVideos.length);
                return true;
            }
        
            console.log("❌ No Teams meeting indicators found");
            return false;
        }

        function handleMidMeetingAutoRecord() {
            const inMeeting = checkIfInMeeting();
            console.log("🔍 Mid-meeting auto-record check:", { 
                inMeeting, 
                isInMeeting, 
                autoRecordEnabled, 
                recordingStarted 
            });

            if (inMeeting && !isInMeeting) {
                console.log("🔍 Detected active meeting - updating state");
                isInMeeting = true;
                chrome.storage.local.set({ isInMeeting: true });
                
                if (autoRecordEnabled && !recordingStarted) {
                    console.log("🚀 Auto-record enabled mid-meeting - starting recording");                
                        startAutoRecordingImmediately();
                }
            } else if (inMeeting && isInMeeting && autoRecordEnabled && !recordingStarted) {
                // We're already marked as in meeting but recording hasn't started
                console.log("🚀 Already in meeting with auto-record enabled - starting recording");
                startAutoRecordingImmediately();
            }
        }

        function setupJoinButtonObserver() {
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
                        setupJoinButtonClickHandler();
                        setupLeaveButtonClickHandler();
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

        function initializeDetection() {
            // Load auto-record permission on initialization
            checkAutoRecordPermission().then(() => {
                console.log("🔐 Teams auto-record permission loaded:", autoRecordEnabled);

                // Show initial status based on auto-record setting
                if (autoRecordEnabled) {
                    showTeamsStatus("✅ Teams Auto Recording Enabled \nPermission needed - please click the extension icon once to grant access", 3000);
                } else {
                    showTeamsStatus("✅ Teams Recorder Ready - Manual mode", 3000);
                }

                initializeAutoRecord();
            
                // Then check meeting status
                setTimeout(() => {
                    console.log("🔍 Initial meeting state check...");
                    handleMidMeetingAutoRecord();
                
                    // If auto-record is enabled and we're in a meeting, start recording
                    if (autoRecordEnabled && isInMeeting && !recordingStarted) {
                        console.log("🚀 Auto-record enabled and in meeting - starting recording");
                        setTimeout(() => {
                            startAutoRecordingImmediately();
                        }, 2000);
                    }
                }, 2000);
            });

            setupJoinButtonObserver();
            setupJoinButtonClickHandler();
            setupLeaveButtonClickHandler();
            setupTeamsMeetingEndDetection();
        
            const existingJoinButton = findJoinButton();
            if (existingJoinButton) {
                console.log("✅ Join button already present on page");
            }
        
            // Check if we're already in a meeting on initialization
            setTimeout(() => {
                handleMidMeetingAutoRecord();
            }, 3000);
        
            let lastUrl = location.href;
            const urlObserver = new MutationObserver(() => {
                const url = location.href;
                if (url !== lastUrl) {
                    lastUrl = url;
                    console.log("🔗 URL changed, reinitializing detection...");
                    setTimeout(() => {
                        initializeDetection();
                    }, 2000);
                }
            });
        
            urlObserver.observe(document, { subtree: true, childList: true });
        }

        // Message listener for Teams
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log("📨 Teams content script received:", message.action);
            
            if (message.action === "updateAutoRecordPermission") {
                autoRecordEnabled = message.enabled;
                console.log("🔐 Auto record permission updated:", autoRecordEnabled);
                if (autoRecordEnabled && isInMeeting && !recordingStarted) {
                    console.log("🚀 Auto-record enabled while in Teams meeting - starting recording");
                    setTimeout(() => {
                        startAutoRecordingImmediately();
                    }, 1000);
                }
                sendResponse({ success: true });
            }

            if (message.action === "autoRecordToggledOn") {
                autoRecordEnabled = message.enabled;
                console.log("🔄 Auto-record toggled ON, checking meeting status...");
            
                // Check if we're in a meeting and start recording immediately
                setTimeout(() => {
                    handleMidMeetingAutoRecord();
                }, 500);
            
                sendResponse({ success: true });
            }

            if (message.action === "checkMeetingStatus") {
                const wasInMeeting = isInMeeting;
                handleMidMeetingAutoRecord();

                // If we just detected we're in a meeting and auto-record is enabled, start recording
                if (!wasInMeeting && isInMeeting && autoRecordEnabled && !recordingStarted) {
                    console.log("🚀 Meeting detected with auto-record enabled - starting recording");
                    setTimeout(() => {
                        startAutoRecordingImmediately();
                    }, 1000);
                }

                sendResponse({ 
                    isInMeeting: isInMeeting, 
                    recording: recordingStarted,
                    autoRecordEnabled: autoRecordEnabled
                });
            }

             if (message.action === "manualRecordingStarted") {
                console.log("🎬 Manual recording started - showing timer in Teams");
                recordingStarted = true;
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStopped") {
                console.log("🛑 Manual recording stopped");
                recordingStarted = false;
                showTeamsStatus("✅ Recording stopped manually");
                sendResponse({ success: true });
            }

            if (message.action === "showTeamsStatus") {
                const duration = message.duration || 4000;
                showTeamsStatus(message.message, duration);
                sendResponse({ success: true });
            }
    
            if (message.action === "updateTeamsTimer") {
                const status = document.getElementById('teams-recorder-status');
                if (status && status.textContent.includes('Recording')) {
                    status.textContent = `🔴 Recording... ${message.time}`;
                } else if (isInMeeting && recordingStarted) {
                    showTeamsStatus(`🔴 Recording... ${message.time}`);
                }
                sendResponse({ success: true });
            }

            if (message.action === "stopRecordingOnMeetingEnd") {
                if (recordingStarted && !autoRecordEnabled) {
                    console.log("🛑 Manual recording: Meeting ended - stopping recording");
                    stopManualRecording();
                }
                sendResponse({ success: true });
            }

            if (message.action === "recordingCompleted") {
                recordingStarted = false;
                if (autoRecordEnabled) {
                    showTeamsStatus("✅ Auto Recording Completed & Downloaded");
                } else {
                    showTeamsStatus("✅ Recording Completed & Downloaded");
                }
                sendResponse({ success: true });
            }

            if (message.action === "getTeamsMuteStatus") {
                const status = getTeamsMuteStatus();
                sendResponse(status);
            }
            
            return true;
        });        

        // Initialize Teams
        setTimeout(() => {
            initializeDetection();
            console.log("🔍 Teams Auto Recorder initialized");
        }, 1500);
    }

    // ==================== ZOOM ====================
    function zoomContent() {
        console.log("🔍 Initializing Zoom content script");

        let isInMeeting = false;
        let recordingStarted = false;
        let autoRecordEnabled = false;
        let meetingStartTimeout = null;

        function getZoomMuteStatus() {
    const muteButton = document.querySelector('[aria-label*="mute my microphone"]') ||
                      document.querySelector('[aria-label*="unmute my microphone"]') ||
                      document.querySelector('.footer-button-base__button[aria-label*="mute"]') ||
                      document.querySelector('.join-audio-container__btn');
    
    if (muteButton) {
        const ariaLabel = muteButton.getAttribute('aria-label') || '';
        const isMuted = ariaLabel.toLowerCase().includes('unmute');
        return { isMuted: isMuted };
    }
    return { isMuted: false };
}

    // ==================== ZOOM STATUS FUNCTIONS ====================
    function showZoomStatus(message, duration = 4000) {
        const existing = document.getElementById('zoom-recorder-status');
    
        if (existing && message.includes("Recording...")) {
            existing.innerHTML = message.replace(/\n/g, '<br>');
            return;
        }
    
        if (existing) existing.remove();
    
        const status = document.createElement('div');
        status.id = 'zoom-recorder-status';
        status.innerHTML = message.replace(/\n/g, '<br>');
        status.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(0,0,0,0.95);
            color: white;
            padding: 12px 16px;
            border-radius: 10px;
            font-family: 'Segoe UI', Arial, sans-serif;
            font-size: 14px;
            z-index: 100000;
            font-weight: bold;
            border: 2px solid #2D8CFF;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
            max-width: 400px;
            word-wrap: break-word;
        `;
    
        document.body.appendChild(status);

        if (!message.includes("Recording...")) {
            setTimeout(() => {
                const currentStatus = document.getElementById('zoom-recorder-status');
                if (currentStatus && !currentStatus.innerHTML.includes("Recording...")) {
                    currentStatus.remove();
                }
            }, duration);
        }
    }

    function broadcastTimerUpdateToZoom(timeStr) {
        chrome.runtime.sendMessage({
            action: "updateZoomTimer",
            time: timeStr
        });
    }

    function broadcastToZoomTab(message, duration = 4000) {
        chrome.runtime.sendMessage({
            action: "showZoomStatus", 
            message: message,
            duration: duration
        });
    }

    // Check auto record permission on load
    checkAutoRecordPermission();

    async function checkAutoRecordPermission() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['autoRecordPermissions'], (result) => {
                // Get service-specific permission for Zoom
                autoRecordEnabled = result.autoRecordPermissions?.['zoom'] || false;
                console.log("🔐 Auto record enabled for zoom:", autoRecordEnabled);
                resolve(autoRecordEnabled);
            });
        });
    }

    // IMPROVED MEETING DETECTION
    function startMeetingDetection() {
        console.log("🚀 Starting Zoom meeting detection...");
            
        let lastState = false;
        let detectionCount = 0;
            
        const detectionInterval = setInterval(() => {
            detectionCount++;
                
            // MULTIPLE DETECTION METHODS
            const meetingIndicators = [
                // Main meeting container
                document.querySelector('.main-body-layout_mainBody__YKEeP'),
                // Video container
                document.querySelector('.video-layout'),
                // Active speaker
                document.querySelector('.active-speaker'),
                // Gallery view
                document.querySelector('.gallery-view'),
                // Meeting container
                document.querySelector('[data-meeting="true"]'),
                // Video element with specific classes
                document.querySelector('.video-window'),
                // Zoom specific selectors
                document.querySelector('.zm-btn.join-audio-by-voip__join-btn'),
                document.querySelector('.footer-button-base__button-edge'),
                document.querySelector('[aria-label*="meeting"]'),
                document.querySelector('.video-container')
            ].filter(el => {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 300 && rect.height > 200;
            });

            const meetingDetected = meetingIndicators.length > 0;
                
            console.log("🔍 Zoom meeting check:", {
                attempt: detectionCount,
                meetingDetected: meetingDetected,
                isInMeeting: isInMeeting,
                indicators: meetingIndicators.length
            });
                
            if (meetingDetected && !lastState && !isInMeeting) {
                console.log("🎯 ZOOM MEETING STARTED DETECTED!");
                startMeetingWithDelay();
            } else if (!meetingDetected && lastState && isInMeeting) {
                console.log("🛑 ZOOM MEETING ENDED DETECTED!");
                meetingEnded();
            }
                
            lastState = meetingDetected;
                
            // Stop detection after 30 attempts to prevent infinite loop
            if (detectionCount >= 30) {
                console.log("⏹️ Stopping Zoom meeting detection after 30 attempts");
                clearInterval(detectionInterval);
            }
        }, 3000);
    }

    // NUCLEAR OPTION - ABSOLUTELY CERTAIN END BUTTON DETECTION
    function setupEndButtonDetection() {
        console.log("🖱️ ZOOM NUCLEAR OPTION - Setting up ABSOLUTE End button detection...");

        // METHOD 1: INTERCEPT ALL BUTTON CLICKS ON THE ENTIRE PAGE
        document.addEventListener('click', function(event) {
            console.log("🖱️ ZOOM NUCLEAR: Global click detected");
                
            const target = event.target;
                
            // Check if this is ANY button that could be leave/end related
            if (target.tagName === 'BUTTON') {
                const buttonText = (target.textContent || '').trim().toLowerCase();
                const buttonHtml = target.outerHTML.toLowerCase();
                    
                console.log("🖱️ ZOOM NUCLEAR: Button clicked - Text:", buttonText);
                    
                // EXTREMELY BROAD DETECTION - catch ANY leave/end related button
                if (buttonText.includes('leave') || 
                    buttonText.includes('end') ||
                    buttonText.includes('leave meeting') ||
                    buttonText.includes('end meeting') ||
                    buttonHtml.includes('leave') ||
                    buttonHtml.includes('end') ||
                    target.className.includes('leave') ||
                    target.className.includes('end') ||
                    target.id.includes('leave') ||
                    target.id.includes('end')) {
                        
                    console.log("🎯 ZOOM NUCLEAR: LEAVE/END BUTTON DETECTED!", buttonText);
                    console.log("🔍 Button details:", {
                        text: buttonText,
                        className: target.className,
                        id: target.id,
                        html: target.outerHTML.substring(0, 200)
                    });
                        
                    // STOP EVERYTHING IMMEDIATELY
                    event.stopImmediatePropagation();
                    event.preventDefault();
                        
                    // Force stop recording
                    forceStopRecording();
                    return;
                }
            }
                
            // Also check if click is inside a button
            const buttonParent = target.closest('button');
            if (buttonParent) {
                const buttonText = (buttonParent.textContent || '').trim().toLowerCase();
                console.log("🖱️ ZOOM NUCLEAR: Click inside button - Text:", buttonText);
                    
                if (buttonText.includes('leave') || buttonText.includes('end')) {
                    console.log("🎯 ZOOM NUCLEAR: LEAVE/END BUTTON (PARENT) DETECTED!", buttonText);
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    forceStopRecording();
                    return;
                }
            }
        }, true); // CAPTURE PHASE - MOST AGGRESSIVE

            // METHOD 2: MONITOR URL CHANGES - WHEN MEETING ENDS, URL CHANGES
            let lastUrl = window.location.href;
            const urlChecker = setInterval(() => {
                const currentUrl = window.location.href;
                if (currentUrl !== lastUrl) {
                    console.log("🔗 ZOOM NUCLEAR: URL changed from", lastUrl, "to", currentUrl);
                    
                    // If we were in a meeting and now we're not, stop recording
                    if (isInMeeting && !currentUrl.includes('/wc/') && !currentUrl.includes('/meeting/')) {
                        console.log("🛑 ZOOM NUCLEAR: Meeting ended (URL change detected)");
                        forceStopRecording();
                    }
                    
                    lastUrl = currentUrl;
                }
            }, 1000);

            // METHOD 3: MONITOR PAGE VISIBILITY - WHEN USER LEAVES MEETING
            document.addEventListener('visibilitychange', function() {
                if (document.hidden && isInMeeting && recordingStarted) {
                    console.log("👻 ZOOM NUCLEAR: Page hidden during meeting - stopping recording");
                    setTimeout(() => {
                        forceStopRecording();
                    }, 2000);
                }
            });

            // METHOD 4: PERIODIC FORCE CHECK - EVERY 2 SECONDS CHECK IF WE SHOULD STOP
            const forceChecker = setInterval(() => {
                // Check if leave container is visible
                const leaveContainers = [
                    '#wc-footer > div.footer__inner.leave-option-container',
                    '.leave-option-container',
                    '[class*="leave"]',
                    '[class*="end"]',
                    '.footer-button-base__button-edge' // Zoom specific
                ];
                
                let leaveContainerVisible = false;
                leaveContainers.forEach(selector => {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) { // Check if visible
                        console.log("🔍 ZOOM NUCLEAR: Leave container visible:", selector);
                        leaveContainerVisible = true;
                    }
                });
                
                // If leave container is visible and we're recording, stop after delay
                if (leaveContainerVisible && recordingStarted) {
                    console.log("🛑 ZOOM NUCLEAR: Leave container detected - stopping recording in 3 seconds");
                    setTimeout(() => {
                        forceStopRecording();
                    }, 3000);
                }
            }, 2000);

            console.log("✅ ZOOM NUCLEAR OPTION: End button detection setup complete");
        }

        // FORCE STOP RECORDING - ABSOLUTELY CERTAIN STOP
        function forceStopRecording() {
            console.log("🛑🛑🛑 ZOOM NUCLEAR: FORCE STOP RECORDING 🛑🛑🛑");
            
            // Clear any timeouts
            if (meetingStartTimeout) {
                clearTimeout(meetingStartTimeout);
                meetingStartTimeout = null;
            }
            
            // Update states
            isInMeeting = false;
            
            if (recordingStarted) {
                console.log("🚨 ZOOM NUCLEAR: Stopping active recording");
                recordingStarted = false;

                // Show appropriate status based on recording mode
                if (autoRecordEnabled) {
                    showZoomStatus("🟡 Auto Recording Stopped - Meeting ended");
                } else {
                    showZoomStatus("🟡 Recording Stopped - Meeting ended");
                }

                // Hide UI immediately
                hideRecordingPopup();
                hideRecordingTimer();
                
                // Send stop message to background
                chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
                    if (response && response.success) {
                        console.log("✅ ZOOM NUCLEAR: Recording stopped successfully");
                        showRecordingNotification("stopped");
                    } else {
                        console.log("❌ ZOOM NUCLEAR: Failed to stop via message, trying emergency stop");
                        emergencyStop();
                    }
                });
            } else {
                console.log("⚠️ ZOOM NUCLEAR: No recording active, but cleaning up");
                hideRecordingPopup();
                hideRecordingTimer();
            }
            
            // Update storage
            chrome.storage.local.set({ isInMeeting: false });
        }

        // EMERGENCY STOP - WHEN NORMAL STOP FAILS
        function emergencyStop() {
            console.log("🚨🚨🚨 ZOOM EMERGENCY STOP 🚨🚨🚨");
            
            try {
                // Send multiple stop commands
                chrome.runtime.sendMessage({ action: "autoStopRecording" });
                chrome.runtime.sendMessage({ action: "stopAllRecordings" });
                chrome.runtime.sendMessage({ action: "emergencyStop" });
                
                // Force cleanup
                isInMeeting = false;
                recordingStarted = false;
                
                // Clear storage
                chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime']);
                
                // Hide all UI
                hideRecordingPopup();
                hideRecordingTimer();
                
                console.log("✅ ZOOM EMERGENCY STOP: Completed");
            } catch (error) {
                console.error("❌ ZOOM EMERGENCY STOP: Error:", error);
            }
        }

        function startMeetingWithDelay() {
            if (isInMeeting) {
                console.log("⚠️ Already in Zoom meeting, ignoring");
                return;
            }
            
            if (meetingStartTimeout) {
                clearTimeout(meetingStartTimeout);
            }
            
            console.log("⏰ Zoom: Starting 3-second delay before recording...");
            
            // Only show auto-recording message if auto-record is enabled
            if (autoRecordEnabled) {
                showZoomStatus("🟡 Auto recording starting in 3 seconds...");
            } else {
                showZoomStatus("🟡 Meeting detected - ready to record");
            }
            
            meetingStartTimeout = setTimeout(() => {
                console.log("⏰ Zoom: 3-second delay completed - starting meeting");
                meetingStarted();
            }, 3000);
        }

        function meetingStarted() {
            if (isInMeeting) return;
    
            console.log("🎯 ZOOM MEETING STARTED");
            isInMeeting = true;
    
            // Only show auto-recording status if auto-record is enabled
            if (autoRecordEnabled && !recordingStarted) {
                console.log("🎬 ZOOM AUTO RECORDING STARTING");
                startAutoRecording();
            } else if (!autoRecordEnabled) {
                // Show different status for manual recording availability
                showZoomStatus("✅ In Zoom meeting - Ready for manual recording", 5000);
            }
    
            showMeetingNotification("started");
            chrome.storage.local.set({ isInMeeting: isInMeeting });
        }

        function startAutoRecording() {
            if (recordingStarted) {
                console.log("⚠️ Zoom: Already recording, ignoring start request");
                return;
            }
            
            console.log("🎬 Zoom: Starting auto recording...");
            recordingStarted = true;
            
            showRecordingPopup();
            
            // Only show auto-recording status if auto-record is enabled
            if (autoRecordEnabled) {
                showZoomStatus("🔴 Auto Recording Started");
            } else {
                showZoomStatus("🔴 Recording Started");
            }

            chrome.runtime.sendMessage({ 
                action: "autoStartRecording",
                service: 'zoom'
            }, (response) => {
                if (response && response.success) {
                    console.log("✅ Zoom: Recording started successfully");
                    showRecordingNotification("started");
                } else {
                    console.log("❌ Zoom: Recording failed to start");
                    recordingStarted = false;
                    hideRecordingPopup();
                    showZoomStatus("❌ Auto Recording Failed");
                }
            });
        }

        function stopAutoRecording() {
            if (!recordingStarted) {
                console.log("⚠️ Zoom: stopAutoRecording called but not recording");
                return;
            }
            
            console.log("🛑 Zoom: Stopping recording and downloading...");
            
            // Show appropriate status based on recording mode
            if (autoRecordEnabled) {
                showZoomStatus("🟡 Auto Recording Stopped - Downloading...");
            } else {
                showZoomStatus("🟡 Recording Stopped - Downloading...");
            }
            
            // CLEAN UP ALL UI ELEMENTS
            hideRecordingPopup();
            hideRecordingTimer();
            
            chrome.runtime.sendMessage({ action: "autoStopRecording" }, (response) => {
                if (response && response.success) {
                    console.log("✅ Zoom: Recording stopped and download started successfully");
                    recordingStarted = false;
                    showRecordingNotification("stopped");
                } else {
                    console.log("❌ Zoom: Recording failed to stop");
                    recordingStarted = false;
                    if (autoRecordEnabled) {
                        showZoomStatus("❌ Auto Recording Stop Failed");
                    } else {
                        showZoomStatus("❌ Recording Stop Failed");
                    }
                }
            });
        }

        // UI FUNCTIONS
        function showMeetingNotification(type) {
            const existingNotification = document.getElementById('meeting-status-notification');
            if (existingNotification) existingNotification.remove();

            const notification = document.createElement('div');
            notification.id = 'meeting-status-notification';
            
            const currentTime = new Date().toLocaleTimeString();
            
            if (type === "started") {
                notification.style.cssText = `
                    position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
                    background: #2D8CFF; color: white; padding: 12px 18px; border-radius: 8px;
                    z-index: 10000; font-family: Arial; font-size: 14px; font-weight: bold;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid #1A5EB8;
                `;
                notification.textContent = `🔴 Zoom Meeting Started - ${currentTime}`;
            } else {
                notification.style.cssText = `
                    position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
                    background: #f44336; color: white; padding: 12px 18px; border-radius: 8px;
                    z-index: 10000; font-family: Arial; font-size: 14px; font-weight: bold;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid #d32f2f;
                `;
                notification.textContent = `⏹️ Zoom Meeting Ended - ${currentTime}`;
            }
            
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 5000);
        }

        function showRecordingNotification(type) {
            const notification = document.createElement('div');
            notification.id = 'recording-status-notification';
            notification.style.cssText = `
                position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
                background: ${type === 'started' ? '#2196F3' : '#FF9800'}; color: white;
                padding: 8px 12px; border-radius: 5px; z-index: 9999; font-family: Arial;
                font-size: 11px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            `;
            notification.textContent = type === 'started' 
                ? '🔴 Zoom Recording Started' 
                : '⏹️ Zoom Recording Stopped - Downloading...';
            
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 4000);
        }

        function showRecordingPopup() {
            const existingPopup = document.getElementById('recording-live-popup');
            if (existingPopup) existingPopup.remove();

            const popup = document.createElement('div');
            popup.id = 'recording-live-popup';
            popup.style.cssText = `
                position: fixed; bottom: 20px; right: 20px; background: #d32f2f; color: white;
                padding: 12px 16px; border-radius: 8px; z-index: 10000; font-family: Arial;
                font-size: 14px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                border: 2px solid #b71c1c; display: flex; align-items: center; gap: 8px;
                min-width: 180px;
            `;

            const redDot = document.createElement('div');
            redDot.style.cssText = `
                width: 12px; height: 12px; background: #ff4444; border-radius: 50%;
                animation: pulse 1.5s infinite;
            `;

            const text = document.createElement('span');
            text.id = 'recording-timer';
            text.textContent = '00:00';

            const recordingText = document.createElement('span');
            recordingText.textContent = 'Zoom Recording';

            popup.appendChild(redDot);
            popup.appendChild(text);
            popup.appendChild(recordingText);

            const style = document.createElement('style');
            style.textContent = `@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`;
            document.head.appendChild(style);

            document.body.appendChild(popup);
        }

        function updateRecordingTimer(time) {
            const timerElement = document.getElementById('recording-timer');
            if (timerElement) timerElement.textContent = time;
        }

        function hideRecordingPopup() {
            const popup = document.getElementById('recording-live-popup');
            if (popup) {
                console.log("🗑️ Removing Zoom recording popup");
                popup.remove();
            }
        }

        function hideRecordingTimer() {
            const timer = document.getElementById('recording-timer');
            if (timer) {
                console.log("🗑️ Removing Zoom recording timer");
                timer.remove();
            }
        }

        function resetRecordingState() {
            recordingStarted = false;
            isInMeeting = false;
            if (meetingStartTimeout) {
                clearTimeout(meetingStartTimeout);
                meetingStartTimeout = null;
            }
            hideRecordingPopup();
            hideRecordingTimer();
            console.log("🔄 Zoom: Recording state reset");
        }

        // Message listener for Zoom
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            console.log("📨 Zoom content script received:", message.action);
            
            if (message.action === "updateAutoRecordPermission") {
                autoRecordEnabled = message.enabled;
                console.log("🔐 Zoom: Auto record permission updated:", autoRecordEnabled);
                
                // Show appropriate status when permission changes
                if (autoRecordEnabled) {
                    showZoomStatus("✅ Auto Recording Enabled for Zoom", 4000);
                } else {
                    showZoomStatus("✅ Auto Recording Disabled for Zoom", 4000);
                }
    
                sendResponse({ success: true });
            }

            if (message.action === "showZoomStatus") {
                const duration = message.duration || 4000;
                showZoomStatus(message.message, duration);
                sendResponse({ success: true });
            }

            if (message.action === "updateZoomTimer") {
                const status = document.getElementById('zoom-recorder-status');
                if (status && status.textContent.includes('Recording')) {
                    status.textContent = `🔴 Recording... ${message.time}`;
                } else if (isInMeeting && recordingStarted) {
                    showZoomStatus(`🔴 Recording... ${message.time}`);
                }
                sendResponse({ success: true });
            }

            if (message.action === "autoRecordToggledOn") {
                autoRecordEnabled = message.enabled;
                console.log("🔄 Zoom: Auto-record toggled ON, checking meeting status...");
    
                // Check if we're in a meeting and start recording immediately
                setTimeout(() => {
                    const meetingDetected = document.querySelector('.video-container') || 
                               document.querySelector('.zm-btn.join-audio-by-voip__join-btn');
                    if (meetingDetected && !isInMeeting) {
                        console.log("🚀 Zoom: Meeting detected with auto-record enabled - starting recording");
                        showZoomStatus("🟡 Auto recording starting in 3 seconds...");
                        startMeetingWithDelay();
                    } else if (isInMeeting && !recordingStarted) {
                        console.log("🚀 Zoom: Already in meeting with auto-record enabled - starting recording");
                        showZoomStatus("🟡 Auto recording starting now...");
                        startAutoRecording();
                    } else if (isInMeeting && !autoRecordEnabled) {
                        // If we're in meeting but auto-record is disabled, show ready status
                        showZoomStatus("✅ In Zoom meeting - Ready for manual recording");
                    }
                }, 500);

                sendResponse({ success: true });
            }

            if (message.action === "checkMeetingStatus") {
                sendResponse({ 
                    isInMeeting: isInMeeting, 
                    recording: recordingStarted,
                    autoRecordEnabled: autoRecordEnabled
                });
            }

            if (message.action === "updateRecordingTimer") {
                updateRecordingTimer(message.time);
                sendResponse({ success: true });
            }

            if (message.action === "showRecordingPopup") {
                showRecordingPopup();
                sendResponse({ success: true });
            }

            if (message.action === "hideRecordingPopup") {
                hideRecordingPopup();
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStarted") {
                console.log("🎬 Zoom: Manual recording started");
                recordingStarted = true;
                showRecordingPopup();
                showZoomStatus("🔴 Recording Started");                
                sendResponse({ success: true });
            }

            if (message.action === "manualRecordingStopped") {
                console.log("🛑 Zoom: Manual recording stopped");
                recordingStarted = false;
                showZoomStatus("🟡 Recording Stopped - Downloading...");                
                hideRecordingPopup();
                sendResponse({ success: true });
            }

            if (message.action === "recordingCompleted") {
                recordingStarted = false;
                if (autoRecordEnabled) {
                    showZoomStatus("✅ Auto Recording Completed & Downloaded");
                } else {
                    showZoomStatus("✅ Recording Completed & Downloaded");
                }
                sendResponse({ success: true });
            }

            if (message.action === "showPermissionError") {
                showZoomStatus("❌ Permission needed - please click extension icon once to grant access", 6000);
                sendResponse({ success: true });
            }

             if (message.action === "getZoomMuteStatus") {
    const status = getZoomMuteStatus();
    sendResponse(status);
}
            
            return true;
        });

        // Page load detection
        window.addEventListener('load', () => {
            console.log("🔄 Zoom: Page loaded - resetting recording states");
            resetRecordingState();
            checkAutoRecordPermission().then(() => {
                console.log("🔄 Zoom: Auto record permission rechecked:", autoRecordEnabled);
            });
        });

        // Initial setup
        setTimeout(() => {
            console.log("🔧 Starting Zoom Auto Recorder...");
            startMeetingDetection();
            setupEndButtonDetection();
            console.log("✅ Zoom Auto Recorder initialized");
    
            // Show initial status based on auto-record setting
            checkAutoRecordPermission().then((enabled) => {
                if (enabled) {
                    showZoomStatus("✅ Zoom Auto Recording Enabled \nPermission needed - please click the extension icon once to grant access", 3000);
                } else {
                    showZoomStatus("✅ Zoom Recorder Ready - Manual mode", 3000);
                }
            });
        }, 1000);

        console.log("🔍 Zoom Auto Recorder content script loaded");
    }
})();


