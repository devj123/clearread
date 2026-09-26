// The one script that runs on every page without the user clicking
// anything. It does exactly one thing: ask the background service worker
// whether there's an active task with a step checklist, and if so, show a
// small corner pill so the checklist is genuinely visible "across tabs"
// as the feature was specced, rather than only living inside the one tab
// that made it. It never reads document content, never sends anything to
// an AI, and renders nothing when there's no active task -- most page
// loads, this script does one message round-trip and then nothing.
(function () {
  "use strict";
  if (window.top !== window) return; // don't run in iframes

  let root = null;

  function render(state) {
    const { currentTask, list } = state;
    if (!currentTask || !list || !list.steps?.length) {
      if (root) root.remove();
      root = null;
      return;
    }

    const done = list.steps.filter((s) => s.done).length;
    const total = list.steps.length;

    if (!root) {
      root = document.createElement("div");
      root.id = "cm-pill-root";
      document.documentElement.appendChild(root);
    }
    root.innerHTML = "";

    const pill = document.createElement("button");
    pill.className = "cm-pill";
    pill.innerHTML = `<span>${escapeHtml(list.title || currentTask.label)}</span><span class="cm-pill-progress">${done}/${total}</span>`;

    const panel = document.createElement("div");
    panel.className = "cm-pill-panel";
    const heading = document.createElement("h3");
    heading.textContent = list.title || currentTask.label;
    panel.appendChild(heading);

    list.steps.forEach((step, i) => {
      const row = document.createElement("div");
      row.className = "cm-pill-step" + (step.done ? " done" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(step.done);
      cb.id = `cm-pill-step-${i}`;
      cb.addEventListener("change", () => {
        chrome.runtime.sendMessage(
          { type: "SET_CHUNK_STEP", taskId: currentTask.id, index: i, done: cb.checked },
          (res) => {
            if (res?.ok) render({ currentTask, list: res.result });
          }
        );
      });
      const label = document.createElement("label");
      label.htmlFor = cb.id;
      label.textContent = step.text;
      row.appendChild(cb);
      row.appendChild(label);
      panel.appendChild(row);
    });

    const returnBtn = document.createElement("button");
    returnBtn.className = "cm-pill-return";
    returnBtn.textContent = "Return to task tab";
    returnBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "RETURN_TO_TASK" }));
    panel.appendChild(returnBtn);

    pill.addEventListener("click", () => panel.classList.toggle("open"));

    root.appendChild(pill);
    root.appendChild(panel);
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function refresh() {
    chrome.runtime.sendMessage({ type: "GET_STICKY_STATE" }, (res) => {
      if (chrome.runtime.lastError) return; // extension context gone (reload/update), fail silent
      if (res?.ok) render(res.result);
    });
  }

  refresh();
  // Cheap poll rather than a persistent connection: this pill is meant to
  // be nearly free. Every 5s is enough to feel live without holding a port
  // open on every single tab a user has.
  setInterval(refresh, 5000);
})();
