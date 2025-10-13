// WORKING CODE - STATUS
let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for Meet tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => notifyAllMeetTabs(true));
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => notifyAllMeetTabs(false));
    sendResponse({ success: true });
  }
  
  if (message.action === "autoStartRecording") {
    if (userPermissionGranted) startRecordingForTab(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    stopAllRecordings();
    sendResponse({ success: true });
  }
  
  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
    return true;
  }

  // Close recorder tab for auto mode
  if (message.action === "closeRecorderTab") {
    console.log("🛑 Closing recorder tab for auto mode");
    closeAllRecorderTabs();
    sendResponse({ success: true });
  }

  // Stop recording when meeting ends (both modes) - WITH AUTO DOWNLOAD
if (message.action === "stopRecordingOnMeetingEnd") {
  console.log("🛑 Meeting ended - AUTO-DOWNLOADING recording");
  
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        // Force auto-download by setting isAutoRecord = true
        chrome.tabs.sendMessage(tab.id, { 
          action: "stopRecording",
          forceAutoDownload: true 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Recorder tab not responding");
          } else {
            console.log("✅ Auto-download command sent");
          }
        });
      });
    }
  });
  currentRecordingTab = null;
  sendResponse({ success: true });
}

// 🆕 NEW: Route status messages to active Meet tab
  if (message.action === "showMeetStatus" || message.action === "updateMeetTimer") {
    // Find all active Meet tabs and send the message
    chrome.tabs.query({ url: "https://*.meet.google.com/*" }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id !== sender.tab?.id) { // Don't send back to recorder tab
          chrome.tabs.sendMessage(tab.id, message);
        }
      });
    });
    sendResponse({ success: true });
  }

  return true;
});

// Close all recorder tabs
function closeAllRecorderTabs() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => {
      // Just send stop message, recorder will close itself after download
      chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
      console.log("✅ Stop message sent to recorder tab");
    });
  });
  currentRecordingTab = null;
}

// Notify all Meet tabs about permission change
function notifyAllMeetTabs(enabled) {
  chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

function startRecordingForTab(tabId) {
  if (currentRecordingTab) return;

  chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (recorderTab) => {
    const attemptStart = (retry = 0) => {
      chrome.tabs.sendMessage(recorderTab.id, { action: "startRecording", tabId, autoRecord: true }, (resp) => {
        if (chrome.runtime.lastError) {
          if (retry < 2) setTimeout(() => attemptStart(retry + 1), 1000);
          else console.error("❌ Failed to start recording");
        } else currentRecordingTab = tabId;
      });
    };
    setTimeout(() => attemptStart(), 1500);
  });
}

function stopAllRecordings() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        // 🆕 SEND STOP MESSAGE TO RECORDER TAB
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Recorder tab not responding, might be already closed");
          } else {
            console.log("✅ Stop message sent to recorder tab");
          }
        });
      });
    } else {
      console.log("⚠️ No recorder tabs found");
    }
  });
  currentRecordingTab = null;
}

// Stop recording if source tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) stopAllRecordings();
});

// Keep service worker alive
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);


/*
// WORKING CODE - 1
let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for Meet tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => notifyAllMeetTabs(true));
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => notifyAllMeetTabs(false));
    sendResponse({ success: true });
  }
  
  if (message.action === "autoStartRecording") {
    if (userPermissionGranted) startRecordingForTab(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    stopAllRecordings();
    sendResponse({ success: true });
  }
  
  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
    return true;
  }

  // Close recorder tab for auto mode
  if (message.action === "closeRecorderTab") {
    console.log("🛑 Closing recorder tab for auto mode");
    closeAllRecorderTabs();
    sendResponse({ success: true });
  }

  // Stop recording when meeting ends (both modes) - WITH AUTO DOWNLOAD
if (message.action === "stopRecordingOnMeetingEnd") {
  console.log("🛑 Meeting ended - AUTO-DOWNLOADING recording");
  
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        // Force auto-download by setting isAutoRecord = true
        chrome.tabs.sendMessage(tab.id, { 
          action: "stopRecording",
          forceAutoDownload: true 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Recorder tab not responding");
          } else {
            console.log("✅ Auto-download command sent");
          }
        });
      });
    }
  });
  currentRecordingTab = null;
  sendResponse({ success: true });
}

  return true;
});

// Close all recorder tabs
function closeAllRecorderTabs() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => {
      // Just send stop message, recorder will close itself after download
      chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
      console.log("✅ Stop message sent to recorder tab");
    });
  });
  currentRecordingTab = null;
}

// Notify all Meet tabs about permission change
function notifyAllMeetTabs(enabled) {
  chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

function startRecordingForTab(tabId) {
  if (currentRecordingTab) return;

  chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (recorderTab) => {
    const attemptStart = (retry = 0) => {
      chrome.tabs.sendMessage(recorderTab.id, { action: "startRecording", tabId, autoRecord: true }, (resp) => {
        if (chrome.runtime.lastError) {
          if (retry < 2) setTimeout(() => attemptStart(retry + 1), 1000);
          else console.error("❌ Failed to start recording");
        } else currentRecordingTab = tabId;
      });
    };
    setTimeout(() => attemptStart(), 1500);
  });
}

function stopAllRecordings() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        // 🆕 SEND STOP MESSAGE TO RECORDER TAB
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Recorder tab not responding, might be already closed");
          } else {
            console.log("✅ Stop message sent to recorder tab");
          }
        });
      });
    } else {
      console.log("⚠️ No recorder tabs found");
    }
  });
  currentRecordingTab = null;
}

// Stop recording if source tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) stopAllRecordings();
});

// Keep service worker alive
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

WORKING CODE - 1*/

/*
/// Background script - Message routing and tab detection
let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for tab updates to detect Meet pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
    
    // Check if user has given permission for auto recording
    chrome.storage.local.get(['autoRecordPermission'], (result) => {
      if (result.autoRecordPermission) {
        console.log("🎬 Auto recording permission granted - waiting for meeting join...");
        
        // Don't start recording immediately, wait for leave button to appear
        // The content script will handle this
      }
    });
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Handle permission messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    console.log("✅ User granted auto recording permission");
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => {
      // Notify all Meet tabs about permission change
      chrome.tabs.query({url: ["https://*.meet.google.com/*"]}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRecordPermission",
            enabled: true
          });
        });
      });
    });
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    console.log("❌ User revoked auto recording permission");
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => {
      // Notify all Meet tabs about permission change
      chrome.tabs.query({url: ["https://*.meet.google.com/*"]}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRecordPermission",
            enabled: false
          });
        });
      });
    });
    sendResponse({ success: true });
  }
  
  if (message.action === "getAutoRecordPermission") {
    sendResponse({ permission: userPermissionGranted });
  }

  if (message.action === "autoStartRecording") {
    console.log("🎬 Auto starting recording for tab:", sender.tab.id);
    startRecordingForTab(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    console.log("🛑 Auto stopping recording");
    stopAllRecordings();
    sendResponse({ success: true });
  }

  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, (response) => {
      sendResponse(response);
    });
    return true;
  }

  if (message.action === "recordingStarted") {
    console.log("✅ Recording started successfully");
    currentRecordingTab = sender.tab.id;
    sendResponse({ success: true });
  }

  if (message.action === "recordingStopped") {
    console.log("✅ Recording stopped successfully");
    currentRecordingTab = null;
    sendResponse({ success: true });
  }
  
  return true;
});

function startRecordingForTab(tabId) {
  if (currentRecordingTab) {
    console.log("⚠️ Already recording in tab:", currentRecordingTab);
    return;
  }

  console.log("🎬 Starting recording for Meet tab:", tabId);
  
  // Create a new tab for recording
  chrome.tabs.create({
    url: chrome.runtime.getURL("recorder.html"),
    active: false
  }, (recorderTab) => {
    console.log("✅ Recorder tab opened:", recorderTab.id);
    
    // Send tab ID to recorder after a delay
    const startRecording = (retryCount = 0) => {
      chrome.tabs.sendMessage(recorderTab.id, { 
        action: "startRecording", 
        tabId: tabId,
        autoRecord: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`❌ Recorder tab not ready (attempt ${retryCount + 1}/3), retrying...`);
          if (retryCount < 2) {
            setTimeout(() => startRecording(retryCount + 1), 1000);
          } else {
            console.error("❌ Failed to start recording after 3 attempts");
          }
        } else {
          console.log("✅ Recording started successfully");
          currentRecordingTab = tabId;
        }
      });
    };
    
    setTimeout(() => startRecording(), 1500);
  });
}

function stopAllRecordings() {
  console.log("🛑 Stopping all recordings");
  
  // Find and stop all recorder tabs
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
      });
    } else {
      console.log("⚠️ No recorder tabs found");
    }
  });
  
  currentRecordingTab = null;
}

// Monitor tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) {
    console.log("🛑 Recording source tab closed - stopping recording");
    stopAllRecordings();
  }
});

// Keep service worker alive
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 20000);

*/

/*
let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for Meet tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => notifyAllMeetTabs(true));
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => notifyAllMeetTabs(false));
    sendResponse({ success: true });
  }
  
  if (message.action === "autoStartRecording") {
    if (userPermissionGranted) startRecordingForTab(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    stopAllRecordings();
    sendResponse({ success: true });
  }
  
  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
    return true;
  }

  return true;
});

// Notify all Meet tabs about permission change
function notifyAllMeetTabs(enabled) {
  chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

function startRecordingForTab(tabId) {
  if (currentRecordingTab) return;

  chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (recorderTab) => {
    const attemptStart = (retry = 0) => {
      chrome.tabs.sendMessage(recorderTab.id, { action: "startRecording", tabId, autoRecord: true }, (resp) => {
        if (chrome.runtime.lastError) {
          if (retry < 2) setTimeout(() => attemptStart(retry + 1), 1000);
          else console.error("❌ Failed to start recording");
        } else currentRecordingTab = tabId;
      });
    };
    setTimeout(() => attemptStart(), 1500);
  });
}

function stopAllRecordings() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }));
  });
  currentRecordingTab = null;
}

// Stop recording if source tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) stopAllRecordings();
});

// Keep service worker alive
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
*/

/*
let userPermissionGranted = false;
let currentRecordingTab = null;

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for Meet tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isMeetTab(tab.url)) {
    console.log("✅ Meet tab detected:", tabId, tab.url);
  }
});

function isMeetTab(url) {
  return url && (url.includes("meet.google.com/"));
}

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action);
  
  if (message.action === "grantAutoRecordPermission") {
    userPermissionGranted = true;
    chrome.storage.local.set({ autoRecordPermission: true }, () => notifyAllMeetTabs(true));
    sendResponse({ success: true });
  }
  
  if (message.action === "revokeAutoRecordPermission") {
    userPermissionGranted = false;
    chrome.storage.local.set({ autoRecordPermission: false }, () => notifyAllMeetTabs(false));
    sendResponse({ success: true });
  }
  
  if (message.action === "autoStartRecording") {
    if (userPermissionGranted) startRecordingForTab(sender.tab.id);
    sendResponse({ success: true });
  }

  if (message.action === "autoStopRecording") {
    stopAllRecordings();
    sendResponse({ success: true });
  }
  
  if (message.action === "checkMeetingStatus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
    return true;
  }

  return true;
});

// Notify all Meet tabs about permission change
function notifyAllMeetTabs(enabled) {
  chrome.tabs.query({ url: ["https://*.meet.google.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

function startRecordingForTab(tabId) {
  if (currentRecordingTab) return;

  chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html"), active: false }, (recorderTab) => {
    const attemptStart = (retry = 0) => {
      chrome.tabs.sendMessage(recorderTab.id, { action: "startRecording", tabId, autoRecord: true }, (resp) => {
        if (chrome.runtime.lastError) {
          if (retry < 2) setTimeout(() => attemptStart(retry + 1), 1000);
          else console.error("❌ Failed to start recording");
        } else currentRecordingTab = tabId;
      });
    };
    setTimeout(() => attemptStart(), 1500);
  });
}

function stopAllRecordings() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: "stopRecording" }));
  });
  currentRecordingTab = null;
}

// Stop recording if source tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) stopAllRecordings();
});

// Keep service worker alive
setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

*/



