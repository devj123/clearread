(function () {
  "use strict";

  const SAMPLE_TEXT =
    "A hackathon works best when the constraint is real. Two weeks is not " +
    "enough time to build everything, so the teams that do well are the " +
    "ones that pick one problem, learn who actually has it, and cut every " +
    "feature that does not serve that person. The demo does not need to " +
    "be big. It needs to be true.";

  const els = {
    rawInput: document.getElementById("rawInput"),
    fileInput: document.getElementById("fileInput"),
    sampleBtn: document.getElementById("sampleBtn"),
    clearBtn: document.getElementById("clearBtn"),
    output: document.getElementById("output"),
    placeholder: document.getElementById("placeholder"),
    reader: document.getElementById("reader"),
    aboutToggle: document.getElementById("aboutToggle"),
    aboutPanel: document.getElementById("aboutPanel"),
    letterSpacing: document.getElementById("letterSpacing"),
    letterSpacingVal: document.getElementById("letterSpacingVal"),
    lineHeight: document.getElementById("lineHeight"),
    lineHeightVal: document.getElementById("lineHeightVal"),
    wordSpacing: document.getElementById("wordSpacing"),
    wordSpacingVal: document.getElementById("wordSpacingVal"),
    measure: document.getElementById("measure"),
    measureVal: document.getElementById("measureVal"),
    fontSize: document.getElementById("fontSize"),
    fontSizeVal: document.getElementById("fontSizeVal"),
    bionicToggle: document.getElementById("bionicToggle"),
    syllableToggle: document.getElementById("syllableToggle"),
    playBtn: document.getElementById("playBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    stopBtn: document.getElementById("stopBtn"),
    rate: document.getElementById("rate"),
    rateVal: document.getElementById("rateVal"),
    ttsSupport: document.getElementById("ttsSupport"),
  };

  const state = {
    text: "",
    font: "system",
    theme: "default",
    bionic: false,
    syllables: false,
    rate: 1,
  };

  // ---------- rendering ----------

  function computeBoldEndIdx(word) {
    const letters = (word.match(/[a-zA-Z]/g) || []).length;
    if (letters <= 1) return 0;
    const boldCount = Math.max(1, Math.ceil(letters / 2));
    let count = 0;
    let idx = 0;
    for (; idx < word.length; idx++) {
      if (/[a-zA-Z]/.test(word[idx])) count++;
      if (count >= boldCount) {
        idx++;
        break;
      }
    }
    return idx;
  }

  function bionicNodeForPart(part, offset, boldEndIdx) {
    const frag = document.createDocumentFragment();
    const localBoldLen = Math.max(0, Math.min(part.length, boldEndIdx - offset));
    if (localBoldLen > 0) {
      const strong = document.createElement("strong");
      strong.className = "bionic-strong";
      strong.textContent = part.slice(0, localBoldLen);
      frag.appendChild(strong);
    }
    if (localBoldLen < part.length) {
      frag.appendChild(document.createTextNode(part.slice(localBoldLen)));
    }
    return frag;
  }

  function renderWordContent(word) {
    const container = document.createDocumentFragment();
    const boldEndIdx = state.bionic ? computeBoldEndIdx(word) : 0;

    if (state.syllables) {
      const parts = splitSyllables(word);
      let offset = 0;
      parts.forEach((part) => {
        const s = document.createElement("span");
        s.className = "syl";
        s.appendChild(
          state.bionic ? bionicNodeForPart(part, offset, boldEndIdx) : document.createTextNode(part)
        );
        container.appendChild(s);
        offset += part.length;
      });
    } else {
      container.appendChild(
        state.bionic ? bionicNodeForPart(word, 0, boldEndIdx) : document.createTextNode(word)
      );
    }
    return container;
  }

  function renderOutput() {
    els.output.innerHTML = "";
    els.output.className = "font-" + state.font;

    const text = state.text;
    if (!text.trim()) {
      els.placeholder.hidden = false;
      stopSpeaking();
      els.playBtn.disabled = true;
      return;
    }
    els.placeholder.hidden = true;
    els.playBtn.disabled = !("speechSynthesis" in window);

    const frag = document.createDocumentFragment();
    const paragraphs = text.split(/\n+/).filter((p) => p.trim().length);
    let idx = 0;
    paragraphs.forEach((paraText) => {
      const p = document.createElement("p");
      const words = paraText.trim().split(/\s+/);
      words.forEach((w, i) => {
        const span = document.createElement("span");
        span.className = "word";
        span.dataset.idx = String(idx++);
        span.appendChild(renderWordContent(w));
        p.appendChild(span);
        if (i < words.length - 1) p.appendChild(document.createTextNode(" "));
      });
      frag.appendChild(p);
    });
    els.output.appendChild(frag);
  }

  function applyStyleVars() {
    els.output.style.setProperty("--letter-spacing", state.letterSpacing / 30 + "em");
    els.output.style.setProperty("--word-spacing", state.wordSpacing / 25 + "em");
    els.output.style.setProperty("--line-height", state.lineHeight / 10);
    els.output.style.setProperty("--measure", state.measure + "ch");
    els.output.style.setProperty("--font-size", state.fontSize + "px");
    els.reader.dataset.theme = state.theme;
  }

  // ---------- text-to-speech ----------

  let currentUtterance = null;
  let wordSpans = [];
  let wordOffsets = [];

  function buildWordIndex(text) {
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      words.push({ start: m.index, end: m.index + m[0].length });
    }
    return words;
  }

  function clearHighlight() {
    wordSpans.forEach((s) => s && s.classList.remove("speaking"));
  }

  function highlightWordAt(charIndex) {
    let lo = 0;
    let hi = wordOffsets.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = wordOffsets[mid];
      if (charIndex < w.start) hi = mid - 1;
      else if (charIndex >= w.end) lo = mid + 1;
      else {
        found = mid;
        break;
      }
    }
    if (found === -1) return;
    clearHighlight();
    const span = els.output.querySelector('.word[data-idx="' + found + '"]');
    if (span) {
      span.classList.add("speaking");
      wordSpans.push(span);
    }
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    clearHighlight();
    wordSpans = [];
    currentUtterance = null;
    els.playBtn.disabled = !state.text.trim() || !("speechSynthesis" in window);
    els.playBtn.textContent = "▶ Play";
    els.pauseBtn.disabled = true;
    els.stopBtn.disabled = true;
  }

  function startSpeaking() {
    if (!("speechSynthesis" in window) || !state.text.trim()) return;
    window.speechSynthesis.cancel();
    wordOffsets = buildWordIndex(state.text);
    const utterance = new SpeechSynthesisUtterance(state.text);
    utterance.rate = state.rate;
    utterance.onboundary = (e) => {
      if (e.name && e.name !== "word") return;
      highlightWordAt(e.charIndex);
    };
    utterance.onend = () => stopSpeaking();
    utterance.onerror = () => stopSpeaking();
    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    els.playBtn.textContent = "▶ Playing…";
    els.playBtn.disabled = true;
    els.pauseBtn.disabled = false;
    els.stopBtn.disabled = false;
  }

  // ---------- wiring ----------

  function setText(text) {
    state.text = text;
    els.rawInput.value = text;
    renderOutput();
    applyStyleVars();
  }

  els.rawInput.addEventListener("input", () => {
    state.text = els.rawInput.value;
    renderOutput();
    applyStyleVars();
  });

  els.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  });

  els.sampleBtn.addEventListener("click", () => setText(SAMPLE_TEXT));
  els.clearBtn.addEventListener("click", () => setText(""));

  els.aboutToggle.addEventListener("click", () => {
    const expanded = els.aboutToggle.getAttribute("aria-expanded") === "true";
    els.aboutToggle.setAttribute("aria-expanded", String(!expanded));
    els.aboutPanel.hidden = expanded;
  });

  document.querySelectorAll('input[name="font"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      state.font = e.target.value;
      renderOutput();
    })
  );

  document.querySelectorAll('input[name="theme"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      state.theme = e.target.value;
      applyStyleVars();
    })
  );

  function bindRange(input, output, key, format) {
    input.addEventListener("input", () => {
      state[key] = Number(input.value);
      output.textContent = format ? format(state[key]) : String(state[key]);
      applyStyleVars();
    });
  }

  state.letterSpacing = Number(els.letterSpacing.value);
  state.wordSpacing = Number(els.wordSpacing.value);
  state.lineHeight = Number(els.lineHeight.value);
  state.measure = Number(els.measure.value);
  state.fontSize = Number(els.fontSize.value);

  bindRange(els.letterSpacing, els.letterSpacingVal, "letterSpacing");
  bindRange(els.wordSpacing, els.wordSpacingVal, "wordSpacing");
  bindRange(els.lineHeight, els.lineHeightVal, "lineHeight", (v) => (v / 10).toFixed(1));
  bindRange(els.measure, els.measureVal, "measure");
  bindRange(els.fontSize, els.fontSizeVal, "fontSize");

  els.bionicToggle.addEventListener("change", () => {
    state.bionic = els.bionicToggle.checked;
    renderOutput();
  });
  els.syllableToggle.addEventListener("change", () => {
    state.syllables = els.syllableToggle.checked;
    renderOutput();
  });

  els.rate.addEventListener("input", () => {
    state.rate = Number(els.rate.value);
    els.rateVal.textContent = state.rate.toFixed(1) + "×";
    if (currentUtterance) currentUtterance.rate = state.rate;
  });

  els.playBtn.addEventListener("click", () => {
    if ("speechSynthesis" in window && window.speechSynthesis.paused && currentUtterance) {
      window.speechSynthesis.resume();
      els.playBtn.disabled = true;
      els.pauseBtn.disabled = false;
      return;
    }
    startSpeaking();
  });
  els.pauseBtn.addEventListener("click", () => {
    if ("speechSynthesis" in window) window.speechSynthesis.pause();
    els.playBtn.disabled = false;
    els.playBtn.textContent = "▶ Resume";
    els.pauseBtn.disabled = true;
  });
  els.stopBtn.addEventListener("click", stopSpeaking);

  if (!("speechSynthesis" in window)) {
    els.ttsSupport.textContent = "Read-aloud is not supported in this browser.";
  } else {
    els.ttsSupport.textContent = "";
  }

  // initial paint
  applyStyleVars();
  renderOutput();
})();
