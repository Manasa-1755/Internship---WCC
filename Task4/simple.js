async function simple_fill_with_observer() {
  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  // React-safe input value setter
  function setReactValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Utility: wait for element with MutationObserver
  function waitForElementWithObserver(selector, container = document, timeout = 300000, label = "") {
    return new Promise((resolve, reject) => {
      const el = container.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = container.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(container, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${label || selector}`));
      }, timeout);
    });
  }

  // Utility: trusted click simulation
  const realClick = (el) => {
    ["pointerdown", "mousedown", "mouseup", "click"].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  };

  console.log("Starting automated process...");

  // Step 1️ - Code to autofill & click create
  const textarea = document.querySelector('textarea[data-testid="prompt-input-textarea"]');
  const createBtn = document.querySelector('button[data-testid="create-button"]');
  if (!textarea || !createBtn) {
    console.error("❌ Prompt textarea or Create button not found!");
    return;
  }
  setReactValue(textarea, "Write a song about a summer love story");
  console.log("Prompt filled automatically");

  const grid = document.querySelector('.react-aria-GridList');
  const oldFirstSong = grid?.querySelector('[role="row"], .react-aria-GridListItem');
  createBtn.click();
  console.log("Clicked create button automatically");

  // Step 2️ - Code to wait for the first row's CONTENT to change
  console.log("⏳ Waiting for first row to update with NEW song...");
  const newFirstSong = await new Promise((resolve, reject) => {
    let lastText = oldFirstSong?.innerText || "";

    const observer = new MutationObserver(() => {
      const currentFirstSong = document.querySelector('.react-aria-GridList [role="row"], .react-aria-GridListItem');
      if (!currentFirstSong) return;

      const newText = currentFirstSong.innerText.trim();

      // Code to detect content changed (new song replacing old one)
      if (newText && newText !== lastText) {
        lastText = newText;
        console.log("🔍 Row content changed:", newText);

        if (newText.includes("Publish") || newText.includes("processing")) {
          observer.disconnect();
          resolve(currentFirstSong); // same node, but new content
        }
      }
    });

    observer.observe(grid, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error("❌ New song did not appear in time"));
    }, 300000);
  });
  console.log("First row updated with new song!");

  // Step 3 - Code to wait for "Publish" inside THAT row
  console.log("⏳ Waiting for 'Publish' inside new row...");
  await waitForElementWithObserver(
    'span.relative.flex.flex-row.items-center.justify-center.gap-1',
    newFirstSong,
    300000,
    "Publish button"
  );
  console.log("Song has been published!");

  // Step 4️ - Code to explicitly click the UPDATED first row
  newFirstSong.scrollIntoView({ behavior: "smooth", block: "center" });
  await wait(500);
  realClick(newFirstSong);
  console.log("Clicked the new song row to open sidebar automatically");
  await wait(2000);

  // Step 5️ - Code to get the title of the song
  const titleEl = await waitForElementWithObserver(
    'a.line-clamp-2.text-xl.text-foreground-primary',
    document,
    60000,
    "song title"
  );
  const title = titleEl?.innerText.trim() || "(No title)";
  console.log("🎵 Title:", title);

  // Step 6️ - Code to get the lyrics of the song
  const lyricsEl = await waitForElementWithObserver('span.mt-4.mb-4', document, 300000, "lyrics");
  const lyrics = lyricsEl?.innerText.trim() || "(No lyrics found)";
  console.log("📜 Lyrics:", lyrics);

  // Step 7️ - Code to auto download 
  try {
    console.log("⏳ Starting auto download...");

    const moreOptionsBtn = await waitForElementWithObserver(
      'button[aria-label="More Options"]',
      document,
      60000,
      "More Options"
    );
    realClick(moreOptionsBtn);
    console.log("Clicked More Options automatically");
    await wait(500);

    const downloadBtn = await waitForElementWithObserver('[data-testid="download-sub-trigger"]', document, 60000, "Download menu");
    realClick(downloadBtn);
    console.log("Clicked Download menu automatically");
    await wait(500);

    const mp3Btn = Array.from(document.querySelectorAll('button, [role="menuitem"], span'))
      .find(el => el.textContent.trim().toLowerCase().includes("mp3 audio"));
    if (!mp3Btn) throw new Error("❌ MP3 Audio option not found!");
    realClick(mp3Btn);
    console.log("Clicked MP3 Audio automatically");
    await wait(500);

    const downloadAnywayBtn = Array.from(document.querySelectorAll('button'))
      .find(el => el.textContent.trim().toLowerCase().includes("download anyway"));
    if (!downloadAnywayBtn) throw new Error("❌ 'Download Anyway' button not found!");
    realClick(downloadAnywayBtn);
    console.log("Clicked 'Download Anyway' automatically");
    await wait(500);

    console.log("MP3 Audio has been downloaded successfully!");
  } catch (err) {
    console.error("❌ Error during download:", err);
  }
}

simple_fill_with_observer();
