async function simple_fill() {
  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  const waitForElement = async (selector, container = document, timeout = 300000, label = "") => {
    const start = Date.now();
    let lastLog = 0;
    while (Date.now() - start < timeout) {
      const el = container.querySelector(selector);
      if (el) return el;

      if (Date.now() - lastLog > 5000) {
        console.log(`⏳ Waiting for ${label || selector}... (${Math.floor((Date.now() - start) / 1000)}s elapsed)`);
        lastLog = Date.now();
      }
      await wait(200);
    }
    return null;
  };

  const waitForLyricsToLoad = async (lyricsEl, timeout = 300000) => {
    const start = Date.now();
    let lastText = "";
    let lastLog = 0;

    while (Date.now() - start < timeout) {
      const currentText = lyricsEl.innerText.trim();
      if (currentText && currentText !== lastText) {
        lastText = currentText;
      } else if (currentText && currentText === lastText) {
        return currentText;
      }

      if (Date.now() - lastLog > 5000) {
        console.log(`⏳ Waiting for lyrics to stabilize... (${Math.floor((Date.now() - start) / 1000)}s elapsed)`);
        lastLog = Date.now();
      }
      await wait(500);
    }
    return "(Lyrics not fully loaded)";
  };

  console.log("Starting procedures...");

  // Step 1: Fill prompt & click create
  const textarea = document.querySelector('textarea[data-testid="prompt-input-textarea"]');
  const createBtn = document.querySelector('button[data-testid="create-button"]');

  if (!textarea || !createBtn) {
    console.error("❌ Prompt or Create button not found!");
    return;
  }

  textarea.value = "Write a romantic pop song in the style of Taylor Swift about a summer love story";
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  console.log("Prompt has been filled");

  // Store old first song
  const grid = document.querySelector('.react-aria-GridList');
  const oldFirstSong = grid?.querySelector('[role="row"], .react-aria-GridListItem');

  createBtn.click();
  console.log("Clicked create button");

  // Step 2: Wait for new first song
  console.log("⏳ Waiting for new song to appear...");
  let newFirstSong = null;
  const startTime = Date.now();
  let lastLog = 0;

  while (Date.now() - startTime < 300000) {
    const currentFirstSong = document.querySelector('.react-aria-GridList [role="row"], .react-aria-GridListItem');
    if (currentFirstSong && currentFirstSong !== oldFirstSong) {
      newFirstSong = currentFirstSong;
      break;
    }
    if (Date.now() - lastLog > 5000) {
      console.log(`⏳ Still waiting for new song... (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
      lastLog = Date.now();
    }
    await wait(500);
  }

  if (!newFirstSong) {
    console.error("❌ New song did not appear in time");
    return;
  }
  console.log("New song has been detected");

  // Step 3: Wait for "Publish" in that row
  const publishBtn = await waitForElement(
    'span.relative.flex.flex-row.items-center.justify-center.gap-1',
    newFirstSong,
    300000,
    "'Publish' button"
  );

  if (!publishBtn || publishBtn.textContent.trim() !== "Publish") {
    console.error("❌ 'Publish' not detected in time");
    return;
  }
  console.log("'Publish' detected for new song");

  // Step 4: Click song to open sidebar
  newFirstSong.click();
  console.log("Song has been opened in sidebar");
  await wait(1500);

  // Step 5: Wait for title
  const titleEl = await waitForElement('.flex.items-start.justify-between.pt-5 a.line-clamp-2', document, 60000, "song title");
  const title = titleEl?.innerText.trim() || "(No title)";

  // Step 6: Wait for lyrics & ensure fully loaded
  const lyricsEl = await waitForElement('span.mt-4.mb-4', document, 300000, "lyrics");
  const lyrics = await waitForLyricsToLoad(lyricsEl);

  console.log("Title:", title);
  console.log("Lyrics:", lyrics);
}

simple_fill();
