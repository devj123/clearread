import { getLocal, setLocal, getSession, setSession, initDefaultsOnInstall, DEFAULT_PROFILE } from "./storage.js";
import { registerTrailListeners, startTask, clearTask, reconstructTrail, returnToTask } from "./trail.js";
import { getMissionControlView, autoGroupByOpener, suspendAllExcept, renameGroup } from "./missionControl.js";
import { chunkTask, summarizeLevels, recapSince, extractWorkingMemory, AIDisabledError } from "./ai.js";

registerTrailListeners();

chrome.runtime.onInstalled.addListener(async () => {
  await initDefaultsOnInstall();
  chrome.contextMenus.create({
    id: "cm-chunk-selection",
    title: 'Chunk this into steps ("Cognitive Mode")',
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "cm-toggle-reading-mode",
    title: "Toggle calm reading layout",
    contexts: ["page"],
  });
});

// ---------- content-script injection ----------

async function ensureCognitiveModeInjected(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content/content.css"] });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/reader-engine.js", "content/content.js"],
  });
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // content script not present yet; inject then retry once
    await ensureCognitiveModeInjected(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function setCognitiveModeForTab(tabId, on) {
  const { cognitiveModeTabs } = await getSession(["cognitiveModeTabs"]);
  cognitiveModeTabs[tabId] = on;
  await setSession({ cognitiveModeTabs });
  if (on) {
    await ensureCognitiveModeInjected(tabId);
    const { profile } = await getLocal(["profile"]);
    await sendToTab(tabId, { type: "CM_ACTIVATE", profile, tabId });
  } else {
    await sendToTab(tabId, { type: "CM_DEACTIVATE" }).catch(() => {});
  }
  return { tabId, on };
}

// ---------- context menu + commands ----------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "cm-chunk-selection" && info.selectionText) {
    await ensureCognitiveModeInjected(tab.id);
    await sendToTab(tab.id, { type: "CM_CHUNK_TEXT", text: info.selectionText });
  } else if (info.menuItemId === "cm-toggle-reading-mode") {
    const { cognitiveModeTabs } = await getSession(["cognitiveModeTabs"]);
    await setCognitiveModeForTab(tab.id, !cognitiveModeTabs[tab.id]);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "toggle-cognitive-mode") {
    const { cognitiveModeTabs } = await getSession(["cognitiveModeTabs"]);
    await setCognitiveModeForTab(tab.id, !cognitiveModeTabs[tab.id]);
  } else if (command === "what-was-i-doing") {
    const result = await reconstructTrail();
    await ensureCognitiveModeInjected(tab.id);
    await sendToTab(tab.id, { type: "CM_SHOW_TRAIL", result });
  } else if (command === "chunk-selection") {
    const [{ result: selection } = {}] = await chrome.scripting
      .executeScript({ target: { tabId: tab.id }, func: () => window.getSelection().toString() })
      .catch(() => []);
    if (selection) {
      await ensureCognitiveModeInjected(tab.id);
      await sendToTab(tab.id, { type: "CM_CHUNK_TEXT", text: selection });
    }
  }
});

// ---------- message router ----------
// Every popup/options/content-script request comes through here. Keeping
// storage and cross-cutting logic (trail, mission control, AI calls) only
// reachable through this router, rather than letting each surface poke at
// chrome.storage or fetch() directly, is what keeps three UI surfaces
// (popup, options, content script) from drifting out of sync with each
// other.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: err.message, isAIDisabled: err instanceof AIDisabledError }));
  return true; // keep the message channel open for the async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_PROFILE": {
      const { profile } = await getLocal(["profile"]);
      return profile;
    }
    case "SET_PROFILE": {
      await setLocal({ profile: { ...DEFAULT_PROFILE, ...message.profile } });
      // live-update any tab currently in Cognitive Mode
      const { cognitiveModeTabs } = await getSession(["cognitiveModeTabs"]);
      const { profile } = await getLocal(["profile"]);
      for (const [tabId, on] of Object.entries(cognitiveModeTabs)) {
        if (on) sendToTab(Number(tabId), { type: "CM_PROFILE_UPDATED", profile }).catch(() => {});
      }
      return profile;
    }
    case "GET_AI_CONFIG": {
      const { aiConfig } = await getLocal(["aiConfig"]);
      return { ...aiConfig, apiKey: aiConfig.apiKey ? "•".repeat(8) : "" }; // never echo the raw key back to a renderer unnecessarily
    }
    case "SET_AI_CONFIG": {
      await setLocal({ aiConfig: message.aiConfig });
      return { saved: true };
    }
    case "GET_AI_CONFIG_RAW": {
      // used only by the options page itself to prefill the key field for editing
      const { aiConfig } = await getLocal(["aiConfig"]);
      return aiConfig;
    }

    case "TOGGLE_COGNITIVE_MODE": {
      const tabId = message.tabId ?? sender.tab?.id;
      return setCognitiveModeForTab(tabId, message.on);
    }
    case "GET_COGNITIVE_MODE_STATE": {
      const { cognitiveModeTabs } = await getSession(["cognitiveModeTabs"]);
      return { on: Boolean(cognitiveModeTabs[message.tabId]) };
    }

    case "START_TASK":
      return startTask(message.label);
    case "CLEAR_TASK":
      return clearTask();
    case "RECONSTRUCT_TRAIL":
      return reconstructTrail();
    case "RETURN_TO_TASK":
      return returnToTask();

    case "GET_MISSION_CONTROL":
      return getMissionControlView();
    case "AUTO_GROUP":
      return autoGroupByOpener();
    case "SUSPEND_ALL_EXCEPT":
      return suspendAllExcept(message.groupId);
    case "RENAME_GROUP":
      return renameGroup(message.groupId, message.label);
    case "ACTIVATE_TAB":
      return chrome.tabs.update(message.tabId, { active: true });

    case "AI_CHUNK_TASK":
      return chunkTask(message.text);
    case "AI_SUMMARIZE_LEVELS":
      return summarizeLevels(message.text);
    case "AI_RECAP_SINCE":
      return recapSince(message.text);
    case "AI_WORKING_MEMORY":
      return extractWorkingMemory(message.text);

    case "GET_STICKY_STATE": {
      const { currentTask } = await getSession(["currentTask"]);
      const { chunkLists } = await getLocal(["chunkLists"]);
      const list = currentTask ? chunkLists[currentTask.id] : null;
      return { currentTask, list };
    }
    case "SET_CHUNK_STEP": {
      const { chunkLists } = await getLocal(["chunkLists"]);
      const list = chunkLists[message.taskId];
      if (!list) throw new Error("No such chunk list.");
      if (!list.steps[message.index]) throw new Error("Step index out of range.");
      list.steps[message.index].done = message.done;
      await setLocal({ chunkLists });
      return list;
    }
    case "GET_CHUNK_LIST": {
      const { chunkLists } = await getLocal(["chunkLists"]);
      return chunkLists[message.taskId] || null;
    }
    case "SAVE_CHUNK_LIST": {
      const { chunkLists } = await getLocal(["chunkLists"]);
      chunkLists[message.taskId] = message.list;
      await setLocal({ chunkLists });
      return { saved: true };
    }
    case "LIST_CHUNK_LISTS": {
      const { chunkLists } = await getLocal(["chunkLists"]);
      return Object.entries(chunkLists).map(([id, list]) => ({ id, ...list }));
    }

    case "GET_WORKING_MEMORY": {
      const { workingMemory } = await getLocal(["workingMemory"]);
      return workingMemory[message.tabId] || null;
    }
    case "SET_WORKING_MEMORY": {
      const { workingMemory } = await getLocal(["workingMemory"]);
      workingMemory[message.tabId] = { ...message.data, updatedAt: Date.now() };
      await setLocal({ workingMemory });
      return { saved: true };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// clean up per-tab state when a tab closes so storage doesn't grow forever
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { cognitiveModeTabs } = await getSession(["cognitiveModeTabs"]);
  if (tabId in cognitiveModeTabs) {
    delete cognitiveModeTabs[tabId];
    await setSession({ cognitiveModeTabs });
  }
  const { workingMemory } = await getLocal(["workingMemory"]);
  if (tabId in workingMemory) {
    delete workingMemory[tabId];
    await setLocal({ workingMemory });
  }
});
