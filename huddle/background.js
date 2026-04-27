// Background script - stores huddle timing data

let huddleStartTime = null;
let huddleEndTime = null;
let huddleDuration = null;
let isRecording = false;

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received:", message.action);
    
    if (message.action === "huddleStarted") {
        huddleStartTime = message.startTime;
        huddleEndTime = null;
        huddleDuration = null;
        
        chrome.storage.local.set({
            huddleStartTime: huddleStartTime,
            huddleEndTime: null,
            huddleDuration: null,
            isInHuddle: true
        });
        
        console.log("📅 Huddle started:", new Date(huddleStartTime).toLocaleTimeString());
        sendResponse({ success: true });
    }
    
    else if (message.action === "huddleEnded") {
        huddleEndTime = message.endTime;
        huddleDuration = message.duration;
        
        chrome.storage.local.set({
            huddleEndTime: huddleEndTime,
            huddleDuration: huddleDuration,
            isInHuddle: false
        });
        
        console.log("📅 Huddle ended:", new Date(huddleEndTime).toLocaleTimeString());
        console.log("⏱️ Duration:", huddleDuration);
        sendResponse({ success: true });
    }
    
    else if (message.action === "getHuddleData") {
        sendResponse({
            startTime: huddleStartTime,
            endTime: huddleEndTime,
            duration: huddleDuration,
            isInHuddle: huddleStartTime !== null && huddleEndTime === null,
            isRecording: isRecording
        });
    }
    
    else if (message.action === "setRecordingStatus") {
        isRecording = message.isRecording;
        chrome.storage.local.set({ isRecording: isRecording });
        sendResponse({ success: true });
    }
    
    else if (message.action === "getRecordingStatus") {
        sendResponse({ isRecording: isRecording });
    }
    
    return true;
});

// Load saved data on startup
chrome.storage.local.get(['huddleStartTime', 'huddleEndTime', 'huddleDuration', 'isInHuddle', 'isRecording'], (result) => {
    if (result.huddleStartTime) {
        huddleStartTime = result.huddleStartTime;
        console.log("Loaded start time:", new Date(huddleStartTime).toLocaleTimeString());
    }
    if (result.huddleEndTime) {
        huddleEndTime = result.huddleEndTime;
        console.log("Loaded end time:", new Date(huddleEndTime).toLocaleTimeString());
    }
    if (result.huddleDuration) {
        huddleDuration = result.huddleDuration;
        console.log("Loaded duration:", huddleDuration);
    }
    if (result.isRecording) {
        isRecording = result.isRecording;
        console.log("Recording was in progress");
    }
});

console.log("✅ Huddle Tracker background loaded");