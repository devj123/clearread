// Classic (non-module) content script. Ported from ClearRead's
// js/syllables.js and the rendering logic in js/app.js -- same algorithm,
// same unit-tested behavior, adapted to run against arbitrary third-party
// pages instead of a textarea. See ../../js/syllables.js for the
// canonical, tested version and ../../tests/syllables.test.mjs for its
// test suite; if you change the splitting rule, change it in both places.
//
// This file defines a single global, CMReaderEngine, so content.js (loaded
// right after this file in the same isolated world) can use it without
// module-import machinery, which chrome.scripting.executeScript makes
// more awkward than it's worth for two files.

(function () {
  "use strict";

  // ---------- syllable splitter (ported from js/syllables.js) ----------

  function splitSyllables(rawToken) {
    const match = rawToken.match(/^([^a-zA-Z]*)([a-zA-Z']+)([^a-zA-Z]*)$/);
    if (!match) return [rawToken];
    const [, lead, core, trail] = match;
    const lower = core.toLowerCase();
    const vowels = "aeiouy";
    const nuclei = [];
    let i = 0;
    while (i < lower.length) {
      if (vowels.includes(lower[i])) {
        let j = i + 1;
        while (j < lower.length && vowels.includes(lower[j])) j++;
        nuclei.push([i, j]);
        i = j;
      } else {
        i++;
      }
    }
    if (nuclei.length <= 1) return [rawToken];
    const breakPoints = [];
    for (let k = 0; k < nuclei.length - 1; k++) {
      const gapStart = nuclei[k][1];
      const gapEnd = nuclei[k + 1][0];
      const clusterLen = gapEnd - gapStart;
      if (clusterLen <= 0) breakPoints.push(gapEnd);
      else if (clusterLen === 1) breakPoints.push(gapStart);
      else breakPoints.push(gapStart + 1);
    }
    const parts = [];
    let start = 0;
    for (const bp of breakPoints) {
      parts.push(core.slice(start, bp));
      start = bp;
    }
    parts.push(core.slice(start));
    parts[0] = lead + parts[0];
    parts[parts.length - 1] = parts[parts.length - 1] + trail;
    return parts;
  }

  // ---------- visual complexity detector (#8) ----------

  const READABILITY_TAGS = new Set(["P", "ARTICLE", "SECTION", "MAIN"]);
  const NOISE_TAGS = new Set(["NAV", "ASIDE", "FOOTER", "HEADER", "FORM"]);

  function textLength(el) {
    return (el.innerText || "").trim().length;
  }

  function linkDensity(el) {
    const total = textLength(el);
    if (!total) return 0;
    const linkText = Array.from(el.querySelectorAll("a")).reduce((sum, a) => sum + (a.innerText || "").length, 0);
    return linkText / total;
  }

  /**
   * Scores how visually/structurally dense a page is: tiny text, huge
   * unbroken paragraphs, heavy nav/ad chrome, low whitespace. Returns
   * 0 (calm) to 100 (overwhelming), plus which specific signals fired,
   * so the UI can say WHY rather than just showing a bare number.
   */
  function computeComplexityScore() {
    const body = document.body;
    if (!body) return { score: 0, signals: [] };

    const signals = [];
    let score = 0;

    const bodyFontSize = parseFloat(getComputedStyle(body).fontSize) || 16;
    if (bodyFontSize < 14) {
      score += 20;
      signals.push(`Base text is only ${bodyFontSize}px`);
    }

    const paragraphs = Array.from(document.querySelectorAll("p")).filter((p) => textLength(p) > 40);
    const avgParaLen = paragraphs.length
      ? paragraphs.reduce((sum, p) => sum + textLength(p), 0) / paragraphs.length
      : 0;
    if (avgParaLen > 900) {
      score += 20;
      signals.push("Paragraphs run very long with no visual break");
    }

    const bodyLineHeight = parseFloat(getComputedStyle(body).lineHeight);
    if (!Number.isNaN(bodyLineHeight) && bodyLineHeight / bodyFontSize < 1.3) {
      score += 15;
      signals.push("Line spacing is tight");
    }

    const noiseCount = Array.from(NOISE_TAGS).reduce((sum, tag) => sum + document.getElementsByTagName(tag).length, 0);
    if (noiseCount > 6) {
      score += 15;
      signals.push(`${noiseCount} navigation/ad-style regions on the page`);
    }

    const mainCandidate = pickMainCandidate();
    if (mainCandidate && linkDensity(mainCandidate) > 0.35) {
      score += 15;
      signals.push("Main content area is link-dense (list/aggregator style)");
    }

    const totalText = textLength(body);
    if (totalText > 6000 && !mainCandidate) {
      score += 15;
      signals.push("Long page with no clearly marked main content region");
    }

    return { score: Math.min(100, score), signals, verdict: score >= 45 ? "dense" : "calm" };
  }

  /**
   * A deliberately simple readability-style extractor: score each
   * candidate block by its own paragraph text minus link density, and
   * take the best one. This is not going to win against a page with an
   * unusual layout, and that's fine -- when it can't find a clean
   * candidate, buildCleanedView() says so instead of guessing badly.
   */
  function pickMainCandidate() {
    const explicit = document.querySelector("article, main, [role='main']");
    if (explicit && textLength(explicit) > 200) return explicit;

    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll("div, section")) {
      if (NOISE_TAGS.has(el.tagName)) continue;
      const len = textLength(el);
      if (len < 400) continue;
      const density = linkDensity(el);
      const paraCount = el.querySelectorAll("p").length;
      const s = len * (1 - density) * (1 + Math.min(paraCount, 10) / 10);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return best;
  }

  function extractReadableText() {
    const el = pickMainCandidate();
    if (!el) return null;
    const paragraphs = Array.from(el.querySelectorAll("p"))
      .map((p) => p.innerText.trim())
      .filter((t) => t.length > 20);
    if (!paragraphs.length) return null;
    return { title: document.title, paragraphs };
  }

  // ---------- reading-mode rendering (ported styling logic from js/app.js) ----------

  function computeBoldEndIdx(word) {
    const letters = (word.match(/[a-zA-Z]/g) || []).length;
    if (letters <= 1) return 0;
    const boldCount = Math.max(1, Math.ceil(letters / 2));
    let count = 0,
      idx = 0;
    for (; idx < word.length; idx++) {
      if (/[a-zA-Z]/.test(word[idx])) count++;
      if (count >= boldCount) {
        idx++;
        break;
      }
    }
    return idx;
  }

  function renderWord(word, profile) {
    const boldEndIdx = profile.bionic ? computeBoldEndIdx(word) : 0;
    function bionicSpan(part, offset) {
      if (!profile.bionic) return document.createTextNode(part);
      const frag = document.createDocumentFragment();
      const localBoldLen = Math.max(0, Math.min(part.length, boldEndIdx - offset));
      if (localBoldLen > 0) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(0, localBoldLen);
        frag.appendChild(strong);
      }
      if (localBoldLen < part.length) frag.appendChild(document.createTextNode(part.slice(localBoldLen)));
      return frag;
    }
    const container = document.createDocumentFragment();
    if (profile.syllables) {
      let offset = 0;
      for (const part of splitSyllables(word)) {
        const s = document.createElement("span");
        s.className = "cm-syl";
        s.appendChild(bionicSpan(part, offset));
        container.appendChild(s);
        offset += part.length;
      }
    } else {
      container.appendChild(bionicSpan(word, 0));
    }
    return container;
  }

  function renderParagraph(text, profile) {
    const p = document.createElement("p");
    const words = text.trim().split(/\s+/);
    words.forEach((w, i) => {
      p.appendChild(renderWord(w, profile));
      if (i < words.length - 1) p.appendChild(document.createTextNode(" "));
    });
    return p;
  }

  function applyProfileVars(el, profile) {
    el.style.setProperty("--cm-letter-spacing", profile.letterSpacing / 30 + "em");
    el.style.setProperty("--cm-word-spacing", profile.wordSpacing / 25 + "em");
    el.style.setProperty("--cm-line-height", profile.lineHeight / 10);
    el.style.setProperty("--cm-measure", profile.measure + "ch");
    el.style.setProperty("--cm-font-size", profile.fontSize + "px");
    el.dataset.cmTheme = profile.theme;
    el.className = "cm-reader-output font-" + profile.font;
  }

  window.CMReaderEngine = {
    splitSyllables,
    computeComplexityScore,
    extractReadableText,
    renderParagraph,
    applyProfileVars,
  };
})();
