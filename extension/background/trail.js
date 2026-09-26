// Reconstructs "how did I get here" from real browser signals: tab
// creation, navigation, and activation events, no AI required. This is
// the "What was I doing?" feature (items #1 / #3 from the brief -- they
// described the same feature twice, so they're implemented as one).
//
// Design choice worth calling out: this ONLY uses chrome.tabs /
// chrome.webNavigation metadata (titles, URLs, opener relationships).
// It never reads page content, so there's no privacy tradeoff here and
// no host_permissions needed for it -- unlike the AI-backed features,
// this one keeps the "nothing leaves your browser" promise completely
// intact, and it works with zero setup, no API key required.

import { getSession, setSession, trailMaxLength } from "./storage.js";

const SEARCH_PATTERNS = [
  { host: "google.", param: "q" },
  { host: "bing.com", param: "q" },
  { host: "duckduckgo.com", param: "q" },
  { host: "search.yahoo.com", param: "p" },
];

function extractSearchQuery(urlString) {
  try {
    const url = new URL(urlString);
    for (const pattern of SEARCH_PATTERNS) {
      if (url.hostname.includes(pattern.host) && url.pathname.includes("search")) {
        const q = url.searchParams.get(pattern.param);
        if (q) return q;
      }
    }
  } catch {
    // not a valid URL, ignore
  }
  return null;
}

async function pushTrailEvent(event) {
  const { trail } = await getSession(["trail"]);
  const next = [...trail, { ...event, timestamp: Date.now() }];
  const max = trailMaxLength();
  await setSession({ trail: next.length > max ? next.slice(next.length - max) : next });
}

export function registerTrailListeners() {
  chrome.tabs.onCreated.addListener((tab) => {
    pushTrailEvent({
      action: "opened",
      tabId: tab.id,
      openerTabId: tab.openerTabId ?? null,
      title: tab.title || "",
      url: tab.url || "",
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    const query = extractSearchQuery(tab.url || "");
    if (query) {
      pushTrailEvent({ action: "searched", tabId, query, title: tab.title || "", url: tab.url || "" });
    } else {
      pushTrailEvent({ action: "navigated", tabId, title: tab.title || "", url: tab.url || "" });
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    pushTrailEvent({ action: "activated", tabId });
  });
}

/**
 * Marks the currently active tab as "the task" -- the place Return to
 * Task will bring the user back to, and the checkpoint the trail
 * narration starts from.
 */
export async function startTask(label) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab) throw new Error("No active tab to start a task from.");
  const task = {
    id: `task_${Date.now()}`,
    label: label || activeTab.title || "Untitled task",
    originTabId: activeTab.id,
    originUrl: activeTab.url || "",
    originTitle: activeTab.title || "",
    startedAt: Date.now(),
  };
  await setSession({ currentTask: task });
  return task;
}

export async function clearTask() {
  await setSession({ currentTask: null });
}

/**
 * Builds the human-readable breadcrumb. Collapses consecutive events on
 * the same tab (a page firing three onUpdated events while it loads
 * shouldn't produce three breadcrumb steps) and drops raw "activated"
 * noise in favor of the opened/navigated/searched events, which are what
 * actually describe a trail of attention.
 */
export async function reconstructTrail() {
  const { trail, currentTask } = await getSession(["trail", "currentTask"]);
  const sinceTs = currentTask ? currentTask.startedAt : trail.length ? trail[0].timestamp : 0;
  const relevant = trail.filter((e) => e.timestamp >= sinceTs && e.action !== "activated");

  const collapsed = [];
  for (const event of relevant) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.tabId === event.tabId && prev.action === event.action && event.action === "navigated") {
      collapsed[collapsed.length - 1] = event; // keep the latest title/url for that tab
    } else {
      collapsed.push(event);
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const steps = [];
  if (currentTask) {
    steps.push(`You started on "${currentTask.originTitle || currentTask.originUrl}" for ${currentTask.label}`);
  } else if (collapsed.length) {
    steps.push(`Earliest tab I can trace back to: "${collapsed[0].title || collapsed[0].url}"`);
  }

  for (const event of collapsed) {
    if (currentTask && event.tabId === currentTask.originTabId && event.action !== "searched") continue;
    if (event.action === "opened") {
      steps.push(`opened "${event.title || event.url}"`);
    } else if (event.action === "searched") {
      steps.push(`searched "${event.query}"`);
    } else if (event.action === "navigated") {
      steps.push(`ended up on "${event.title || event.url}"`);
    }
  }

  if (activeTab && (!collapsed.length || collapsed[collapsed.length - 1].tabId !== activeTab.id)) {
    steps.push(`now here: "${activeTab.title || activeTab.url}"`);
  }

  return {
    narration: steps.join(" → "),
    hasTask: Boolean(currentTask),
    currentTask,
    stepCount: steps.length,
  };
}

/**
 * Return to Task: focus the origin tab, and sweep every tab opened since
 * the task started (that isn't the origin tab) into a collapsed, grey
 * "Detour" tab group -- not closed, so nothing is lost, just out of the
 * way so the tab bar stops being the distraction.
 */
export async function returnToTask() {
  const { currentTask, trail } = await getSession(["currentTask", "trail"]);
  if (!currentTask) throw new Error("No active task to return to.");

  await chrome.tabs.update(currentTask.originTabId, { active: true });

  const detourTabIds = [
    ...new Set(
      trail
        .filter((e) => e.timestamp >= currentTask.startedAt && e.tabId && e.tabId !== currentTask.originTabId)
        .map((e) => e.tabId)
    ),
  ];

  const existingTabs = [];
  for (const id of detourTabIds) {
    try {
      await chrome.tabs.get(id);
      existingTabs.push(id);
    } catch {
      // tab was already closed, skip it
    }
  }

  if (existingTabs.length) {
    const groupId = await chrome.tabs.group({ tabIds: existingTabs });
    await chrome.tabGroups.update(groupId, { title: "Detour", color: "grey", collapsed: true });
  }

  return { returnedTo: currentTask.originTabId, groupedCount: existingTabs.length };
}
