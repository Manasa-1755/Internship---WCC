async function custom_fill() {
  console.log("Starting automation process...");

  //  Helpers 
  const wait = (ms) => new Promise(res => setTimeout(res, ms));

  const waitForElement = async (selector, timeout = 10000, root = document) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = root.querySelector(selector);
      if (el) return el;
      await wait(200);
    }
    return null;
  };

  const simulateUserClick = (element) => {
    ["pointerdown", "mousedown", "mouseup", "click"].forEach(eventType => {
      element.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true }));
    });
  };

  function setReactValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Step 1: Autofill and Create 
  const title = "Whispers in the Rain";
  const lyrics = `Raindrops fall, a gentle song,  
Shadows dance, the night feels long,  
Your memory lingers, soft yet strong.`;
  const styles = "lofi, mellow, rainy mood";

  const titleBox = await waitForElement('input[placeholder="Enter song title"]');
  if (titleBox) setReactValue(titleBox, title);

  const lyricsBox = await waitForElement('textarea[data-testid="lyrics-input-textarea"]');
  if (lyricsBox) setReactValue(lyricsBox, lyrics);

  const stylesBox = await waitForElement('textarea[data-testid="tag-input-textarea"]');
  if (stylesBox) setReactValue(stylesBox, styles);

  const createButton = await waitForElement('button[data-testid="create-button"]');
  if (createButton && !createButton.disabled) {
    simulateUserClick(createButton);
    console.log("Create button clicked automatically!");
  } else {
    console.error("❌ Create button not found or disabled!");
    return;
  }

  // Step 2: Code to detect new song row 
  const workspace = await waitForElement('.custom-scrollbar-transparent.flex-1.overflow-y-auto');
  if (!workspace) {
    console.error("❌ Workspace not found!");
    return;
  }

  const rowObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && node.matches('[role="row"]')) {
          const label = node.getAttribute("aria-label");
          if (label === title) {
            console.log(New song "${title}" has been detected!);

            // Step 3: Code to wait for Publish 
            const publishObserver = new MutationObserver((mutations2) => {
              for (const mut2 of mutations2) {
                for (const node2 of mut2.addedNodes) {
                  if (node2.nodeType === 1) {
                    const publishSpans = node2.querySelectorAll("button span");
                    for (const span of publishSpans) {
                      if (span.textContent.trim() === "Publish") {
                        console.log(Song "${title}" fully ready!);
                        publishObserver.disconnect();

                        (async () => {
                          // Step 4: Code to fetch details from inputs
                          const filledTitle = titleBox?.value || title;
                          const filledLyrics = lyricsBox?.value || lyrics;
                          const filledStyles = stylesBox?.value || styles;

                          console.log("🎼 Song Details:");
                          console.log(" Title:", filledTitle);
                          console.log(" Style:", filledStyles);
                          console.log(" Lyrics:", filledLyrics);

                          // === Step 5: Auto Download ===
                          const optionsButton = node.querySelector('button[aria-label="More Options"]');
                          if (!optionsButton) {
                            console.error("❌ Options button missing!");
                            return;
                          }
                          simulateUserClick(optionsButton);
                          await wait(600);

                          const downloadOption = await waitForElement('[data-testid="download-sub-trigger"]', 5000)
                            || Array.from(document.querySelectorAll('span, button'))
                              .find(el => el.textContent.trim().toLowerCase() === "download");
                          if (!downloadOption) {
                            console.error("❌ Download option missing!");
                            return;
                          }
                          simulateUserClick(downloadOption);
                          await wait(600);

                          const mp3Option = Array.from(document.querySelectorAll("button, [role='menuitem'], span"))
                            .find(el => el.textContent.toLowerCase().includes("mp3 audio"));
                          if (!mp3Option) {
                            console.error("❌ MP3 option not found!");
                            return;
                          }
                          simulateUserClick(mp3Option);
                          await wait(600);

                          const confirmDownload = Array.from(document.querySelectorAll("button"))
                            .find(el => el.textContent.toLowerCase().includes("download anyway"));
                          if (confirmDownload) simulateUserClick(confirmDownload);

                          console.log("Song is auto-downloaded!");
                        })();
                        return;
                      }
                    }
                  }
                }
              }
            });

            publishObserver.observe(node, { childList: true, subtree: true });
            rowObserver.disconnect();
          }
        }
      }
    }
  });

  rowObserver.observe(workspace, { childList: true, subtree: true });
}
custom_fill();
