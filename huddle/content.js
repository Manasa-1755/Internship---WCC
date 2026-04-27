// Content script - detects huddle start and end

(function() {
    'use strict';

    let isHuddleActive = false;
    let startTime = null;

    console.log("🔍 Huddle Tracker content script loaded");

    function detectHuddleState() {
        // Google Meet / Huddle detection
        const leaveCallBtn = document.querySelector('[aria-label="Leave call"], button[aria-label*="Leave"], [jsname="CQylAd"]');
        const callControls = document.querySelector('[aria-label="Call controls"], .R5ccN');
        const videoTiles = document.querySelector('.dkjMxf, .i8wGAe, [data-participant-id]');
        const micInCall = document.querySelector('[jsname="hw0c9"], [aria-label*="Microphone"]');
        const endCallIcon = document.querySelector('[class*="call_end"], [data-icon="call_end"]');
        
        return !!(leaveCallBtn || callControls || (videoTiles && micInCall) || endCallIcon);
    }

    function checkHuddleState() {
        const currentlyActive = detectHuddleState();
        
        if (currentlyActive && !isHuddleActive) {
            isHuddleActive = true;
            startTime = new Date();
            
            console.log(`\n${"=".repeat(50)}`);
            console.log(`🎤 HUDDLE STARTED`);
            console.log(`📅 ${startTime.toDateString()} at ${startTime.toLocaleTimeString()}`);
            console.log(`${"=".repeat(50)}\n`);
            
            chrome.runtime.sendMessage({
                action: "huddleStarted",
                startTime: startTime.getTime()
            });
            
        } else if (!currentlyActive && isHuddleActive) {
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const minutes = Math.floor(durationMs / 60000);
            const seconds = Math.floor((durationMs % 60000) / 1000);
            const durationString = `${minutes}m ${seconds}s`;
            
            console.log(`\n${"=".repeat(50)}`);
            console.log(`🔴 HUDDLE ENDED`);
            console.log(`⏱️ Duration: ${durationString}`);
            console.log(`${"=".repeat(50)}\n`);
            
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

    setInterval(checkHuddleState, 1000);
    
    const observer = new MutationObserver(() => checkHuddleState());
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'aria-label']
    });
    
    console.log("✅ Huddle Tracker active - Watching for Google Meet huddles");
    
    setTimeout(checkHuddleState, 2000);
})();