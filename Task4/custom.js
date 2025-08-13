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



// Helper to set value in a React-controlled input/textarea
function setReactValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Code to wait for Publish button to be enabled
function waitForPublish(callback) {
  const checkPublish = setInterval(() => {
    const publishBtn = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent.trim() === "Publish");

    if (publishBtn && !publishBtn.disabled) {
      clearInterval(checkPublish);
      console.log("Publish button detected and enabled!");
      callback();
    }
  }, 1500);
}

// Input fields automated
function custom_fill() {
  const lyricsBox = document.querySelector('textarea[data-testid="lyrics-input-textarea"]');
  const styleBox = document.querySelector('textarea[data-testid="tag-input-textarea"]');
  const titleBox = document.querySelector('input[placeholder="Enter song title"]');
  const createBtn = document.querySelector('button[data-testid="create-button"]');

  if (!lyricsBox || !styleBox || !titleBox || !createBtn) {
    console.error("❌ One or more fields/buttons not found!");
    return;
  }

  const lyrics = 
    "Under the streetlight, your eyes meet mine,\n" +
    "Every little moment feels frozen in time,\n" +
    "Your laugh’s like a melody, soft and true,\n" +
    "And my guitar’s just strumming the thought of you.\n\n" +
    "We’re dancing barefoot on the city stones,\n" +
    "Writing our story in a song of our own,\n" +
    "If the night keeps us here, I’ll play ‘til it’s through,\n" +
    "Every chord is a heartbeat that’s pulling me to you.";
  
  const style = "Pop, Acoustic, Shawn Mendes style, Guitar";
  const title = "Streetlight Serenade";

  setReactValue(lyricsBox, lyrics);
  setReactValue(styleBox, style);
  setReactValue(titleBox, title);

  // Code to wait for publish to be ready, then pull values directly from inputs
  waitForPublish(() => {
    const finalData = {
      title: titleBox.value.trim(),
      lyrics: lyricsBox.value.trim(),
      style: styleBox.value.trim()
    };
    console.log("Final song details:", finalData);
    console.log("Song has been completed and details are fetched!");
  });

  // Create button
  const check = setInterval(() => {
    if (!createBtn.disabled) {
      clearInterval(check);
      console.log("Clicking 'Create' button...");
      createBtn.click();
    }
  }, 200);
}

custom_fill();

//-------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------

async function autoDownloadLatestMP3() {
  console.log("Starting to automate MP3 download....");

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const waitForElement = async (selector, container = document, timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = container.querySelector(selector);
      if (el) return el;
      await wait(100);
    }
    return null;
  };

  // Simulating a trusted user click
  const realClick = (el) => {
    ["pointerdown", "mousedown", "mouseup", "click"].forEach(type => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  };

  try {
    // To select the first song in grid automatically
    const grid = await waitForElement('.react-aria-GridList');
    if (!grid) throw new Error("❌ Grid not found!");
    const firstSong = grid.querySelector('[role="row"], .react-aria-GridListItem');
    if (!firstSong) throw new Error("❌ No songs found!");
    realClick(firstSong);
    console.log("Selected first song");
    await wait(500);

    // To click 3 dots (More Options) automatically
    const moreOptionsBtn = firstSong.querySelector('button[aria-label="More Options"]');
    if (!moreOptionsBtn) throw new Error("❌ More Options not found!");
    realClick(moreOptionsBtn);
    console.log("Clicked More Options");
    await wait(500);

    // To click Download (or arrow next to it) automatically
    const downloadBtn = await waitForElement('[data-testid="download-sub-trigger"]') 
                      || Array.from(document.querySelectorAll('span, button'))
                         .find(el => el.textContent.trim().toLowerCase() === "download");
    if (!downloadBtn) throw new Error("❌Download option not found!");
    realClick(downloadBtn);
    console.log("Clicked Download");
    await wait(500);

    // To click MP3 Audio automatically
    const mp3Btn = Array.from(document.querySelectorAll('button, [role="menuitem"], span'))
      .find(el => el.textContent.trim().toLowerCase().includes("mp3 audio"));
    if (!mp3Btn) throw new Error("❌ MP3 Audio option not found!");
    realClick(mp3Btn);
    console.log("Clicked MP3 Audio");
    await wait(500);

    // To click Download Anyway automatically
    const downloadAnywayBtn = Array.from(document.querySelectorAll('button'))
      .find(el => el.textContent.trim().toLowerCase().includes("download anyway"));
    if (!downloadAnywayBtn) throw new Error("❌ 'Download Anyway' button not found!");
    realClick(downloadAnywayBtn);
    console.log("Clicked 'Download Anyway'");
    await wait(500);

    console.log("MP3 Audio is downloaded successfully!");
  } catch (err) {
    console.error("❌ Error in downloading latest MP3:", err);
  }
}
autoDownloadLatestMP3();
