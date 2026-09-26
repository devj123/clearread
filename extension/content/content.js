// Main on-demand content-script orchestrator. Loaded together with
// reader-engine.js (in that order -- see ensureCognitiveModeInjected() in
// background/background.js) only when a tab actually needs it: the user
// turned Cognitive Mode on for this page, chunked a selection, or asked
// "What was I doing?" from a page that didn't have it on yet. Nothing in
// this file runs on a page the user hasn't acted on.
//
// Single source of truth stays in the background service worker. This
// file never touches chrome.storage directly and never calls the AI
// functions directly -- every state change and every model call goes
// through chrome.runtime.sendMessage so the popup, options page, and any
// other tab in Cognitive Mode see the same state background.js does.
//
// Idempotent by design: chrome.scripting.executeScript can end up running
// this file more than once in the same page (sendToTab() in background.js
// retries injection if its first message finds no listener yet), so all
// mutable state lives on `window` rather than in module-local closures,
// and every "create the X element" helper checks for an existing X first.

(function () {
  "use strict";

  if (!window.__cmRoot) {
    window.__cmRoot = document.createElement("div");
    window.__cmRoot.id = "cm-root";
    document.documentElement.appendChild(window.__cmRoot);
  }
  const root = window.__cmRoot;

  window.__cmState = window.__cmState || {
    active: false,
    profile: null,
    tabId: null,
    dockButtons: null,
    bannerDismissed: false,
    readerOpen: false,
    sidebarOpen: false,
  };
  const state = window.__cmState;

  // ---------- background messaging helper ----------

  function sendBg(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res) {
          reject(new Error("No response from the extension background."));
          return;
        }
        if (res.ok) {
          resolve(res.result);
        } else {
          const err = new Error(res.error || "Unknown error.");
          err.isAIDisabled = Boolean(res.isAIDisabled);
          reject(err);
        }
      });
    });
  }

  // ---------- dock ----------

  function buildDock() {
    const existing = root.querySelector(".cm-dock");
    if (existing) {
      updateDockButtons();
      return existing;
    }

    const dock = document.createElement("div");
    dock.className = "cm-dock";

    const readBtn = document.createElement("button");
    readBtn.textContent = "Aa";
    readBtn.title = "Calm reading mode";
    readBtn.addEventListener("click", () => (state.readerOpen ? closeReader() : openReader()));

    const memBtn = document.createElement("button");
    memBtn.textContent = "☰";
    memBtn.title = "Working-memory sidebar";
    memBtn.addEventListener("click", () => (state.sidebarOpen ? closeSidebar() : renderSidebar()));

    const chunkBtn = document.createElement("button");
    chunkBtn.textContent = "✓";
    chunkBtn.title = "Chunk this page into steps";
    chunkBtn.addEventListener("click", () => {
      const extracted = CMReaderEngine.extractReadableText();
      const text = extracted ? extracted.paragraphs.join("\n\n").slice(0, 6000) : document.title;
      startChunking(text);
    });

    const offBtn = document.createElement("button");
    offBtn.textContent = "✕";
    offBtn.title = "Turn off Cognitive Mode on this page";
    offBtn.addEventListener("click", () => {
      sendBg({ type: "TOGGLE_COGNITIVE_MODE", on: false }).catch(() => {});
    });

    dock.appendChild(readBtn);
    dock.appendChild(memBtn);
    dock.appendChild(chunkBtn);
    dock.appendChild(offBtn);
    root.appendChild(dock);

    state.dockButtons = { read: readBtn, mem: memBtn };
    updateDockButtons();
    return dock;
  }

  function updateDockButtons() {
    if (!state.dockButtons) return;
    state.dockButtons.read.classList.toggle("active", state.readerOpen);
    state.dockButtons.mem.classList.toggle("active", state.sidebarOpen);
  }

  // ---------- complexity banner (#8) ----------

  function runComplexityCheck() {
    if (state.bannerDismissed) return;
    const { signals, verdict } = CMReaderEngine.computeComplexityScore();
    if (verdict !== "dense") return;
    showBanner(signals);
  }

  function showBanner(signals) {
    if (root.querySelector(".cm-banner")) return;
    const banner = document.createElement("div");
    banner.className = "cm-banner";

    const msg = document.createElement("span");
    msg.textContent = signals.length
      ? `This page looks visually dense (${signals[0]}).`
      : "This page looks visually dense.";

    const showBtn = document.createElement("button");
    showBtn.className = "cm-show";
    showBtn.textContent = "Show cleaned version";
    showBtn.addEventListener("click", () => {
      banner.remove();
      openReader();
    });

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "cm-dismiss";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", () => {
      banner.remove();
      state.bannerDismissed = true;
    });

    banner.appendChild(msg);
    banner.appendChild(showBtn);
    banner.appendChild(dismissBtn);
    root.appendChild(banner);
  }

  // ---------- reading overlay ----------

  function openReader() {
    state.readerOpen = true;
    let overlay = root.querySelector(".cm-reader-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "cm-reader-overlay";
      root.appendChild(overlay);
    }
    overlay.innerHTML = "";
    overlay.dataset.cmTheme = state.profile.theme;
    overlay.appendChild(buildReaderToolbar());

    const extracted = CMReaderEngine.extractReadableText();
    if (!extracted) {
      const err = document.createElement("div");
      err.className = "cm-error";
      err.style.margin = "40px";
      err.textContent =
        'Could not find a clean reading area on this page. Try selecting text and using "Chunk this" from the dock instead.';
      overlay.appendChild(err);
      updateDockButtons();
      return;
    }

    const output = document.createElement("div");
    const title = document.createElement("h1");
    title.textContent = extracted.title;
    output.appendChild(title);
    extracted.paragraphs.forEach((text) => {
      output.appendChild(CMReaderEngine.renderParagraph(text, state.profile));
    });
    CMReaderEngine.applyProfileVars(output, state.profile);
    overlay.appendChild(output);
    updateDockButtons();
  }

  function closeReader() {
    const overlay = root.querySelector(".cm-reader-overlay");
    if (overlay) overlay.remove();
    state.readerOpen = false;
    updateDockButtons();
  }

  function buildReaderToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "cm-reader-toolbar";

    toolbar.appendChild(
      mkToolbarButton("Bionic", state.profile.bionic, () => updateProfile({ bionic: !state.profile.bionic }))
    );
    toolbar.appendChild(
      mkToolbarButton("Syllables", state.profile.syllables, () =>
        updateProfile({ syllables: !state.profile.syllables })
      )
    );

    const smaller = document.createElement("button");
    smaller.textContent = "A−";
    smaller.title = "Smaller text";
    smaller.addEventListener("click", () => updateProfile({ fontSize: Math.max(14, state.profile.fontSize - 1) }));
    const larger = document.createElement("button");
    larger.textContent = "A+";
    larger.title = "Larger text";
    larger.addEventListener("click", () => updateProfile({ fontSize: Math.min(32, state.profile.fontSize + 1) }));
    toolbar.appendChild(smaller);
    toolbar.appendChild(larger);

    const themes = ["default", "cream", "mint", "dark", "contrast"];
    const themeBtn = document.createElement("button");
    themeBtn.textContent = "Theme";
    themeBtn.title = "Cycle color theme";
    themeBtn.addEventListener("click", () => {
      const idx = themes.indexOf(state.profile.theme);
      updateProfile({ theme: themes[(idx + 1) % themes.length] });
    });
    toolbar.appendChild(themeBtn);

    const summarizeBtn = document.createElement("button");
    summarizeBtn.textContent = "Summarize";
    summarizeBtn.title = "10-second and 1-minute summaries";
    summarizeBtn.addEventListener("click", showLeveledSummary);
    toolbar.appendChild(summarizeBtn);

    const recapBtn = document.createElement("button");
    recapBtn.textContent = "Catch me up";
    recapBtn.title = 'I stopped paying attention -- recap what I just scrolled past';
    recapBtn.addEventListener("click", showRecapSinceDrift);
    toolbar.appendChild(recapBtn);

    const closeBtn = document.createElement("button");
    closeBtn.className = "cm-close";
    closeBtn.textContent = "✕ Close";
    closeBtn.addEventListener("click", closeReader);
    toolbar.appendChild(closeBtn);

    return toolbar;
  }

  // ---------- attention-aware summaries (#9) ----------
  // Both of these only make sense inside the reading overlay, so they live
  // in its toolbar rather than the always-visible dock. Both are AI-backed
  // (see ai.js) and both fail loudly with the bring-your-own-key message
  // when AI is off, the same as chunking does -- no silent degradation.

  function openSummaryPanel() {
    let panel = root.querySelector(".cm-summary-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "cm-summary-panel";
      root.appendChild(panel);
    }
    return panel;
  }

  function panelShell(panel) {
    panel.innerHTML = "";
    const closeBtn = document.createElement("button");
    closeBtn.className = "cm-summary-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => panel.remove());
    panel.appendChild(closeBtn);
    const body = document.createElement("div");
    panel.appendChild(body);
    return body;
  }

  function showAiError(body, err, action) {
    body.innerHTML = "";
    const errEl = document.createElement("div");
    errEl.className = "cm-error";
    errEl.textContent = err.isAIDisabled
      ? `${action} needs an AI key. Add one in Options (bring-your-own key -- nothing else about ClearRead changes).`
      : `Couldn't ${action.toLowerCase()}: ${err.message}`;
    body.appendChild(errEl);
  }

  async function showLeveledSummary() {
    const panel = openSummaryPanel();
    const body = panelShell(panel);
    body.innerHTML = '<div class="cm-loading">Summarizing...</div>';
    try {
      const extracted = CMReaderEngine.extractReadableText();
      if (!extracted) throw new Error("Could not find readable text on this page.");
      const result = await sendBg({ type: "AI_SUMMARIZE_LEVELS", text: extracted.paragraphs.join("\n\n") });
      body.innerHTML = "";
      addTextSection(body, "10 seconds", result.tenSecond);
      addTextSection(body, "1 minute", result.oneMinute);
    } catch (err) {
      showAiError(body, err, "Summarize");
    }
  }

  // Recaps whatever the reader just scrolled past -- roughly one screenful
  // above their current position -- rather than requiring them to manually
  // mark where they lost focus. A real approximation of "I stopped paying
  // attention here," not a literal attention tracker (this extension
  // doesn't watch eyes or mouse idle time; it works from scroll position,
  // which is honest about what it actually knows).
  async function showRecapSinceDrift() {
    const panel = openSummaryPanel();
    const body = panelShell(panel);
    body.innerHTML = '<div class="cm-loading">Working out what you scrolled past...</div>';
    try {
      const overlay = root.querySelector(".cm-reader-overlay");
      const output = root.querySelector(".cm-reader-overlay .cm-reader-output");
      if (!overlay || !output) throw new Error("Open reading mode first.");
      const scrollTop = overlay.scrollTop;
      const viewportHeight = overlay.clientHeight;
      const slice = Array.from(output.querySelectorAll("p"))
        .filter((p) => p.offsetTop >= scrollTop - viewportHeight && p.offsetTop < scrollTop)
        .map((p) => p.textContent)
        .join("\n\n");
      if (!slice.trim()) throw new Error("Not enough scrolled-past text yet -- keep reading a bit further first.");
      const recap = await sendBg({ type: "AI_RECAP_SINCE", text: slice });
      body.innerHTML = "";
      addTextSection(body, "Catch-up", recap);
    } catch (err) {
      showAiError(body, err, "Catch me up");
    }
  }

  function mkToolbarButton(label, active, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (active) btn.classList.add("active");
    btn.addEventListener("click", onClick);
    return btn;
  }

  function updateProfile(patch) {
    // Fire the change at background.js and stop. Background is the
    // profile's source of truth; it persists the change and pushes
    // CM_PROFILE_UPDATED back to every tab in Cognitive Mode, including
    // this one, which is what actually triggers the re-render below.
    // That round trip (instead of mutating state.profile here directly)
    // is what keeps this tab and, say, the options page from disagreeing
    // about what the current profile is.
    sendBg({ type: "SET_PROFILE", profile: { ...state.profile, ...patch } }).catch(() => {});
  }

  // ---------- working-memory sidebar (#2) ----------

  function renderSidebar() {
    state.sidebarOpen = true;
    updateDockButtons();
    let el = root.querySelector(".cm-sidebar");
    if (!el) {
      el = document.createElement("div");
      el.className = "cm-sidebar";
      root.appendChild(el);
    }
    el.innerHTML = '<div class="cm-loading">Reading the page...</div>';
    loadWorkingMemory()
      .then((data) => paintSidebar(el, data))
      .catch((err) => {
        el.innerHTML = "";
        const errEl = document.createElement("div");
        errEl.className = "cm-error";
        errEl.textContent = `Couldn't build the sidebar: ${err.message}`;
        el.appendChild(errEl);
      });
  }

  function closeSidebar() {
    const el = root.querySelector(".cm-sidebar");
    if (el) el.remove();
    state.sidebarOpen = false;
    updateDockButtons();
  }

  async function loadWorkingMemory() {
    const stored = await sendBg({ type: "GET_WORKING_MEMORY", tabId: state.tabId });
    if (stored) return stored;
    const extracted = CMReaderEngine.extractReadableText();
    const heuristic = heuristicWorkingMemory(extracted);
    await sendBg({ type: "SET_WORKING_MEMORY", tabId: state.tabId, data: heuristic });
    return heuristic;
  }

  // Local, non-AI first pass at a working-memory snapshot: repeated
  // capitalized phrases as candidate terms, numbers/years/percentages
  // with a little surrounding context, first sentence as the main idea,
  // last couple paragraphs as the recap. It will not be as sharp as the
  // AI-enhanced version, but it costs nothing, needs no API key, and
  // sends nothing anywhere -- so it's what the sidebar shows by default.
  function heuristicWorkingMemory(extracted) {
    if (!extracted || !extracted.paragraphs.length) {
      return { mainIdea: "", terms: [], numbers: [], recap: "", heuristic: true };
    }
    const allText = extracted.paragraphs.join(" ");
    const mainIdea = (extracted.paragraphs[0].split(/(?<=[.!?])\s/)[0] || extracted.paragraphs[0]).slice(0, 220);

    const STOPWORDS = new Set(["The", "This", "That", "These", "Those", "It", "In", "On", "At", "A", "An", "And", "But", "For", "With"]);
    const termCounts = new Map();
    const termPattern = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2})\b/g;
    let m;
    while ((m = termPattern.exec(allText))) {
      const term = m[1];
      if (term.length < 3 || STOPWORDS.has(term)) continue;
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }
    const terms = [...termCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([term]) => term);

    const numberPattern = /\b(\d{4}|\d+(?:\.\d+)?%|\$\d[\d,]*(?:\.\d+)?|\d[\d,]{2,})\b/g;
    const numbers = [];
    let nm;
    while ((nm = numberPattern.exec(allText)) && numbers.length < 5) {
      const context = allText.slice(Math.max(0, nm.index - 25), nm.index).trim().split(/\s+/).slice(-4).join(" ");
      numbers.push(context ? `${context} ${nm[0]}` : nm[0]);
    }

    const recap = extracted.paragraphs.slice(-2).join(" ").slice(0, 300);

    return { mainIdea, terms, numbers, recap, heuristic: true };
  }

  function paintSidebar(el, data) {
    el.innerHTML = "";

    const closeBtn = document.createElement("button");
    closeBtn.className = "cm-chunk-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", closeSidebar);
    el.appendChild(closeBtn);

    const badge = document.createElement("div");
    badge.className = "cm-mode-badge";
    badge.textContent = data.heuristic ? "Built from page structure" : "Enhanced with AI";
    el.appendChild(badge);

    addTextSection(el, "Main idea", data.mainIdea || "Not enough text on this page yet.");
    addChipSection(el, "People & terms", data.terms);
    addChipSection(el, "Key numbers", data.numbers);
    addTextSection(el, "A moment ago", data.recap || "Keep reading to build this up.");

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "cm-refresh";
    refreshBtn.textContent = "Enhance with AI";
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Asking the model...";
      try {
        const extracted = CMReaderEngine.extractReadableText();
        if (!extracted) throw new Error("Could not find readable text on this page.");
        const pageText = extracted.paragraphs.join("\n\n");
        const enhanced = await sendBg({ type: "AI_WORKING_MEMORY", text: pageText });
        const data2 = { ...enhanced, heuristic: false };
        await sendBg({ type: "SET_WORKING_MEMORY", tabId: state.tabId, data: data2 });
        paintSidebar(el, data2);
      } catch (err) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = err.isAIDisabled ? "Turn on AI in Options first" : "Enhance with AI";
      }
    });
    el.appendChild(refreshBtn);
  }

  function addTextSection(el, heading, text) {
    const h = document.createElement("h2");
    h.textContent = heading;
    el.appendChild(h);
    const p = document.createElement("div");
    p.textContent = text;
    el.appendChild(p);
  }

  function addChipSection(el, heading, items) {
    const h = document.createElement("h2");
    h.textContent = heading;
    el.appendChild(h);
    if (!items || !items.length) {
      const p = document.createElement("div");
      p.textContent = "None found yet.";
      el.appendChild(p);
      return;
    }
    const wrap = document.createElement("div");
    items.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "cm-chip";
      chip.textContent = item;
      wrap.appendChild(chip);
    });
    el.appendChild(wrap);
  }

  // ---------- chunk-this-task overlay (#5) ----------

  async function startChunking(text) {
    if (!text || !text.trim()) return;
    const overlay = openChunkOverlay();
    overlay.innerHTML = '<div class="cm-loading">Breaking this into steps...</div>';
    try {
      const result = await sendBg({ type: "AI_CHUNK_TASK", text });
      let sticky = await sendBg({ type: "GET_STICKY_STATE" });
      if (!sticky.currentTask) {
        const task = await sendBg({ type: "START_TASK", label: result.title });
        sticky = { currentTask: task, list: null };
      }
      const list = {
        title: result.title,
        steps: result.steps.map((stepText) => ({ text: stepText, done: false })),
        createdAt: Date.now(),
        sourceUrl: location.href,
      };
      await sendBg({ type: "SAVE_CHUNK_LIST", taskId: sticky.currentTask.id, list });
      renderChunkOverlay(overlay, sticky.currentTask.id, list);
    } catch (err) {
      overlay.innerHTML = "";
      const errEl = document.createElement("div");
      errEl.className = "cm-error";
      errEl.textContent = err.isAIDisabled
        ? "Chunking needs an AI key. Open the extension's Options page and add one (bring-your-own key -- nothing else about ClearRead changes)."
        : `Couldn't chunk this: ${err.message}`;
      overlay.appendChild(errEl);
    }
  }

  function openChunkOverlay() {
    let overlay = root.querySelector(".cm-chunk-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "cm-chunk-overlay";
      root.appendChild(overlay);
    }
    return overlay;
  }

  function renderChunkOverlay(overlay, taskId, list) {
    overlay.innerHTML = "";

    const closeBtn = document.createElement("button");
    closeBtn.className = "cm-chunk-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => overlay.remove());
    overlay.appendChild(closeBtn);

    const h = document.createElement("h2");
    h.textContent = list.title;
    overlay.appendChild(h);

    list.steps.forEach((step, i) => {
      const row = document.createElement("div");
      row.className = "cm-chunk-step" + (step.done ? " done" : "");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(step.done);
      cb.id = `cm-chunk-step-${i}`;
      cb.addEventListener("change", async () => {
        const updated = await sendBg({ type: "SET_CHUNK_STEP", taskId, index: i, done: cb.checked });
        renderChunkOverlay(overlay, taskId, updated);
      });

      const label = document.createElement("label");
      label.htmlFor = cb.id;
      label.textContent = step.text;

      row.appendChild(cb);
      row.appendChild(label);
      overlay.appendChild(row);
    });
  }

  // ---------- trail card ("What was I doing?", #1) ----------

  function showTrailCard(result) {
    let card = root.querySelector(".cm-trail-card");
    if (!card) {
      card = document.createElement("div");
      card.className = "cm-trail-card";
      root.appendChild(card);
    }
    card.innerHTML = "";

    const h = document.createElement("h2");
    h.textContent = "What was I doing?";
    card.appendChild(h);

    const p = document.createElement("div");
    p.textContent = result.narration || "No trail yet. Keep browsing and this will fill in.";
    card.appendChild(p);

    const actions = document.createElement("div");
    actions.className = "cm-trail-actions";
    if (result.hasTask) {
      const returnBtn = document.createElement("button");
      returnBtn.className = "cm-trail-return";
      returnBtn.textContent = "Return to task";
      returnBtn.addEventListener("click", () => {
        sendBg({ type: "RETURN_TO_TASK" }).catch(() => {});
        card.remove();
      });
      actions.appendChild(returnBtn);
    }
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "cm-trail-dismiss";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.addEventListener("click", () => card.remove());
    actions.appendChild(dismissBtn);
    card.appendChild(actions);
  }

  // ---------- teardown ----------

  function teardown() {
    state.active = false;
    state.readerOpen = false;
    state.sidebarOpen = false;
    state.dockButtons = null;
    root.innerHTML = "";
  }

  // ---------- message router ----------
  // background.js is the only sender of these five message types, all
  // pushed via its sendToTab() helper. None of them expect a response
  // (the listener returns synchronously, so the message channel closes
  // right away instead of hanging open) -- background never reads
  // anything back from a tab, it only tells the tab what changed.

  function handleBackgroundMessage(message) {
    switch (message.type) {
      case "CM_ACTIVATE":
        state.active = true;
        state.profile = message.profile;
        state.tabId = message.tabId;
        buildDock();
        runComplexityCheck();
        break;
      case "CM_DEACTIVATE":
        teardown();
        break;
      case "CM_PROFILE_UPDATED":
        state.profile = message.profile;
        if (state.readerOpen) openReader();
        break;
      case "CM_CHUNK_TEXT":
        if (!state.active) {
          state.active = true;
          buildDock();
        }
        startChunking(message.text);
        break;
      case "CM_SHOW_TRAIL":
        if (!state.active) {
          state.active = true;
          buildDock();
        }
        showTrailCard(message.result);
        break;
      default:
        break;
    }
  }

  if (!window.__cmMessageListenerInstalled) {
    window.__cmMessageListenerInstalled = true;
    chrome.runtime.onMessage.addListener((message) => {
      handleBackgroundMessage(message);
    });
  }
})();
