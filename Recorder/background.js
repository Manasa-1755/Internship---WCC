// UNIFIED BACKGROUND SCRIPT - Handles both Google Meet and Microsoft Teams

let userPermissionGranted = false;
let currentRecordingTab = null;
let isAutoRecording = false;
let autoStartTimeout = null;

// Platform detection functions
function isGMeetTab(url) {
  return url && url.includes("meet.google.com");
}

function isTeamsTab(url) {
  return url && (url.includes("teams.microsoft.com") || url.includes("teams.live.com"));
}

function getPlatform(tab) {
  if (!tab.url) return null;
  if (isGMeetTab(tab.url)) return 'gmeet';
  if (isTeamsTab(tab.url)) return 'teams';
  return null;
}

// Load saved permission state
chrome.storage.local.get(['autoRecordPermission'], (result) => {
  userPermissionGranted = result.autoRecordPermission || false;
  console.log("🔐 Auto record permission:", userPermissionGranted);
});

// Listen for tab updates to detect both platforms
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    const platform = getPlatform(tab);
    
    if (platform === 'gmeet') {
      console.log("✅ Google Meet tab detected:", tabId, tab.url);
      handleGMeetTabDetection(tabId);
    } else if (platform === 'teams') {
      console.log("✅ Microsoft Teams tab detected:", tabId, tab.url);
      handleTeamsTabDetection(tabId);
    }
  }
});

// GMeet-specific detection logic
function handleGMeetTabDetection(tabId) {
  // GMeet auto-recording logic can go here
  console.log("🔍 Monitoring Google Meet tab for meeting start...");
}

// Teams-specific detection logic  
function handleTeamsTabDetection(tabId) {
  // Check if user has given permission for auto recording
  chrome.storage.local.get(['autoRecordPermission'], (result) => {
    if (result.autoRecordPermission) {
      console.log("🎬 Auto recording enabled - Waiting for Join button click...");
      
      // Wait for content script to initialize
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: "checkMeetingStatus" }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("⚠️ Teams content script not ready yet, will detect meeting when Join button is clicked");
            return;
          }
          
          if (response && response.isInMeeting && !response.recording) {
            console.log("✅ Teams meeting already in progress - starting auto recording");
            startRecordingForTab(tabId, 'teams');
          }
        });
      }, 3000);
    }
  });
}

// Unified message handling for both platforms
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Background received:", message.action, "from:", sender.tab?.url);
  
  const handleAsync = async () => {
    try {
      const platform = getPlatform(sender.tab);
      
      // Handle platform-agnostic messages first
      if (message.action === "grantAutoRecordPermission") {
        userPermissionGranted = true;
        await chrome.storage.local.set({ autoRecordPermission: true });
        notifyAllTabs(true, platform);
        console.log("✅ Auto record permission granted for all platforms");
        sendResponse({ success: true });
      }
      
      else if (message.action === "revokeAutoRecordPermission") {
        userPermissionGranted = false;
        await chrome.storage.local.set({ autoRecordPermission: false });
        notifyAllTabs(false, platform);
        console.log("❌ Auto record permission revoked for all platforms");
        sendResponse({ success: true });
      }

      else if (message.action === "getAutoRecordPermission") {
        sendResponse({ permission: userPermissionGranted });
      }

      // Platform-specific auto-start recording
      else if (message.action === "autoStartRecording") {
        const platform = getPlatform(sender.tab);
        console.log(`🎬 Auto-start recording requested for ${platform} from tab:`, sender.tab?.id);
        
        if (platform === 'gmeet') {
          await handleGMeetAutoStart(sender.tab.id);
        } else if (platform === 'teams') {
          await handleTeamsAutoStart(sender.tab.id);
        }
        
        sendResponse({ success: true });
      }

      // Platform-specific auto-stop recording
      else if (message.action === "autoStopRecording") {
        const platform = getPlatform(sender.tab);
        console.log(`🛑 Auto-stop recording requested for ${platform} from tab:`, sender.tab?.id);
        stopAllRecordings();
        sendResponse({ success: true });
      }

      // Recording lifecycle events
      else if (message.action === "recordingStarted") {
        currentRecordingTab = sender.tab.id;
        await chrome.storage.local.set({ 
          isRecording: true,
          recordingStartTime: Date.now(),
          recordingTabId: sender.tab.id
        });
        sendResponse({ success: true });
      }

      else if (message.action === "recordingStopped" || message.action === "recordingCompleted") {
        currentRecordingTab = null;
        isAutoRecording = false;
        await chrome.storage.local.remove(['isRecording', 'recordingTime', 'recordingStartTime', 'recordingTabId']);
        
        // Close recorder tabs after a delay
        setTimeout(() => {
          closeAllRecorderTabs();
        }, 1000);
        
        sendResponse({ success: true });
      }

      // Health check and utility functions
      else if (message.action === "healthCheck") {
        console.log("❤️ Background health check received");
        sendResponse({ status: "healthy", service: "background", platform: getPlatform(sender.tab) });
      }

      else if (message.action === "checkMeetingStatus") {
        chrome.tabs.sendMessage(sender.tab.id, { action: "checkMeetingStatus" }, sendResponse);
        return true;
      }

      else if (message.action === "getBackgroundState") {
        sendResponse({
          currentRecordingTab: currentRecordingTab,
          isAutoRecording: isAutoRecording,
          userPermissionGranted: userPermissionGranted,
          platform: getPlatform(sender.tab)
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

// GMeet-specific auto-start logic
async function handleGMeetAutoStart(tabId) {
  if (!userPermissionGranted) {
    console.log("❌ Auto recording denied - no permission");
    return;
  }

  // Reset states before auto-start
  currentRecordingTab = null;
  isAutoRecording = false;

  await chrome.storage.local.set({ 
    isRecording: false,
    recordingStoppedByTabClose: true 
  });

  console.log("✅ Starting auto recording for GMeet tab:", tabId);
  currentRecordingTab = tabId;
  isAutoRecording = true;

  // Start recording with 2 second delay
  setTimeout(() => {
    startRecordingForTab(tabId, 'gmeet');
  }, 2000);
}

// Teams-specific auto-start logic
async function handleTeamsAutoStart(tabId) {
  console.log("✅ Starting auto recording for Teams tab:", tabId);
  startRecordingForTab(tabId, 'teams');
}

// Unified recording start function
function startRecordingForTab(tabId, platform) {
  if (currentRecordingTab) {
    console.log("⚠️ Already recording in tab:", currentRecordingTab);
    return;
  }

  console.log(`🎬 Creating recorder tab for ${platform} recording...`);
  
  // Validate the tab exists and is accessible
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      console.error("❌ Source tab not found or inaccessible:", chrome.runtime.lastError);
      currentRecordingTab = null;
      isAutoRecording = false;
      return;
    }
    
    // Verify it's the correct platform
    const tabPlatform = getPlatform(tab);
    if (tabPlatform !== platform) {
      console.error(`❌ Source tab platform mismatch: expected ${platform}, got ${tabPlatform}`);
      currentRecordingTab = null;
      isAutoRecording = false;
      return;
    }
    
const recorderPath = platform === 'gmeet' ? 'platforms/gmeet/recorder.html' : 'platforms/teams/recorder.html';
chrome.tabs.create({ url: chrome.runtime.getURL(recorderPath), active: false }, (recorderTab) => {
      console.log("✅ Recorder tab created:", recorderTab.id);
      
      const attemptStart = (retry = 0) => {
        console.log(`🔄 Attempting to start ${platform} recording (attempt ${retry + 1})...`);
        
        chrome.tabs.sendMessage(recorderTab.id, { 
          action: "startRecording", 
          tabId: tabId, 
          autoRecord: true,
          platform: platform
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`⚠️ Recorder not ready: ${chrome.runtime.lastError.message}`);
            if (retry < 3) {
              console.log(`🔄 Retrying in 1.5 seconds... (${retry + 1}/3)`);
              setTimeout(() => attemptStart(retry + 1), 1500);
            } else {
              console.error("❌ Failed to start recording after 3 attempts");
              currentRecordingTab = null;
              isAutoRecording = false;
              // Clean up the recorder tab
              chrome.tabs.remove(recorderTab.id);
            }
          } else {            
            currentRecordingTab = tabId;
            isAutoRecording = true;
            console.log(`✅ ${platform} recording started successfully`);
          }
        });
      };
      
      // Wait before first attempt
      setTimeout(() => attemptStart(), platform === 'gmeet' ? 2000 : 1500);
    });
  });
}

// Unified functions
function stopAllRecordings() {
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
}

function closeAllRecorderTabs() {
  chrome.tabs.query({ url: chrome.runtime.getURL("recorder.html") }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.remove(tab.id);
      console.log(`✅ Closed recorder tab: ${tab.id}`);
    });
  });
}

function notifyAllTabs(enabled, platform = null) {
  const urls = [];
  if (!platform || platform === 'gmeet') {
    urls.push("https://*.meet.google.com/*");
  }
  if (!platform || platform === 'teams') {
    urls.push("https://*.teams.microsoft.com/*", "https://*.teams.live.com/*");
  }
  
  chrome.tabs.query({ url: urls }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: "updateAutoRecordPermission",
        enabled: enabled
      });
    });
  });
}

// Monitor tab closures
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentRecordingTab) {
    console.log("❌ Recording source tab closed - stopping recording");
    stopAllRecordings();
  }
});

// Keep service worker alive
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {});
}, 20000);

console.log("🔧 Unified Background script loaded successfully");
console.log("📋 Supported platforms: Google Meet, Microsoft Teams");