// Central storage schema for Cognitive Mode. Everything here lives in
// chrome.storage.local (survives browser restarts) except the trail ring
// buffer and per-tab Cognitive Mode toggle, which live in
// chrome.storage.session (cleared when the browser closes -- there's no
// reason a record of what tabs someone drifted through last Tuesday should
// outlive the browser session).
//
// This file is the only place that should touch chrome.storage.* directly.
// Everything else -- content scripts, the popup, the options page -- talks
// to background.js over chrome.runtime.sendMessage and never reads or
// writes storage on its own. That keeps the state machine in one place
// instead of scattered across five files that can drift out of sync.

export const DEFAULT_PROFILE = {
  font: "system", // "system" | "dyslexic" | "mono"
  letterSpacing: 0,
  wordSpacing: 0,
  lineHeight: 15,
  measure: 65,
  fontSize: 19,
  theme: "default", // "default" | "cream" | "mint" | "dark" | "contrast"
  bionic: false,
  syllables: false,
};

export const DEFAULT_AI_CONFIG = {
  enabled: false,
  provider: "openai", // "openai" | "anthropic"
  apiKey: "",
  model: "",
};

const LOCAL_DEFAULTS = {
  profile: DEFAULT_PROFILE,
  aiConfig: DEFAULT_AI_CONFIG,
  tabGroupLabels: {}, // { [chromeGroupId]: { label, color, createdAt } }
  chunkLists: {}, // { [taskId]: { title, steps: [{text, done}], createdAt, sourceUrl } }
  workingMemory: {}, // { [tabId]: { mainIdea, terms: [], numbers: [], recap, updatedAt, heuristic: bool } }
};

const SESSION_DEFAULTS = {
  trail: [], // ring buffer, see trail.js for shape
  currentTask: null, // { id, label, originTabId, originUrl, originTitle, startedAt }
  cognitiveModeTabs: {}, // { [tabId]: true }
};

const TRAIL_MAX_LENGTH = 60;

export async function getLocal(keys) {
  const defaults = {};
  for (const k of keys) defaults[k] = LOCAL_DEFAULTS[k];
  const result = await chrome.storage.local.get(defaults);
  return result;
}

export async function setLocal(patch) {
  await chrome.storage.local.set(patch);
}

export async function getSession(keys) {
  const defaults = {};
  for (const k of keys) defaults[k] = SESSION_DEFAULTS[k];
  const result = await chrome.storage.session.get(defaults);
  return result;
}

export async function setSession(patch) {
  await chrome.storage.session.set(patch);
}

export async function initDefaultsOnInstall() {
  const existingLocal = await chrome.storage.local.get(Object.keys(LOCAL_DEFAULTS));
  const patch = {};
  for (const [key, value] of Object.entries(LOCAL_DEFAULTS)) {
    if (existingLocal[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);

  const existingSession = await chrome.storage.session.get(Object.keys(SESSION_DEFAULTS));
  const sessionPatch = {};
  for (const [key, value] of Object.entries(SESSION_DEFAULTS)) {
    if (existingSession[key] === undefined) sessionPatch[key] = value;
  }
  if (Object.keys(sessionPatch).length) await chrome.storage.session.set(sessionPatch);
}

export function trailMaxLength() {
  return TRAIL_MAX_LENGTH;
}
