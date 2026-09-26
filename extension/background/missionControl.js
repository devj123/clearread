// Cross-tab "mission control" (item #10): instead of 30 unrelated tabs,
// show them clustered by what they belong to, and let the user suspend
// (chrome.tabs.discard) everything that isn't the task they're on right
// now. Discarding is not closing -- Chrome unloads the tab's memory but
// keeps it in the tab strip, and it reloads automatically the moment the
// user clicks back to it. Nothing is lost, the browser just stops
// spending RAM and the user's attention stops being pulled toward it.

import { getLocal, setLocal } from "./storage.js";

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
}

/**
 * Chrome's own tab groups are the source of truth for "grouped" tabs.
 * We layer our own labels/colors on top (stored locally, keyed by a
 * stable group id) purely for cosmetics Chrome's API doesn't expose,
 * like remembering a friendlier name across browser restarts.
 */
export async function getMissionControlView() {
  const window = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: window.id });
  const chromeGroups = await chrome.tabGroups.query({ windowId: window.id });
  const { tabGroupLabels } = await getLocal(["tabGroupLabels"]);

  const groupedTabIds = new Set();
  const groups = chromeGroups.map((g) => {
    const groupTabs = tabs.filter((t) => t.groupId === g.id);
    groupTabs.forEach((t) => groupedTabIds.add(t.id));
    return {
      id: g.id,
      title: g.title || tabGroupLabels[g.id]?.label || "Untitled group",
      color: g.color,
      collapsed: g.collapsed,
      tabs: groupTabs.map(toLightTab),
    };
  });

  const ungrouped = tabs.filter((t) => !groupedTabIds.has(t.id));
  const byHost = {};
  for (const t of ungrouped) {
    const host = hostnameOf(t.url || "");
    (byHost[host] ??= []).push(toLightTab(t));
  }

  return {
    groups,
    ungroupedByHost: Object.entries(byHost).map(([host, tabs]) => ({ host, tabs })),
    totalTabs: tabs.length,
  };
}

function toLightTab(t) {
  return { id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active, discarded: t.discarded };
}

/**
 * Suggests groups for currently-ungrouped tabs by opener lineage: tabs
 * opened from a common ancestor (clicked a link, ctrl-opened a result,
 * etc.) almost always belong to the same task, even if the domains
 * differ. Only clusters of 2+ get turned into a real tab group --
 * a single stray tab isn't a cluster.
 */
export async function autoGroupByOpener() {
  const window = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: window.id, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE });
  const byId = new Map(tabs.map((t) => [t.id, t]));

  function rootOf(tab) {
    let current = tab;
    const seen = new Set();
    while (current.openerTabId && byId.has(current.openerTabId) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.openerTabId);
    }
    return current.id;
  }

  const clusters = new Map();
  for (const tab of tabs) {
    const root = rootOf(tab);
    (clusters.get(root) ?? clusters.set(root, []).get(root)).push(tab.id);
  }

  const created = [];
  for (const [rootId, tabIds] of clusters) {
    if (tabIds.length < 2) continue;
    const groupId = await chrome.tabs.group({ tabIds });
    const rootTab = byId.get(rootId);
    const label = rootTab ? truncate(rootTab.title || hostnameOf(rootTab.url), 28) : "Task";
    await chrome.tabGroups.update(groupId, { title: label, color: pickColor(groupId) });
    created.push({ groupId, label, size: tabIds.length });
  }
  return created;
}

function truncate(str, n) {
  return str && str.length > n ? str.slice(0, n - 1) + "…" : str || "Group";
}

const COLORS = ["blue", "cyan", "green", "orange", "pink", "purple", "yellow"];
function pickColor(seed) {
  return COLORS[seed % COLORS.length];
}

/**
 * Discards (suspends) every tab NOT in keepGroupId and not the active
 * tab. Discarded tabs keep their title/favicon in the strip and reload
 * on click; this is not tab closing.
 */
export async function suspendAllExcept(keepGroupId) {
  const window = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: window.id });
  let suspended = 0;
  for (const tab of tabs) {
    if (tab.active) continue;
    if (keepGroupId != null && tab.groupId === keepGroupId) continue;
    if (tab.discarded) continue;
    if (tab.audible || tab.pinned) continue; // don't suspend something playing audio or pinned on purpose
    try {
      await chrome.tabs.discard(tab.id);
      suspended++;
    } catch {
      // some tabs (chrome:// pages, the active tab) can't be discarded; skip
    }
  }
  return { suspended };
}

export async function renameGroup(groupId, label) {
  await chrome.tabGroups.update(groupId, { title: label });
  const { tabGroupLabels } = await getLocal(["tabGroupLabels"]);
  tabGroupLabels[groupId] = { label, updatedAt: Date.now() };
  await setLocal({ tabGroupLabels });
}
