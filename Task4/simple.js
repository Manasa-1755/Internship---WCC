function simple_fill() {
  const textarea = document.querySelector('textarea[data-testid="prompt-input-textarea"]');
  const button = document.querySelector('button[data-testid="create-button"]');

  if (!textarea || !button) {
    console.error("❌ Prompt box or Create button not found!");
    return;
  }

  const prompt = "Create a jazz-style song in the style of the Tamil music director Harris Jayaraj";
  

  textarea.value = prompt;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  // Start observing before triggering song creation
  observeNewSong((song) => {
    console.log("🎵 New song detected:", song);
  });

  button.click();
}

// Detects a newly added song and gets its title + lyrics
function observeNewSong(callback) {
  const observerTarget = document.querySelector('.react-aria-GridList');
  if (!observerTarget) {
    console.error("❌ Song list container not found!");
    return;
  }

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.classList.contains('react-aria-GridListItem')) {
          console.log("📀 New song row detected");

          const poll = setInterval(() => {
            const titleSpan = node.querySelector('span.line-clamp-1[title]');
            const lyricsDiv = node.querySelector('div[data-testid="lyrics"]');
            const title = titleSpan?.getAttribute('title') || '';
            const lyrics = lyricsDiv?.innerText || '';

            if (title && title !== "Untitled") {
              callback({ title, lyrics });
              clearInterval(poll);
              observer.disconnect();
            }
          }, 200);
        }
      });
    }
  });

  observer.observe(observerTarget, { childList: true, subtree: true });
}

// Run
simple_fill();
