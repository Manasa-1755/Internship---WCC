/**
function custom_fill() {
  const lyricsBox = document.querySelector('textarea[data-testid="lyrics-input-textarea"]');
  const styleBox = document.querySelector('textarea[data-testid="tag-input-textarea"]');
  const titleBox = document.querySelector('input[placeholder="Enter song title"]');
  const createBtn = document.querySelector('button[data-testid="create-button"]');

  if (!lyricsBox || !styleBox || !titleBox || !createBtn) {
    console.error("❌ One or more fields/buttons not found!");
    return;
  }

  const lyrics = "Under neon skies, we run through midnight streets, chasing dreams that never sleep.";
  const style = "Synthwave";
  const title = "Neon Skies";

  function fillReactInput(el, value) {
    const setter = Object.getOwnPropertyDescriptor(el._proto_, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  fillReactInput(lyricsBox, lyrics);
  fillReactInput(styleBox, style);
  fillReactInput(titleBox, title);

  const check = setInterval(() => {
    if (!createBtn.disabled) {
      clearInterval(check);
      createBtn.click();
    }
  }, 100);
}

custom_fill();
**/

//---------------------------------------------------------------------------------------------------



// Helper to set a value in a React-controlled input/textarea
function setReactValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Observe new song in the list
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

          // Poll until title appears
          const poll = setInterval(() => {
            const titleSpan = node.querySelector('span.line-clamp-1[title]');
            const title = titleSpan?.getAttribute('title') || '';

            // Get the lyrics directly from the creation textarea
            const lyricsBox = document.querySelector('textarea[data-testid="lyrics-input-textarea"]');
            const lyrics = lyricsBox?.value || '';

            if (title && title !== "Untitled" && lyrics.trim()) {
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

// Fill lyrics, style, and title, then click "Create"
function custom_fill() {
  const lyricsBox = document.querySelector('textarea[data-testid="lyrics-input-textarea"]');
  const styleBox = document.querySelector('textarea[data-testid="tag-input-textarea"]');
  const titleBox = document.querySelector('input[placeholder="Enter song title"]');
  const createBtn = document.querySelector('button[data-testid="create-button"]');

  if (!lyricsBox || !styleBox || !titleBox || !createBtn) {
    console.error("❌ One or more fields/buttons not found!");
    return;
  }

  // Tamil jazz-style lyrics inspired by Harris Jayaraj
  const lyrics = "மழைத் துளியில் காதல் சிம்பொனி,\n" +
                 "நிலா ஒளியில் பியானோ மெலடி,\n" +
                 "நீ வந்தால் ஹார்மனி கூவுமே,\n" +
                 "ஜாஸ் இசையில் இதயம் ஆடும் நேசமே.";
  const style = "Jazz, Tamil, Harris Jayaraj style";
  const title = "மழைத் துளி ஜாஸ் (Mazhai Thuli Jazz)";

  setReactValue(lyricsBox, lyrics);
  setReactValue(styleBox, style);
  setReactValue(titleBox, title);

  // Start observer BEFORE creating
  observeNewSong((song) => {
    console.log("🎵 New song detected:", song);
  });

  // Click when button is enabled
  const check = setInterval(() => {
    if (!createBtn.disabled) {
      clearInterval(check);
      createBtn.click();
    }
  }, 100);
}

// Run it
custom_fill();
