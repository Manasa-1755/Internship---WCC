// recorder.js - Handles recording with native screen picker

let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let isRecordingActive = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Recorder received:", message.action);
    
    if (message.action === "startRecording") {
        startRecordingWithPicker()
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (message.action === "stopRecording") {
        stopRecording();
        sendResponse({ success: true });
    }
});

async function startRecordingWithPicker() {
    try {
        console.log("Opening Chrome screen picker...");
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                sampleRate: 48000
            },
            systemAudio: "include"
        });
        
        recordingStream = stream;
        recordedChunks = [];
        
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length === 0) {
            throw new Error("No video source selected");
        }
        
        const mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 128000
        });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            downloadRecording();
            cleanup();
        };
        
        mediaRecorder.start(1000);
        isRecordingActive = true;
        
        console.log("🎥 Recording started");
        showRecordingIndicator();
        
        // Handle user stopping via browser UI
        stream.getVideoTracks()[0].onended = () => {
            if (isRecordingActive) {
                stopRecording();
                chrome.runtime.sendMessage({ action: "recordingStoppedByUser" });
            }
        };
        
    } catch (error) {
        console.error("Recording error:", error);
        if (error.name === 'NotAllowedError') {
            throw new Error("Permission denied. Please allow screen sharing.");
        } else if (error.name === 'AbortError') {
            throw new Error("Screen capture cancelled.");
        } else {
            throw new Error(error.message);
        }
    }
}

function stopRecording() {
    if (mediaRecorder && isRecordingActive && mediaRecorder.state !== 'inactive') {
        try {
            mediaRecorder.stop();
            isRecordingActive = false;
        } catch (e) {
            console.error("Error stopping recorder:", e);
        }
        hideRecordingIndicator();
        console.log("⏹️ Recording stopped");
    }
}

function cleanup() {
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
}

function downloadRecording() {
    if (recordedChunks.length === 0) {
        console.log("No recording data");
        return;
    }
    
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `huddle_recording_${timestamp}.webm`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);
    
    console.log(`📹 Saved: ${filename}`);
    recordedChunks = [];
}

function showRecordingIndicator() {
    hideRecordingIndicator();
    const indicator = document.createElement('div');
    indicator.id = 'huddle-recording-indicator';
    indicator.innerHTML = `
        <div style="position:fixed;top:10px;right:10px;z-index:999999;background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:20px;font-size:14px;display:flex;align-items:center;gap:8px;pointer-events:none">
            <div style="width:12px;height:12px;background:#ff4444;border-radius:50%;animation:pulse-rec 1s infinite"></div>
            <span>🔴 Recording...</span>
        </div>
        <style>@keyframes pulse-rec{0%{opacity:1}50%{opacity:0.3}100%{opacity:1}}</style>
    `;
    document.body.appendChild(indicator);
}

function hideRecordingIndicator() {
    const indicator = document.getElementById('huddle-recording-indicator');
    if (indicator) indicator.remove();
}