// Background script - stores huddle timing data

let huddleStartTime = null;
let huddleEndTime = null;
let huddleDuration = null;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received:", message.action);
    
    if (message.action === "huddleStarted") {
        huddleStartTime = message.startTime;
        huddleEndTime = null;
        huddleDuration = null;
        
        // Save to storage
        chrome.storage.local.set({
            huddleStartTime: huddleStartTime,
            huddleEndTime: null,
            huddleDuration: null,
            isInHuddle: true
        });
        
        console.log("📅 Huddle started saved:", new Date(huddleStartTime).toLocaleTimeString());
        sendResponse({ success: true });
    }
    
    else if (message.action === "huddleEnded") {
        huddleEndTime = message.endTime;
        huddleDuration = message.duration;
        
        // Save to storage
        chrome.storage.local.set({
            huddleEndTime: huddleEndTime,
            huddleDuration: huddleDuration,
            isInHuddle: false
        });
        
        console.log("📅 Huddle ended saved:", new Date(huddleEndTime).toLocaleTimeString());
        console.log("⏱️ Duration:", huddleDuration);
        sendResponse({ success: true });
    }
    
    else if (message.action === "getHuddleData") {
        sendResponse({
            startTime: huddleStartTime,
            endTime: huddleEndTime,
            duration: huddleDuration,
            isInHuddle: huddleStartTime !== null && huddleEndTime === null
        });
    }
    
    return true;
});

// Load saved data on startup
chrome.storage.local.get(['huddleStartTime', 'huddleEndTime', 'huddleDuration', 'isInHuddle'], (result) => {
    if (result.huddleStartTime) {
        huddleStartTime = result.huddleStartTime;
        console.log("Loaded saved start time:", new Date(huddleStartTime).toLocaleTimeString());
    }
    if (result.huddleEndTime) {
        huddleEndTime = result.huddleEndTime;
        console.log("Loaded saved end time:", new Date(huddleEndTime).toLocaleTimeString());
    }
    if (result.huddleDuration) {
        huddleDuration = result.huddleDuration;
        console.log("Loaded saved duration:", huddleDuration);
    }
});

console.log("✅ Huddle Tracker background loaded");