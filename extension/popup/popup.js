// Popup UI: the quick-access surface for the three background-driven
// features that don't need to be on the page itself -- toggling
// Cognitive Mode, reconstructing the trail, and mission control. Like
// every other surface in this extension, it never touches
// chrome.storage or chrome.tabs directly for anything background.js
// already owns; it only sends messages and renders what comes back.

let activeTabId = null;

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
      else {
        const err = new Error(res.error || "Unknown error.");
        err.isAIDisabled = Boolean(res.isAIDisabled);
        reject(err);
      }
    });
  });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  wireToggle();
  wireTrail();
  wireTask();
  wireMissionControl();

  await Promise.all([refreshToggle(), refreshTask(), refreshMissionControl()]);
}

// ---------- Cognitive Mode toggle ----------

function wireToggle() {
  document.getElementById("cm-toggle").addEventListener("change", async (e) => {
    if (activeTabId == null) return;
    try {
      await sendBg({ type: "TOGGLE_COGNITIVE_MODE", tabId: activeTabId, on: e.target.checked });
    } catch {
      e.target.checked = !e.target.checked; // roll back on failure (e.g. a chrome:// page)
    }
  });
}

async function refreshToggle() {
  if (activeTabId == null) return;
  try {
    const { on } = await sendBg({ type: "GET_COGNITIVE_MODE_STATE", tabId: activeTabId });
    document.getElementById("cm-toggle").checked = Boolean(on);
  } catch {
    // ignore -- leave the toggle at its default
  }
}

// ---------- "What was I doing?" ----------

function wireTrail() {
  document.getElementById("cm-trail-btn").addEventListener("click", async () => {
    const btn = document.getElementById("cm-trail-btn");
    const resultBox = document.getElementById("cm-trail-result");
    const narrationEl = document.getElementById("cm-trail-narration");
    const returnBtn = document.getElementById("cm-trail-return");

    btn.disabled = true;
    btn.textContent = "Reconstructing...";
    try {
      const result = await sendBg({ type: "RECONSTRUCT_TRAIL" });
      narrationEl.textContent = result.narration || "No trail yet. Keep browsing and this will fill in.";
      returnBtn.hidden = !result.hasTask;
      resultBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "What was I doing?";
    }
  });

  document.getElementById("cm-trail-return").addEventListener("click", async () => {
    await sendBg({ type: "RETURN_TO_TASK" }).catch(() => {});
    window.close();
  });

  document.getElementById("cm-trail-dismiss").addEventListener("click", () => {
    document.getElementById("cm-trail-result").hidden = true;
  });
}

// ---------- current task ----------

function wireTask() {
  document.getElementById("cm-task-start").addEventListener("click", async () => {
    const input = document.getElementById("cm-task-input");
    await sendBg({ type: "START_TASK", label: input.value.trim() || undefined }).catch(() => {});
    input.value = "";
    await refreshTask();
  });

  document.getElementById("cm-task-clear").addEventListener("click", async () => {
    await sendBg({ type: "CLEAR_TASK" }).catch(() => {});
    await refreshTask();
  });
}

async function refreshTask() {
  const sticky = await sendBg({ type: "GET_STICKY_STATE" }).catch(() => ({ currentTask: null }));
  const active = document.getElementById("cm-task-active");
  const none = document.getElementById("cm-task-none");
  if (sticky.currentTask) {
    document.getElementById("cm-task-label").textContent = sticky.currentTask.label;
    active.hidden = false;
    none.hidden = true;
  } else {
    active.hidden = true;
    none.hidden = false;
  }
}

// ---------- mission control ----------

function wireMissionControl() {
  document.getElementById("cm-auto-group").addEventListener("click", async () => {
    const status = document.getElementById("cm-mc-status");
    status.hidden = false;
    status.textContent = "Grouping...";
    try {
      const created = await sendBg({ type: "AUTO_GROUP" });
      status.textContent = created.length
        ? `Grouped into ${created.length} cluster${created.length === 1 ? "" : "s"}.`
        : "No clear clusters found among the ungrouped tabs.";
    } catch (err) {
      status.textContent = `Couldn't group tabs: ${err.message}`;
    }
    await refreshMissionControl();
  });

  document.getElementById("cm-suspend-all").addEventListener("click", async () => {
    const status = document.getElementById("cm-mc-status");
    status.hidden = false;
    status.textContent = "Suspending...";
    try {
      const { suspended } = await sendBg({ type: "SUSPEND_ALL_EXCEPT", groupId: null });
      status.textContent = `Suspended ${suspended} tab${suspended === 1 ? "" : "s"} not in the active group.`;
    } catch (err) {
      status.textContent = `Couldn't suspend tabs: ${err.message}`;
    }
    await refreshMissionControl();
  });
}

async function refreshMissionControl() {
  const groupsEl = document.getElementById("cm-groups");
  groupsEl.innerHTML = '<p class="cmp-loading">Loading tabs...</p>';
  try {
    const view = await sendBg({ type: "GET_MISSION_CONTROL" });
    document.getElementById("cm-tab-count").textContent = `${view.totalTabs} tab${view.totalTabs === 1 ? "" : "s"}`;
    groupsEl.innerHTML = "";

    if (!view.groups.length && !view.ungroupedByHost.length) {
      groupsEl.innerHTML = '<p class="cmp-empty">No tabs in this window yet.</p>';
      return;
    }

    view.groups.forEach((g) => groupsEl.appendChild(renderGroup(g)));

    if (view.ungroupedByHost.length) {
      const wrap = document.createElement("div");
      wrap.className = "cmp-group";
      wrap.style.borderLeftColor = "#c7cdd6";
      const title = document.createElement("div");
      title.className = "cmp-group-title-row";
      const totalUngrouped = view.ungroupedByHost.reduce((sum, h) => sum + h.tabs.length, 0);
      title.innerHTML = `<span class="cmp-group-title">Ungrouped</span><span class="cmp-group-count">${totalUngrouped} tab${totalUngrouped === 1 ? "" : "s"}</span>`;
      wrap.appendChild(title);
      const list = document.createElement("div");
      list.className = "cmp-group-tabs";
      list.textContent = view.ungroupedByHost.map((h) => `${h.host} (${h.tabs.length})`).join(", ");
      wrap.appendChild(list);
      groupsEl.appendChild(wrap);
    }
  } catch (err) {
    groupsEl.innerHTML = `<p class="cmp-empty">Couldn't load tabs: ${escapeHtml(err.message)}</p>`;
  }
}

const GROUP_COLOR_HEX = {
  grey: "#8b93a0",
  blue: "#2f5fa8",
  red: "#c94040",
  yellow: "#c9a227",
  green: "#3f9159",
  pink: "#c2529b",
  purple: "#7c5fc9",
  cyan: "#2f9bb0",
  orange: "#cc7a2e",
};

function renderGroup(g) {
  const wrap = document.createElement("div");
  wrap.className = "cmp-group";
  wrap.style.borderLeftColor = GROUP_COLOR_HEX[g.color] || "#8b93a0";

  const titleRow = document.createElement("div");
  titleRow.className = "cmp-group-title-row";
  titleRow.innerHTML = `<span class="cmp-group-title">${escapeHtml(g.title)}</span><span class="cmp-group-count">${g.tabs.length} tab${g.tabs.length === 1 ? "" : "s"}</span>`;
  wrap.appendChild(titleRow);

  const list = document.createElement("div");
  list.className = "cmp-group-tabs";
  list.textContent = g.tabs.map((t) => t.title || t.url).join(", ");
  wrap.appendChild(list);

  return wrap;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("cm-open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
  init();
});
