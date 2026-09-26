// Options page: reading profile + AI opt-in. A module (not a classic
// script) purely so it can import DEFAULT_PROFILE directly from
// storage.js instead of keeping a second copy of the defaults in sync by
// hand -- the options page is allowed this convenience because, unlike
// content.js, it's never injected via chrome.scripting and only ever
// runs in its own dedicated extension page.

import { DEFAULT_PROFILE } from "../background/storage.js";

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
      if (res.ok) resolve(res.result);
      else reject(new Error(res.error || "Unknown error."));
    });
  });
}

// ---------- reading profile ----------

const rangeLabels = {
  "opt-font-size": (v) => `${v}px`,
  "opt-line-height": (v) => (v / 10).toFixed(1),
  "opt-letter-spacing": (v) => (v / 30).toFixed(2) + "em",
  "opt-word-spacing": (v) => (v / 25).toFixed(2) + "em",
  "opt-measure": (v) => `${v}ch`,
};

function fillProfileForm(profile) {
  document.getElementById("opt-font").value = profile.font;
  document.getElementById("opt-theme").value = profile.theme;
  document.getElementById("opt-font-size").value = profile.fontSize;
  document.getElementById("opt-line-height").value = profile.lineHeight;
  document.getElementById("opt-letter-spacing").value = profile.letterSpacing;
  document.getElementById("opt-word-spacing").value = profile.wordSpacing;
  document.getElementById("opt-measure").value = profile.measure;
  document.getElementById("opt-bionic").checked = profile.bionic;
  document.getElementById("opt-syllables").checked = profile.syllables;
  updateRangeLabels();
}

function updateRangeLabels() {
  for (const id of Object.keys(rangeLabels)) {
    const input = document.getElementById(id);
    document.getElementById(`${id}-val`).textContent = rangeLabels[id](Number(input.value));
  }
}

function readProfileForm() {
  return {
    font: document.getElementById("opt-font").value,
    theme: document.getElementById("opt-theme").value,
    fontSize: Number(document.getElementById("opt-font-size").value),
    lineHeight: Number(document.getElementById("opt-line-height").value),
    letterSpacing: Number(document.getElementById("opt-letter-spacing").value),
    wordSpacing: Number(document.getElementById("opt-word-spacing").value),
    measure: Number(document.getElementById("opt-measure").value),
    bionic: document.getElementById("opt-bionic").checked,
    syllables: document.getElementById("opt-syllables").checked,
  };
}

async function loadProfile() {
  const profile = await sendBg({ type: "GET_PROFILE" }).catch(() => DEFAULT_PROFILE);
  fillProfileForm(profile);
}

function wireProfileForm() {
  Object.keys(rangeLabels).forEach((id) => {
    document.getElementById(id).addEventListener("input", updateRangeLabels);
  });

  document.getElementById("opt-save-profile").addEventListener("click", async () => {
    const status = document.getElementById("opt-profile-status");
    try {
      await sendBg({ type: "SET_PROFILE", profile: readProfileForm() });
      status.textContent = "Saved.";
    } catch (err) {
      status.textContent = `Couldn't save: ${err.message}`;
    }
    setTimeout(() => (status.textContent = ""), 2500);
  });

  document.getElementById("opt-reset-profile").addEventListener("click", () => {
    fillProfileForm(DEFAULT_PROFILE);
  });
}

// ---------- AI settings ----------

function setAiFieldsEnabled(enabled) {
  document.getElementById("opt-ai-fields").classList.toggle("cmo-disabled", !enabled);
}

async function loadAiConfig() {
  const aiConfig = await sendBg({ type: "GET_AI_CONFIG_RAW" }).catch(() => null);
  if (!aiConfig) return;
  document.getElementById("opt-ai-enabled").checked = aiConfig.enabled;
  document.getElementById("opt-ai-provider").value = aiConfig.provider;
  document.getElementById("opt-ai-key").value = aiConfig.apiKey || "";
  document.getElementById("opt-ai-model").value = aiConfig.model || "";
  setAiFieldsEnabled(aiConfig.enabled);
}

function wireAiForm() {
  document.getElementById("opt-ai-enabled").addEventListener("change", (e) => setAiFieldsEnabled(e.target.checked));

  document.getElementById("opt-save-ai").addEventListener("click", async () => {
    const status = document.getElementById("opt-ai-status");
    const aiConfig = {
      enabled: document.getElementById("opt-ai-enabled").checked,
      provider: document.getElementById("opt-ai-provider").value,
      apiKey: document.getElementById("opt-ai-key").value.trim(),
      model: document.getElementById("opt-ai-model").value.trim(),
    };
    if (aiConfig.enabled && !aiConfig.apiKey) {
      status.textContent = "Add an API key first, or leave AI features off.";
      return;
    }
    try {
      await sendBg({ type: "SET_AI_CONFIG", aiConfig });
      status.textContent = "Saved.";
    } catch (err) {
      status.textContent = `Couldn't save: ${err.message}`;
    }
    setTimeout(() => (status.textContent = ""), 2500);
  });
}

wireProfileForm();
wireAiForm();
loadProfile();
loadAiConfig();
