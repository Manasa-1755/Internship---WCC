// UNIVERSAL RECORDER.JS - Google Meet & Microsoft Teams
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
let downloadCompleted = false;

console.log("🎬 Universal Recorder tab loaded");

// ==================== SERVICE DETECTION & UI ====================

function detectServiceFromMessage(message) {
    return message.service || 'gmeet'; // Default to GMeet for backward compatibility
}

function updateServiceUI(service) {
    currentService = service;
    const indicator = document.getElementById("serviceIndicator");
    if (indicator) {
        const serviceNames = {
            'gmeet': 'Google Meet',
            'teams': 'Microsoft Teams'
        };
        indicator.textContent = `Recording: ${serviceNames[service] || service}`;
    }
}

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
            statusElement.textContent = autoRecordEnabled ? 
                "🟢 Auto Recording in background..." : 
                "🟢 Recording in background...";
        } else {
            statusElement.textContent = autoRecordEnabled ? 
                "✅ Auto Record Enabled" : 
                "✅ Ready to record...";
        }
    }
}

// ==================== MESSAGE HANDLER ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("📨 Recorder received:", message.action);

    const handleAsync = async () => {
        try {
            if (message.action === "startRecording") {
                isAutoRecord = message.autoRecord || false;
                currentTabId = message.tabId;
                currentService = detectServiceFromMessage(message);
                updateServiceUI(currentService);
                
                console.log(`🎬 Starting recording for ${currentService}, auto mode:`, isAutoRecord, "tabId:", currentTabId);
                await startRecording(message.tabId, currentService);
                sendResponse({ success: true });
            }
            else if (message.action === "stopRecording") {
                if (message.forceAutoDownload) {
                    isAutoRecord = true;
                }
                console.log("🛑 Stopping recording");
                stopRecording();
                sendResponse({ success: true });
            }
            else if (message.action === "checkRecorderStatus") {
                sendResponse({ 
                    status: isRecording ? "recording" : "idle",
                    service: currentService,
                    autoRecord: isAutoRecord
                });
            }
            else {
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

// Storage change listener for auto record permission
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.autoRecordPermission) {
        autoRecordEnabled = changes.autoRecordPermission.newValue;
        console.log("🔄 Recorder: Toggle state updated to:", autoRecordEnabled);
        updateToggleDisplay();
    }
});

// ==================== RECORDING CORE FUNCTIONS ====================

async function startRecording(tabId, service) {
    console.log(`🎬 Starting recording for ${service} tab:`, tabId);
    
    // Reset state to prevent conflicts
    if (isRecording) {
        console.log("⚠️ Already recording - stopping previous session");
        stopRecording();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await syncToggleState();

    if (isRecording) {
        console.log("❌ Still recording from previous session - aborting");
        return;
    }

    try {
        // Set initial status
        if (isAutoRecord) {
            safeSetStatus("🟡 Auto recording starting...");
        } else {
            safeSetStatus("🟡 Starting recording...");
        }

        // Add stability delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Validate tab exists
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

        // Capture tab stream
        const tabStream = await captureTabStream(tabId, service);
        
        // Setup audio mixing based on service
        const { finalStream, audioContext } = await setupAudioMixing(tabStream, tabId, service);
        
        // Setup recording
        await setupMediaRecorder(finalStream, audioContext, tabId, service);

        // Start monitoring
        setupTabClosureDetection(tabId);
        startTimer();

        // Save state and notify
        await chrome.storage.local.set({ isRecording: true, recordingStartTime });
        chrome.runtime.sendMessage({ action: "recordingStarted" });
        
        console.log(`✅ ${service} recording started successfully`);
        safeSetStatus(isAutoRecord ? "🟢 Auto Recording in background..." : "🟢 Recording in background...");

    } catch (err) {
        console.error("❌ Recording start failed:", err);
        safeSetStatus("❌ Recording failed: " + err.message);
        cleanup();
    }
}

async function captureTabStream(tabId, service) {
    return new Promise((resolve, reject) => {
        const constraints = {
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
        };

        chrome.tabCapture.capture(constraints, (stream) => {
            if (chrome.runtime.lastError) {
                reject(new Error(`Tab capture failed: ${chrome.runtime.lastError.message}`));
            } else if (!stream) {
                reject(new Error("No tab stream returned"));
            } else {
                console.log(`✅ ${service} tab stream captured. Audio tracks:`, stream.getAudioTracks().length, 
                          "Video tracks:", stream.getVideoTracks().length);
                resolve(stream);
            }
        });
    });
}

async function setupAudioMixing(tabStream, tabId, service) {
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    // Connect tab audio
    const tabAudioSource = audioContext.createMediaStreamSource(
        new MediaStream(tabStream.getAudioTracks())
    );
    tabAudioSource.connect(destination);

    // Add microphone for Teams or GMeet with mute detection
    if (service === 'teams' || service === 'gmeet') {
        try {
            console.log("🎤 Requesting microphone access...");
            globalMicStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: service === 'teams' ? 2 : 1
                },
                video: false
            });

            console.log("✅ Microphone access granted");
            const micSource = audioContext.createMediaStreamSource(globalMicStream);
            
            globalMicGainNode = audioContext.createGain();
            micSource.connect(globalMicGainNode);
            
            // Service-specific audio handling
            if (service === 'gmeet') {
                // GMeet: Mute detection and complex routing
                await setupGMeetAudioRouting(audioContext, tabAudioSource, globalMicGainNode, destination, tabId);
            } else {
                // Teams: Simple microphone mixing
                globalMicGainNode.gain.value = 1.0;
                globalMicGainNode.connect(destination);
            }
            
        } catch (micError) {
            console.warn("⚠️ Microphone not available:", micError);
        }
    }

    // Create final stream
    const videoTrack = tabStream.getVideoTracks()[0];
    const mixedAudioTrack = destination.stream.getAudioTracks()[0];

    if (!videoTrack) throw new Error("No video track available");
    if (!mixedAudioTrack) throw new Error("No audio track available after mixing");

    const finalStream = new MediaStream([videoTrack, mixedAudioTrack]);
    console.log("✅ Final recording stream created");

    return { finalStream, audioContext };
}

async function setupGMeetAudioRouting(audioContext, meetAudioSource, micGainNode, destination, tabId) {
    // GMeet-specific complex audio routing with mute detection
    const splitter = audioContext.createChannelSplitter(2);
    const recordingMerger = audioContext.createChannelMerger(2);
    const playbackMerger = audioContext.createChannelMerger(2);
    
    meetAudioSource.connect(splitter);
    
    // Playback path
    splitter.connect(playbackMerger, 0, 0);
    splitter.connect(playbackMerger, 1, 1);
    playbackMerger.connect(audioContext.destination);
    
    // Recording path
    splitter.connect(recordingMerger, 0, 0);
    splitter.connect(recordingMerger, 1, 1);
    
    // Microphone to recording
    micGainNode.gain.value = 0; // Start muted
    micGainNode.connect(recordingMerger, 0, 0);
    micGainNode.connect(recordingMerger, 0, 1);
    
    recordingMerger.connect(destination);

    // Mute detection for GMeet
    const updateMicrophoneMute = async () => {
        try {
            const response = await new Promise((resolve) => {
                chrome.tabs.sendMessage(tabId, { action: "getMuteStatus" }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ isMuted: true });
                    } else {
                        resolve(response || { isMuted: true });
                    }
                });
            });

            if (micGainNode) {
                if (response.isMuted) {
                    micGainNode.gain.value = 0;
                    console.log("🔇 Microphone muted in recording (Meet is muted)");
                } else {
                    micGainNode.gain.value = 1.0;
                    console.log("🎤 Microphone UNMUTED in recording (Meet is unmuted)");
                }
            }
        } catch (error) {
            console.log("⚠️ Could not check mute status, keeping microphone muted");
            if (micGainNode) micGainNode.gain.value = 0;
        }
    };

    // Check mute status every 2 seconds for GMeet
    muteCheckInterval = setInterval(updateMicrophoneMute, 2000);
    updateMicrophoneMute();
}

async function setupMediaRecorder(finalStream, audioContext, tabId, service) {
    // Choose MIME type
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
    downloadCompleted = false;

    mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) {
            recordedChunks.push(e.data);
            console.log("📦 Data chunk:", e.data.size, "bytes");
        }
    };

    mediaRecorder.onstop = () => {
        console.log("🛑 Recording stopped, total chunks:", recordedChunks.length);
        stopTimer();

        isRecording = false;

        if (recordedChunks.length > 0) {
            downloadRecording();
        } else {
            safeSetStatus("❌ No recording data");
            cleanup();
        }
    };

    mediaRecorder.onerror = e => {
        console.error("❌ MediaRecorder error:", e);
        safeSetStatus("❌ Recording error");
        cleanup();
    };

    // Track closure detection
    finalStream.getTracks().forEach(track => {
        track.onended = () => {
            console.log("❌ Source track ended - tab may be closed");
            if (isRecording) {
                stopRecording();
            }
        };
    });

    mediaRecorder.start(1000);
}

// ==================== TIMER & MONITORING ====================

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
        
        // Save time to storage
        chrome.storage.local.set({ recordingTime: timeStr });
        
        // Send timer update
        chrome.runtime.sendMessage({ action: "timerUpdate", time: timeStr });
        
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
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

// ==================== RECORDING CONTROL ====================

function stopRecording() {
    if (mediaRecorder && isRecording) {
        console.log("🛑 Stopping recording...");
        mediaRecorder.stop();
    } else {
        console.log("⚠️ No active recording to stop");
    }
}

function downloadRecording() {
    if (!recordedChunks.length) {
        console.error("❌ No recording data available");
        safeSetStatus("❌ No recording data");
        return;
    }

    console.log("💾 Preparing download, total data:", recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0), "bytes");

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .split('Z')[0];
    
    const filename = `${currentService}-recording-${timestamp}.webm`;

    safeSetStatus("💾 Downloading recording...");

    chrome.downloads.download({ 
        url: url, 
        filename: filename, 
        saveAs: false 
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.warn("⚠️ Chrome download failed, using fallback:", chrome.runtime.lastError);
            fallbackDownload(blob, filename);
        } else {
            console.log("✅ Download started with ID:", downloadId);
            downloadCompleted = true;
            safeSetStatus("✅ Recording saved to Downloads!");
            
            // Notify completion
            chrome.runtime.sendMessage({ action: "recordingCompleted" });
            
            // Auto-close for auto recordings
            if (isAutoRecord) {
                setTimeout(() => {
                    console.log("🔒 Closing recorder tab after successful download");
                    window.close();
                }, 2000);
            }
        }
    });
}

function fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    
    downloadCompleted = true;
    safeSetStatus("✅ Recording saved to Downloads!");
    chrome.runtime.sendMessage({ action: "recordingCompleted" });
    
    if (isAutoRecord) {
        setTimeout(() => {
            window.close();
        }, 2000);
    }
}

// ==================== CLEANUP & LIFECYCLE ====================

function cleanup() {
    console.log("🧹 Cleanup started");
    
    // Stop recording if active
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    // Clear intervals
    stopTimer();
    if (muteCheckInterval) {
        clearInterval(muteCheckInterval);
        muteCheckInterval = null;
    }
    
    // Stop media tracks
    if (mediaRecorder?.stream) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    
    if (globalMicStream) {
        globalMicStream.getTracks().forEach(track => track.stop());
        globalMicStream = null;
    }
    
    // Close audio context
    if (originalAudioContext) {
        originalAudioContext.close().catch(e => console.log("AudioContext close error:", e));
        originalAudioContext = null;
    }
    
    // Clean up gain node
    if (globalMicGainNode) {
        globalMicGainNode.disconnect();
        globalMicGainNode = null;
    }
    
    // Reset states
    recordedChunks = [];
    isRecording = false;
    isAutoRecord = false;
    currentTabId = null;
    
    // Clear storage
    chrome.storage.local.set({ isRecording: false }, () => {
        chrome.storage.local.remove(['recordingTime', 'recordingStartTime']);
        chrome.runtime.sendMessage({ action: "recordingStopped" });
    });
    
    console.log("✅ Cleanup completed");
}

// ==================== TAB CLOSURE HANDLING ====================

window.addEventListener('beforeunload', (event) => {
    if (isRecording && recordedChunks.length > 0 && !downloadCompleted) {
        console.log("⚠️ Tab closing during recording - ensuring download");
        
        // Stop recording and trigger download
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        
        // Prevent immediate closure
        event.preventDefault();
        event.returnValue = '';
        
        // Force download completion
        setTimeout(() => {
            if (recordedChunks.length > 0 && !downloadCompleted) {
                downloadRecording();
            }
        }, 500);
        
        return "Recording is being saved. Please wait...";
    }
});

// Keep-alive for long recordings
setInterval(() => {
    if (isRecording) {
        console.log("💓 Recorder tab keep-alive -", document.getElementById("timer")?.textContent);
    }
}, 30000);