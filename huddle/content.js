// Content script - detects huddle start and end

(function() {
    'use strict';

    let isHuddleActive = false;
    let startTime = null;

    console.log("🔍 Huddle Tracker content script loaded");

    // Detect if user is in a huddle (works even when minimized)
    function detectHuddleState() {
        // Look for active huddle indicators
        const micButton = document.querySelector('[aria-label*="microphone" i][aria-pressed="true"], [aria-label*="Mic" i][aria-pressed="true"]');
        const activeCall = document.querySelector('[data-call-state="active"], .EbbCjc, [jsname="activeCall"]');
        const leaveBtn = document.querySelector('[aria-label*="Leave" i][aria-label*="huddle" i], [aria-label*="Exit" i]');
        
        return !!(micButton || activeCall || leaveBtn);
    }

    // Check and log huddle state changes
    function checkHuddleState() {
        const currentlyActive = detectHuddleState();
        
        if (currentlyActive && !isHuddleActive) {
            // Huddle just started
            isHuddleActive = true;
            startTime = new Date();
            
            console.log(`\n${"=".repeat(50)}`);
            console.log(`🎤 HUDDLE STARTED`);
            console.log(`📅 Date: ${startTime.toDateString()}`);
            console.log(`⏰ Time: ${startTime.toLocaleTimeString()}`);
            console.log(`🕐 Timestamp: ${startTime.getTime()}`);
            console.log(`${"=".repeat(50)}\n`);
            
            // Send to background
            chrome.runtime.sendMessage({
                action: "huddleStarted",
                startTime: startTime.getTime()
            });
            
        } else if (!currentlyActive && isHuddleActive) {
            // Huddle just ended
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const minutes = Math.floor(durationMs / 60000);
            const seconds = Math.floor((durationMs % 60000) / 1000);
            const durationString = `${minutes}m ${seconds}s`;
            
            console.log(`\n${"=".repeat(50)}`);
            console.log(`🔴 HUDDLE ENDED`);
            console.log(`📅 Date: ${endTime.toDateString()}`);
            console.log(`⏰ Start: ${startTime.toLocaleTimeString()}`);
            console.log(`⏰ End: ${endTime.toLocaleTimeString()}`);
            console.log(`⏱️ Duration: ${durationString} (${(durationMs/1000).toFixed(1)} seconds)`);
            console.log(`${"=".repeat(50)}\n`);
            
            // Send to background
            chrome.runtime.sendMessage({
                action: "huddleEnded",
                startTime: startTime.getTime(),
                endTime: endTime.getTime(),
                duration: durationString,
                durationMs: durationMs
            });
            
            isHuddleActive = false;
            startTime = null;
        }
    }

    // Set up interval to check huddle state every second
    setInterval(checkHuddleState, 1000);
    
    // Also watch for DOM changes
    const observer = new MutationObserver(() => checkHuddleState());
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-label', 'aria-pressed']
    });
    
    console.log("✅ Huddle Tracker active - Watching for huddles (even when minimized)");
    console.log("💡 Open a huddle to see start/end times and duration in console");
    
    // Initial check
    setTimeout(checkHuddleState, 2000);
})();