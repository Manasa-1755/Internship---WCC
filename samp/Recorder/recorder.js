// UNIFIED RECORDER.JS - Google Meet & Microsoft Teams
(function() {
    'use strict';

    let mediaRecorder;
    let recordedChunks = [];
    let isRecording = false;
    let timerInterval;
    let recordingStartTime;
    let isAutoRecord = false;
    let originalAudioContext = null;
    let muteCheckInterval = null;
    let autoRecordEnabled = false;
    let globalMicStream = null; 
    let globalMicGainNode = null; 
    let currentTabId = null;
    let currentService = null;

    console.log("🎬 Unified Recorder tab loaded");

    // Service detection from URL parameters
    function detectService() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('service') || 'gmeet'; // Default to gmeet
    }

    // Initialize
    currentService = detectService();
    console.log(`🎬 Initializing recorder for: ${currentService}`);

    // ==================== COMMON FUNCTIONS ====================
    function safeSetStatus(message) {
        const statusElement = document.getElementById("status");
        if (statusElement) {
            statusElement.textContent = message;
        }
    }

    async function syncToggleState() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['autoRecordPermission'], (result) => {
                autoRecordEnabled = result.autoRecordPermission || false;
                console.log("🔄 Recorder: Auto record permission:", autoRecordEnabled);
                updateToggleDisplay();
                resolve(autoRecordEnabled);
            });
        });
    }

    function updateToggleDisplay() {
        const statusElement = document.getElementById("status");
        if (statusElement) {
            if (isRecording) {
                statusElement.textContent = autoRecordEnabled ? "🟢 Auto Recording..." : "🟢 Recording...";
            } else {
                statusElement.textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record...";
            }
        }
    }

    function setupTabClosureDetection(tabId) {
        const tabCheckInterval = setInterval(async () => {
            if (!isRecording) {
                clearInterval(tabCheckInterval);
                return;
            }
            
            try {
                const tab = await chrome.tabs.get(tabId);
                if (!tab) {
                    console.log("❌ Source tab closed - stopping recording");
                    stopRecording();
                    clearInterval(tabCheckInterval);
                }
            } catch (error) {
                console.log("❌ Source tab closed or inaccessible - stopping recording");
                stopRecording();
                clearInterval(tabCheckInterval);
            }
        }, 2000);
    }

    function startTimer() {
        let seconds = 0;
        const timerEl = document.getElementById("timer");
        if (!timerEl) return;
        
        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            seconds++;
            const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
            const secs = String(seconds % 60).padStart(2, "0");
            const timeStr = `${mins}:${secs}`;
            timerEl.textContent = timeStr;
            chrome.storage.local.set({ recordingTime: timeStr });
            chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
            
            // Broadcast timer update for Google Meet
            if (currentService === 'gmeet') {
                broadcastTimerUpdate(timeStr);
            }
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
    }

    function downloadRecording() {
        if (!recordedChunks.length) {
            console.error("❌ No recording data available");
            safeSetStatus("❌ No recording data");
            const message = isAutoRecord ? "❌ Auto Recording failed: No data" : "❌ Recording failed: No data";
            if (currentService === 'gmeet') {
                broadcastToMeetTab(message);
            }
            return;
        }

        console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
        const filename = `${currentService}-recording-${timestamp}.webm`;

        if (currentService === 'gmeet') {
            const stoppedMessage = isAutoRecord ? "🟡 Auto Recording Stopped" : "🟡 Recording Stopped";
            broadcastToMeetTab(stoppedMessage);
        }

        chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                console.log("✅ DOWNLOAD started with ID:", downloadId);
            }
            
            const downloadedMessage = isAutoRecord ? "✅ Auto Recording Downloaded" : "✅ Recording Downloaded";
            if (currentService === 'gmeet') {
                broadcastToMeetTab(downloadedMessage);
            }
            
            chrome.runtime.sendMessage({ action: "recordingCompleted" });
            safeSetStatus("✅ Recording Auto-Downloaded!");

            isRecording = false;

            console.log("🔒 Closing recorder tab in 2 seconds");
            setTimeout(() => {
                console.log("🔒 Closing recorder tab");
                window.close();
            }, 2000);
        });  
    }

    function comprehensiveCleanup() {
        console.log("🧹 Comprehensive cleanup started");
        
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log("🛑 Stopping media recorder");
            mediaRecorder.stop();
        }
        
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        
        if (muteCheckInterval) {
            clearInterval(muteCheckInterval);
            muteCheckInterval = null;
        }
        
        if (mediaRecorder?.stream) {
            mediaRecorder.stream.getTracks().forEach(track => {
                track.stop();
            });
        }
        
        if (globalMicStream) {
            globalMicStream.getTracks().forEach(track => {
                track.stop();
            });
            globalMicStream = null;
        }
        
        if (originalAudioContext) {
            originalAudioContext.close().catch(e => console.log("AudioContext close error:", e));
            originalAudioContext = null;
        }
        
        if (globalMicGainNode) {
            globalMicGainNode.disconnect();
            globalMicGainNode = null;
        }
        
        recordedChunks = [];
        isRecording = false;
        isAutoRecord = false;
        currentTabId = null;
        
        chrome.storage.local.set({ 
            isRecording: false,
            recordingStoppedByTabClose: true 
        }, () => {
            chrome.storage.local.remove(['recordingTime', 'recordingStartTime']);
            chrome.runtime.sendMessage({ action: "recordingStopped" });
        });             
        
        console.log("✅ Comprehensive cleanup completed");
    }

    function cleanup() {
        console.log("🧹 Standard cleanup started");
        
        if (isRecording && recordedChunks.length > 0) {
            comprehensiveCleanup();
        } else {
            stopTimer();
            if (muteCheckInterval) {
                clearInterval(muteCheckInterval);
                muteCheckInterval = null;
            }
            isRecording = false;
            console.log("✅ Standard cleanup completed");
        }
    }

    // ==================== GOOGLE MEET SPECIFIC ====================
    function broadcastToMeetTab(message, duration = 4000){
        chrome.runtime.sendMessage({
            action: "showMeetStatus", 
            message: message,
            duration: duration
        });
    }

    function broadcastTimerUpdate(timeStr) {
        chrome.runtime.sendMessage({
            action: "updateMeetTimer",
            time: timeStr
        });
    }

    async function getMuteStatus() {
        try {
            const response = await new Promise((resolve) => {
                chrome.tabs.sendMessage(currentTabId, { action: "getMuteStatus" }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ isMuted: true });
                    } else {
                        resolve(response || { isMuted: true });
                    }
                });
            });

            if (globalMicGainNode) {
                if (response.isMuted) {
                    globalMicGainNode.gain.value = 0;
                } else {
                    globalMicGainNode.gain.value = 1.0;
                }
            }
        } catch (error) {
            if (globalMicGainNode) globalMicGainNode.gain.value = 0;
        }
    }

    // ==================== RECORDING START ====================
    async function startRecording(tabId) {
        console.log(`🎬 Starting recording for ${currentService} tab:`, tabId);
        
        await syncToggleState();

        if (isRecording) {
            console.log("❌ Still recording from previous session - aborting");
            return;
        }

        try {
            if (isAutoRecord) {
                safeSetStatus("🟡 Auto recording starting...");
                if (currentService === 'gmeet') {
                    broadcastToMeetTab("🟡 Auto recording starting...");
                }
            } else {
                safeSetStatus("🟡 Starting recording...");
                if (currentService === 'gmeet') {
                    broadcastToMeetTab("🟡 Starting recording...");
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));

            const tab = await new Promise((resolve, reject) => {
                chrome.tabs.get(tabId, (tab) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(`Tab not accessible: ${chrome.runtime.lastError.message}`));
                    } else if (!tab) {
                        reject(new Error("Tab not found"));
                    } else {
                        resolve(tab);
                    }
                });
            });

            console.log("✅ Source tab validated:", tab.url);

            const tabStream = await new Promise((resolve, reject) => {
                chrome.tabCapture.capture({
                    audio: true,
                    video: true,
                    audioConstraints: {
                        mandatory: {
                            chromeMediaSource: 'tab',
                            chromeMediaSourceId: tabId.toString(), 
                        }
                    },
                    videoConstraints: {
                        mandatory: {
                            chromeMediaSource: 'tab',
                            chromeMediaSourceId: tabId.toString(), 
                            minWidth: 1280,
                            minHeight: 720,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            maxFrameRate: 30
                        }
                    }
                }, (stream) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
                    } else if (!stream) {
                        reject(new Error("No tab stream returned - check activeTab permission"));
                    } else {
                        resolve(stream);
                    }
                });
            });

            console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                        "Video tracks:", tabStream.getVideoTracks().length);

            // Audio setup for Google Meet (with microphone mixing)
            if (currentService === 'gmeet') {
                await setupGmeetAudio(tabStream, tabId);
            } else {
                // Teams audio setup (simpler)
                await setupTeamsAudio(tabStream);
            }

        } catch (err) {
            console.error("❌ Recording start failed:", err);
            safeSetStatus("❌ Recording failed: " + err.message);
            if (currentService === 'gmeet') {
                broadcastToMeetTab("❌ Recording failed.");
            }
            cleanup();
        }
    }

    async function setupGmeetAudio(tabStream, tabId) {
        const audioContext = new AudioContext();
        const recordingDestination = audioContext.createMediaStreamDestination();
        
        const meetAudioSource = audioContext.createMediaStreamSource(
            new MediaStream(tabStream.getAudioTracks())
        );
        
        const splitter = audioContext.createChannelSplitter(2);
        const recordingMerger = audioContext.createChannelMerger(2);
        const playbackMerger = audioContext.createChannelMerger(2);
        
        meetAudioSource.connect(splitter);
        
        splitter.connect(playbackMerger, 0, 0);
        splitter.connect(playbackMerger, 1, 1);
        playbackMerger.connect(audioContext.destination);
        
        splitter.connect(recordingMerger, 0, 0);
        splitter.connect(recordingMerger, 1, 1);
        
        // Get microphone audio for recording
        try {
            console.log("🎤 Requesting microphone access...");
            globalMicStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            });

            console.log("✅ Microphone access granted");
            const micSource = audioContext.createMediaStreamSource(globalMicStream);
            
            globalMicGainNode = audioContext.createGain();
            micSource.connect(globalMicGainNode);
            
            globalMicGainNode.gain.value = 0;
            globalMicGainNode.connect(recordingMerger, 0, 0);
            globalMicGainNode.connect(recordingMerger, 0, 1);
            
        } catch (micError) {
            console.error("❌ Microphone access denied:", micError);
        }

        recordingMerger.connect(recordingDestination);
        
        // Mute detection for Google Meet
        const updateMicrophoneMute = async () => {
            await getMuteStatus();
        };

        muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
        updateMicrophoneMute();

        setupMediaRecorder(tabStream, recordingDestination.stream, audioContext);
    }

    async function setupTeamsAudio(tabStream) {
        let finalStream = tabStream;

        // Try to add microphone audio for Teams
        try {
            console.log("🎤 Attempting to capture microphone for Teams...");
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100,
                    channelCount: 2
                },
                video: false
            });

            console.log("✅ Microphone captured for Teams");

            const audioContext = new AudioContext({ sampleRate: 44100 });
            const destination = audioContext.createMediaStreamDestination();

            const tabAudioSource = audioContext.createMediaStreamSource(
                new MediaStream(tabStream.getAudioTracks())
            );
            const micAudioSource = audioContext.createMediaStreamSource(micStream);

            tabAudioSource.connect(destination);
            micAudioSource.connect(destination);

            finalStream = new MediaStream([
                ...tabStream.getVideoTracks(),
                ...destination.stream.getAudioTracks()
            ]);

            originalAudioContext = audioContext;
            console.log("✅ Audio mixed successfully for Teams");

        } catch (micError) {
            console.warn("⚠️ Microphone not available for Teams, using tab audio only:", micError);
            finalStream = tabStream;
        }

        setupMediaRecorder(finalStream, finalStream, originalAudioContext);
    }

    function setupMediaRecorder(videoStream, audioStream, audioContext) {
        const videoTrack = videoStream.getVideoTracks()[0];
        const audioTrack = audioStream.getAudioTracks()[0];

        // Track closure detection
        const sourceVideoTrack = videoStream.getVideoTracks()[0];
        const sourceAudioTrack = videoStream.getAudioTracks()[0];

        if (sourceVideoTrack) {
            sourceVideoTrack.onended = () => {
                console.log("❌ Source video track ended - meeting tab closed");
                if (isRecording) {
                    stopRecording();
                }
            };
        }

        if (sourceAudioTrack) {
            sourceAudioTrack.onended = () => {
                console.log("❌ Source audio track ended - meeting tab closed");
                if (isRecording) {
                    stopRecording();
                }
            };
        }

        if (!videoTrack) {
            throw new Error("No video track available from tab capture");
        }

        if (!audioTrack) {
            throw new Error("No audio track available after mixing");
        }

        const finalStream = new MediaStream([videoTrack, audioTrack]);
        console.log("✅ Final recording stream created");

        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus', 
            'video/webm;codecs=h264,opus',
            'video/webm'
        ];
        let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

        console.log("🎥 Using MIME type:", supportedType);

        mediaRecorder = new MediaRecorder(finalStream, {
            mimeType: supportedType,
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 128000
        });

        recordedChunks = [];
        isRecording = true;
        recordingStartTime = Date.now();
        originalAudioContext = audioContext;

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
            stopTimer();

            isRecording = false;

            if (currentService === 'gmeet') {
                if (isAutoRecord) {
                    broadcastToMeetTab("🟡 Auto Recording Stopped");
                } else {
                    broadcastToMeetTab("🟡 Recording Stopped");
                }
            }

            if (recordedChunks.length > 0) {
                downloadRecording();
            } else {
                safeSetStatus("❌ No recording data");
                if (currentService === 'gmeet') {
                    if (isAutoRecord) {
                        broadcastToMeetTab("❌ Auto Recording Failed - No data");
                    } else {
                        broadcastToMeetTab("❌ Recording Failed - No data");
                    }
                }
                cleanup();
            }
        };

        mediaRecorder.onerror = e => {
            console.error("❌ MediaRecorder error:", e);
            safeSetStatus("❌ Recording error");
            cleanup();
        };

        mediaRecorder.start(1000);
        updateToggleDisplay();
        startTimer();

        setupTabClosureDetection(currentTabId);

        chrome.storage.local.set({ isRecording: true, recordingStartTime });
        chrome.runtime.sendMessage({ action: "recordingStarted" });
        
        console.log("Recording is starting...");
        if (currentService === 'gmeet') {
            if (isAutoRecord) {
                broadcastToMeetTab("🔴 Auto Recording Started");
            } else {
                broadcastToMeetTab("🔴 Recording Started");
            }
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            console.log("🛑 Stopping recording...");
            if (currentService === 'gmeet') {
                broadcastToMeetTab("🟡 Stopping recording...");
            }
            mediaRecorder.stop();
        } else {
            console.log("⚠️ No active recording to stop");
        }
    }

    // ==================== MESSAGE LISTENER ====================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("📨 Recorder received:", message.action);

        const handleAsync = async () => {
            try {
                if (message.action === "startRecording") {
                    isAutoRecord = message.autoRecord || false;
                    currentTabId = message.tabId;
                    currentService = message.service || 'gmeet';
                    console.log("🎬 Starting recording, service:", currentService, "auto mode:", isAutoRecord, "tabId:", currentTabId);
                    await startRecording(message.tabId);
                    return { success: true };
                }
                else if (message.action === "stopRecording") {
                    if (message.forceAutoDownload) {
                        isAutoRecord = true;
                    }
                    console.log("🛑 Stopping recording");
                    stopRecording();
                    return { success: true };
                }
                else if (message.action === "healthCheck") {
                    return { 
                        status: "healthy", 
                        service: "recorder",
                        isRecording: isRecording,
                        chunksCount: recordedChunks.length
                    };
                }
                else {
                    return { success: false, reason: "unknown_action" };
                }
            } catch (error) {
                console.error("❌ Error handling message:", error);
                return { success: false, error: error.message };
            }
        };

        handleAsync().then(sendResponse);
        return true;
    });

    // ==================== EVENT LISTENERS ====================
    
    let userConfirmedLeave = false;

window.addEventListener('beforeunload', (event) => {
    if (isRecording && recordedChunks.length > 0) {
        if (isAutoRecord) {
            console.log("🤖 Auto-record: Closing recorder tab - auto-downloading recording");
            // For auto-record: proceed with download
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            
            event.preventDefault();
            event.returnValue = '';
            
            setTimeout(() => {
                downloadRecording();
            }, 500);
            
            return '';
        } else {
            // For manual recording: Show warning and wait for user decision
            console.log("🚨 Manual recording: Recorder tab closing warning");
            event.preventDefault();
            event.returnValue = 'Recording is in progress. Are you sure you want to leave?';
            
            // Set a flag to track user decision
            setTimeout(() => {
                // If we're still here after a short delay, user clicked "Cancel"
                userConfirmedLeave = false;
                console.log("✅ User clicked Cancel - continuing recording");
            }, 100);
            
            return event.returnValue;
        }
    }
});

window.addEventListener('unload', () => {
    // This only runs when user actually leaves the page
    if (isRecording && recordedChunks.length > 0) {
        console.log(`🚨 Tab closing - saving recording (Auto: ${isAutoRecord})`);
        
        if (recordedChunks.length > 0) {
            console.log("💾 Immediately downloading recording data before tab closes");
            
            // Use synchronous download approach
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
            const filename = `${currentService}-recording-${timestamp}.webm`;
            
            // Create and trigger download immediately
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Send completion message
            chrome.runtime.sendMessage({ action: "recordingCompleted" });
            
            console.log("✅ Recording downloaded before tab close");
        }

        // User confirmed they want to leave - save the recording
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log("🛑 Stopping media recorder for download");
            mediaRecorder.stop();
        } 
    }
});

    // Keep tab alive
    setInterval(() => { 
        if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer")?.textContent); 
    }, 30000);

    console.log("🎬 Unified Recorder initialized for:", currentService);
})();

/*
// UNIFIED RECORDER.JS - Google Meet & Microsoft Teams
(function() {
    'use strict';

    let mediaRecorder;
    let recordedChunks = [];
    let isRecording = false;
    let timerInterval;
    let recordingStartTime;
    let isAutoRecord = false;
    let originalAudioContext = null;
    let muteCheckInterval = null;
    let autoRecordEnabled = false;
    let globalMicStream = null; 
    let globalMicGainNode = null; 
    let currentTabId = null;
    let currentService = null;

    console.log("🎬 Unified Recorder tab loaded");

    // Service detection from URL parameters
    function detectService() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('service') || 'gmeet'; // Default to gmeet
    }

    // Initialize
    currentService = detectService();
    console.log(`🎬 Initializing recorder for: ${currentService}`);

    // ==================== COMMON FUNCTIONS ====================
    function safeSetStatus(message) {
        const statusElement = document.getElementById("status");
        if (statusElement) {
            statusElement.textContent = message;
        }
    }

    async function syncToggleState() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['autoRecordPermission'], (result) => {
                autoRecordEnabled = result.autoRecordPermission || false;
                console.log("🔄 Recorder: Auto record permission:", autoRecordEnabled);
                updateToggleDisplay();
                resolve(autoRecordEnabled);
            });
        });
    }

    function updateToggleDisplay() {
        const statusElement = document.getElementById("status");
        if (statusElement) {
            if (isRecording) {
                statusElement.textContent = autoRecordEnabled ? "🟢 Auto Recording..." : "🟢 Recording...";
            } else {
                statusElement.textContent = autoRecordEnabled ? "✅ Auto Record Enabled" : "✅ Ready to record...";
            }
        }
    }

    function setupTabClosureDetection(tabId) {
        const tabCheckInterval = setInterval(async () => {
            if (!isRecording) {
                clearInterval(tabCheckInterval);
                return;
            }
            
            try {
                const tab = await chrome.tabs.get(tabId);
                if (!tab) {
                    console.log("❌ Source tab closed - stopping recording");
                    stopRecording();
                    clearInterval(tabCheckInterval);
                }
            } catch (error) {
                console.log("❌ Source tab closed or inaccessible - stopping recording");
                stopRecording();
                clearInterval(tabCheckInterval);
            }
        }, 2000);
    }

    function startTimer() {
        let seconds = 0;
        const timerEl = document.getElementById("timer");
        if (!timerEl) return;
        
        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            seconds++;
            const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
            const secs = String(seconds % 60).padStart(2, "0");
            const timeStr = `${mins}:${secs}`;
            timerEl.textContent = timeStr;
            chrome.storage.local.set({ recordingTime: timeStr });
            chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
            
            // Broadcast timer update for Google Meet
            if (currentService === 'gmeet') {
                broadcastTimerUpdate(timeStr);
            }
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
    }

    function downloadRecording() {
        if (!recordedChunks.length) {
            console.error("❌ No recording data available");
            safeSetStatus("❌ No recording data");
            const message = isAutoRecord ? "❌ Auto Recording failed: No data" : "❌ Recording failed: No data";
            if (currentService === 'gmeet') {
                broadcastToMeetTab(message);
            }
            return;
        }

        console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
        const filename = `${currentService}-recording-${timestamp}.webm`;

        if (currentService === 'gmeet') {
            const stoppedMessage = isAutoRecord ? "🟡 Auto Recording Stopped" : "🟡 Recording Stopped";
            broadcastToMeetTab(stoppedMessage);
        }

        chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                console.log("✅ DOWNLOAD started with ID:", downloadId);
            }
            
            const downloadedMessage = isAutoRecord ? "✅ Auto Recording Downloaded" : "✅ Recording Downloaded";
            if (currentService === 'gmeet') {
                broadcastToMeetTab(downloadedMessage);
            }
            
            chrome.runtime.sendMessage({ action: "recordingCompleted" });
            safeSetStatus("✅ Recording Auto-Downloaded!");

            isRecording = false;

            console.log("🔒 Closing recorder tab in 2 seconds");
            setTimeout(() => {
                console.log("🔒 Closing recorder tab");
                window.close();
            }, 2000);
        });  
    }

    function comprehensiveCleanup() {
        console.log("🧹 Comprehensive cleanup started");
        
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log("🛑 Stopping media recorder");
            mediaRecorder.stop();
        }
        
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        
        if (muteCheckInterval) {
            clearInterval(muteCheckInterval);
            muteCheckInterval = null;
        }
        
        if (mediaRecorder?.stream) {
            mediaRecorder.stream.getTracks().forEach(track => {
                track.stop();
            });
        }
        
        if (globalMicStream) {
            globalMicStream.getTracks().forEach(track => {
                track.stop();
            });
            globalMicStream = null;
        }
        
        if (originalAudioContext) {
            originalAudioContext.close().catch(e => console.log("AudioContext close error:", e));
            originalAudioContext = null;
        }
        
        if (globalMicGainNode) {
            globalMicGainNode.disconnect();
            globalMicGainNode = null;
        }
        
        recordedChunks = [];
        isRecording = false;
        isAutoRecord = false;
        currentTabId = null;
        
        chrome.storage.local.set({ 
            isRecording: false,
            recordingStoppedByTabClose: true 
        }, () => {
            chrome.storage.local.remove(['recordingTime', 'recordingStartTime']);
            chrome.runtime.sendMessage({ action: "recordingStopped" });
        });             
        
        console.log("✅ Comprehensive cleanup completed");
    }

    function cleanup() {
        console.log("🧹 Standard cleanup started");
        
        if (isRecording && recordedChunks.length > 0) {
            comprehensiveCleanup();
        } else {
            stopTimer();
            if (muteCheckInterval) {
                clearInterval(muteCheckInterval);
                muteCheckInterval = null;
            }
            isRecording = false;
            console.log("✅ Standard cleanup completed");
        }
    }

    // ==================== GOOGLE MEET SPECIFIC ====================
    function broadcastToMeetTab(message, duration = 4000){
        chrome.runtime.sendMessage({
            action: "showMeetStatus", 
            message: message,
            duration: duration
        });
    }

    function broadcastTimerUpdate(timeStr) {
        chrome.runtime.sendMessage({
            action: "updateMeetTimer",
            time: timeStr
        });
    }

    async function getMuteStatus() {
        try {
            const response = await new Promise((resolve) => {
                chrome.tabs.sendMessage(currentTabId, { action: "getMuteStatus" }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ isMuted: true });
                    } else {
                        resolve(response || { isMuted: true });
                    }
                });
            });

            if (globalMicGainNode) {
                if (response.isMuted) {
                    globalMicGainNode.gain.value = 0;
                } else {
                    globalMicGainNode.gain.value = 1.0;
                }
            }
        } catch (error) {
            if (globalMicGainNode) globalMicGainNode.gain.value = 0;
        }
    }

    // ==================== RECORDING START ====================
    async function startRecording(tabId) {
        console.log(`🎬 Starting recording for ${currentService} tab:`, tabId);
        
        await syncToggleState();

        if (isRecording) {
            console.log("❌ Still recording from previous session - aborting");
            return;
        }

        try {
            if (isAutoRecord) {
                safeSetStatus("🟡 Auto recording starting...");
                if (currentService === 'gmeet') {
                    broadcastToMeetTab("🟡 Auto recording starting...");
                }
            } else {
                safeSetStatus("🟡 Starting recording...");
                if (currentService === 'gmeet') {
                    broadcastToMeetTab("🟡 Starting recording...");
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));

            const tab = await new Promise((resolve, reject) => {
                chrome.tabs.get(tabId, (tab) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(`Tab not accessible: ${chrome.runtime.lastError.message}`));
                    } else if (!tab) {
                        reject(new Error("Tab not found"));
                    } else {
                        resolve(tab);
                    }
                });
            });

            console.log("✅ Source tab validated:", tab.url);

            const tabStream = await new Promise((resolve, reject) => {
                chrome.tabCapture.capture({
                    audio: true,
                    video: true,
                    audioConstraints: {
                        mandatory: {
                            chromeMediaSource: 'tab',
                            chromeMediaSourceId: tabId.toString(), 
                        }
                    },
                    videoConstraints: {
                        mandatory: {
                            chromeMediaSource: 'tab',
                            chromeMediaSourceId: tabId.toString(), 
                            minWidth: 1280,
                            minHeight: 720,
                            maxWidth: 1920,
                            maxHeight: 1080,
                            maxFrameRate: 30
                        }
                    }
                }, (stream) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
                    } else if (!stream) {
                        reject(new Error("No tab stream returned - check activeTab permission"));
                    } else {
                        resolve(stream);
                    }
                });
            });

            console.log("✅ Tab stream captured. Audio tracks:", tabStream.getAudioTracks().length, 
                        "Video tracks:", tabStream.getVideoTracks().length);

            // Audio setup for Google Meet (with microphone mixing)
            if (currentService === 'gmeet') {
                await setupGmeetAudio(tabStream, tabId);
            } else {
                // Teams audio setup (simpler)
                await setupTeamsAudio(tabStream);
            }

        } catch (err) {
            console.error("❌ Recording start failed:", err);
            safeSetStatus("❌ Recording failed: " + err.message);
            if (currentService === 'gmeet') {
                broadcastToMeetTab("❌ Recording failed.");
            }
            cleanup();
        }
    }

    async function setupGmeetAudio(tabStream, tabId) {
        const audioContext = new AudioContext();
        const recordingDestination = audioContext.createMediaStreamDestination();
        
        const meetAudioSource = audioContext.createMediaStreamSource(
            new MediaStream(tabStream.getAudioTracks())
        );
        
        const splitter = audioContext.createChannelSplitter(2);
        const recordingMerger = audioContext.createChannelMerger(2);
        const playbackMerger = audioContext.createChannelMerger(2);
        
        meetAudioSource.connect(splitter);
        
        splitter.connect(playbackMerger, 0, 0);
        splitter.connect(playbackMerger, 1, 1);
        playbackMerger.connect(audioContext.destination);
        
        splitter.connect(recordingMerger, 0, 0);
        splitter.connect(recordingMerger, 1, 1);
        
        // Get microphone audio for recording
        try {
            console.log("🎤 Requesting microphone access...");
            globalMicStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            });

            console.log("✅ Microphone access granted");
            const micSource = audioContext.createMediaStreamSource(globalMicStream);
            
            globalMicGainNode = audioContext.createGain();
            micSource.connect(globalMicGainNode);
            
            globalMicGainNode.gain.value = 0;
            globalMicGainNode.connect(recordingMerger, 0, 0);
            globalMicGainNode.connect(recordingMerger, 0, 1);
            
        } catch (micError) {
            console.error("❌ Microphone access denied:", micError);
        }

        recordingMerger.connect(recordingDestination);
        
        // Mute detection for Google Meet
        const updateMicrophoneMute = async () => {
            await getMuteStatus();
        };

        muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
        updateMicrophoneMute();

        setupMediaRecorder(tabStream, recordingDestination.stream, audioContext);
    }

    async function setupTeamsAudio(tabStream) {
        let finalStream = tabStream;

        // Try to add microphone audio for Teams
        try {
            console.log("🎤 Attempting to capture microphone for Teams...");
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 44100,
                    channelCount: 2
                },
                video: false
            });

            console.log("✅ Microphone captured for Teams");

            const audioContext = new AudioContext({ sampleRate: 44100 });
            const destination = audioContext.createMediaStreamDestination();

            const tabAudioSource = audioContext.createMediaStreamSource(
                new MediaStream(tabStream.getAudioTracks())
            );
            const micAudioSource = audioContext.createMediaStreamSource(micStream);

            tabAudioSource.connect(destination);
            micAudioSource.connect(destination);

            finalStream = new MediaStream([
                ...tabStream.getVideoTracks(),
                ...destination.stream.getAudioTracks()
            ]);

            originalAudioContext = audioContext;
            console.log("✅ Audio mixed successfully for Teams");

        } catch (micError) {
            console.warn("⚠️ Microphone not available for Teams, using tab audio only:", micError);
            finalStream = tabStream;
        }

        setupMediaRecorder(finalStream, finalStream, originalAudioContext);
    }

    function setupMediaRecorder(videoStream, audioStream, audioContext) {
        const videoTrack = videoStream.getVideoTracks()[0];
        const audioTrack = audioStream.getAudioTracks()[0];

        // Track closure detection
        const sourceVideoTrack = videoStream.getVideoTracks()[0];
        const sourceAudioTrack = videoStream.getAudioTracks()[0];

        if (sourceVideoTrack) {
            sourceVideoTrack.onended = () => {
                console.log("❌ Source video track ended - meeting tab closed");
                if (isRecording) {
                    stopRecording();
                }
            };
        }

        if (sourceAudioTrack) {
            sourceAudioTrack.onended = () => {
                console.log("❌ Source audio track ended - meeting tab closed");
                if (isRecording) {
                    stopRecording();
                }
            };
        }

        if (!videoTrack) {
            throw new Error("No video track available from tab capture");
        }

        if (!audioTrack) {
            throw new Error("No audio track available after mixing");
        }

        const finalStream = new MediaStream([videoTrack, audioTrack]);
        console.log("✅ Final recording stream created");

        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus', 
            'video/webm;codecs=h264,opus',
            'video/webm'
        ];
        let supportedType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

        console.log("🎥 Using MIME type:", supportedType);

        mediaRecorder = new MediaRecorder(finalStream, {
            mimeType: supportedType,
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 128000
        });

        recordedChunks = [];
        isRecording = true;
        recordingStartTime = Date.now();
        originalAudioContext = audioContext;

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };

        mediaRecorder.onstop = () => {
            console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
            stopTimer();

            isRecording = false;

            if (currentService === 'gmeet') {
                if (isAutoRecord) {
                    broadcastToMeetTab("🟡 Auto Recording Stopped");
                } else {
                    broadcastToMeetTab("🟡 Recording Stopped");
                }
            }

            if (recordedChunks.length > 0) {
                downloadRecording();
            } else {
                safeSetStatus("❌ No recording data");
                if (currentService === 'gmeet') {
                    if (isAutoRecord) {
                        broadcastToMeetTab("❌ Auto Recording Failed - No data");
                    } else {
                        broadcastToMeetTab("❌ Recording Failed - No data");
                    }
                }
                cleanup();
            }
        };

        mediaRecorder.onerror = e => {
            console.error("❌ MediaRecorder error:", e);
            safeSetStatus("❌ Recording error");
            cleanup();
        };

        mediaRecorder.start(1000);
        updateToggleDisplay();
        startTimer();

        setupTabClosureDetection(currentTabId);

        chrome.storage.local.set({ isRecording: true, recordingStartTime });
        chrome.runtime.sendMessage({ action: "recordingStarted" });
        
        console.log("Recording is starting...");
        if (currentService === 'gmeet') {
            if (isAutoRecord) {
                broadcastToMeetTab("🔴 Auto Recording Started");
            } else {
                broadcastToMeetTab("🔴 Recording Started");
            }
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            console.log("🛑 Stopping recording...");
            if (currentService === 'gmeet') {
                broadcastToMeetTab("🟡 Stopping recording...");
            }
            mediaRecorder.stop();
        } else {
            console.log("⚠️ No active recording to stop");
        }
    }

    // ==================== MESSAGE LISTENER ====================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("📨 Recorder received:", message.action);

        const handleAsync = async () => {
            try {
                if (message.action === "startRecording") {
                    isAutoRecord = message.autoRecord || false;
                    currentTabId = message.tabId;
                    currentService = message.service || 'gmeet';
                    console.log("🎬 Starting recording, service:", currentService, "auto mode:", isAutoRecord, "tabId:", currentTabId);
                    await startRecording(message.tabId);
                    return { success: true };
                }
                else if (message.action === "stopRecording") {
                    if (message.forceAutoDownload) {
                        isAutoRecord = true;
                    }
                    console.log("🛑 Stopping recording");
                    stopRecording();
                    return { success: true };
                }
                else if (message.action === "healthCheck") {
                    return { 
                        status: "healthy", 
                        service: "recorder",
                        isRecording: isRecording,
                        chunksCount: recordedChunks.length
                    };
                }
                else {
                    return { success: false, reason: "unknown_action" };
                }
            } catch (error) {
                console.error("❌ Error handling message:", error);
                return { success: false, error: error.message };
            }
        };

        handleAsync().then(sendResponse);
        return true;
    });

    // ==================== EVENT LISTENERS ====================
    
    let userConfirmedLeave = false;

window.addEventListener('beforeunload', (event) => {
    if (isRecording && recordedChunks.length > 0) {
        if (isAutoRecord) {
            console.log("🤖 Auto-record: Closing recorder tab - auto-downloading recording");
            // For auto-record: proceed with download
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            
            event.preventDefault();
            event.returnValue = '';
            
            setTimeout(() => {
                downloadRecording();
            }, 500);
            
            return '';
        } else {
            // For manual recording: Show warning and wait for user decision
            console.log("🚨 Manual recording: Recorder tab closing warning");
            event.preventDefault();
            event.returnValue = 'Recording is in progress. Are you sure you want to leave?';
            
            // Set a flag to track user decision
            setTimeout(() => {
                // If we're still here after a short delay, user clicked "Cancel"
                userConfirmedLeave = false;
                console.log("✅ User clicked Cancel - continuing recording");
            }, 100);
            
            return event.returnValue;
        }
    }
});

window.addEventListener('unload', () => {
    // This only runs when user actually leaves the page
    if (isRecording && recordedChunks.length > 0) {
        console.log(`🚨 Tab closing - saving recording (Auto: ${isAutoRecord})`);
        
        if (recordedChunks.length > 0) {
            console.log("💾 Immediately downloading recording data before tab closes");
            
            // Use synchronous download approach
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').split('Z')[0];
            const filename = `${currentService}-recording-${timestamp}.webm`;
            
            // Create and trigger download immediately
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            // Send completion message
            chrome.runtime.sendMessage({ action: "recordingCompleted" });
            
            console.log("✅ Recording downloaded before tab close");
        }

        // User confirmed they want to leave - save the recording
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            console.log("🛑 Stopping media recorder for download");
            mediaRecorder.stop();
        } 
    }
});

    // Keep tab alive
    setInterval(() => { 
        if (isRecording) console.log("💓 Recorder alive -", document.getElementById("timer")?.textContent); 
    }, 30000);

    console.log("🎬 Unified Recorder initialized for:", currentService);
})();
*/