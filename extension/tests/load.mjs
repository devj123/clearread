// Loads the unpacked extension in real Chromium via Playwright and drives
// it end to end: background service worker starts clean, the always-on
// pill injects without error, toggling Cognitive Mode on a tab injects the
// dock/reader/chunk/trail UI, and the AI-disabled path surfaces a real
// error instead of crashing. This is the load-unpacked smoke test for
// extension/ -- see ../../tests/smoke.mjs for the original web app's
// equivalent.
//
// Run with: xvfb-run -a node tests/load.mjs
// (extensions need a real display; MV3 service workers don't reliably
// register under plain headless launches. Also needs xdotool on PATH --
// see sendGlobalKeystroke() below for why.)

import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..");
const CHROME_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// chrome.commands keyboard shortcuts are dispatched by Chrome's own global
// accelerator table, not by the page's key event pipeline -- CDP-level
// input (what page.keyboard.press sends) never reaches it, so activeTab
// never gets granted and chrome.scripting.executeScript is correctly
// refused. Routing the same keystroke through the X server itself, as a
// real user's key press would arrive, is what actually satisfies Chrome's
// "did the user invoke the extension" check for activeTab.
function sendGlobalKeystroke(combo) {
  const ids = execSync("xdotool search --name '.*'").toString().trim().split("\n").filter(Boolean);
  let target = null;
  for (const id of ids) {
    let name = "";
    try {
      name = execSync(`xdotool getwindowname ${id}`).toString().trim();
    } catch {
      // window vanished between search and query; skip it
    }
    if (name.includes("Chromium") && !name.toLowerCase().includes("clipboard")) target = id;
  }
  if (!target) throw new Error("sendGlobalKeystroke: could not find the Chromium browser window via xdotool.");
  try {
    execSync(`xdotool windowfocus ${target}`);
  } catch {
    // best-effort; Xvfb has no window manager so this can warn without
    // actually failing the key delivery
  }
  execSync(`xdotool key --window ${target} ${combo}`);
}

const failures = [];
function check(label, cond) {
  if (cond) {
    console.log(`  ok  - ${label}`);
  } else {
    console.log(`FAIL  - ${label}`);
    failures.push(label);
  }
}

const TEST_HTML = `<!DOCTYPE html>
<html><head><title>Sample Reading Page</title></head>
<body>
<nav>nav</nav>
<article>
<h1>The History of the Lighthouse Keeper</h1>
<p>The Lighthouse Keeper worked at the edge of the harbor for thirty-one years. The Lighthouse Keeper knew every
current and every storm that passed through the channel, and the town of Millbrook depended on that knowledge more
than anyone admitted out loud.</p>
<p>In 1962, a storm struck the coastline and damaged the original tower. The Lighthouse Keeper rebuilt it by hand
over eleven months, using $4,200 raised by the town of Millbrook and a crew of six volunteers who returned every
weekend until it was finished.</p>
<p>By 1975, the light was visible for 22 miles on a clear night, and ships from three neighboring ports used it to
navigate the channel safely. The Lighthouse Keeper retired in 1993, having missed only four nights of duty in over
three decades.</p>
</article>
</body></html>`;

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(TEST_HTML);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const testUrl = `http://127.0.0.1:${port}/`;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-ext-test-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: CHROME_PATH,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const consoleErrors = [];
  context.on("weberror", (e) => consoleErrors.push(String(e.error())));

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    check("background service worker registered", Boolean(worker));

    const extensionId = new URL(worker.url()).host;
    check("extension id resolved from service worker URL", /^[a-p]{32}$/.test(extensionId));

    // ---------- test page: content script injects cleanly ----------
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) pageErrors.push(msg.text());
    });
    await page.goto(testUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(600); // let cm-pill.js's initial GET_STICKY_STATE round trip settle
    check("no console/page errors after cm-pill.js loads on a normal page", pageErrors.length === 0);

    const pillRenders = await page.evaluate(() => Boolean(document.getElementById("cm-pill-root")));
    check("pill renders nothing with no active task/checklist (by design, see cm-pill.js)", !pillRenders);

    // ---------- options page: loads, shows real defaults, round-trips a save ----------
    const optionsPage = await context.newPage();
    const optionsErrors = [];
    optionsPage.on("pageerror", (err) => optionsErrors.push(String(err)));
    await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
    await optionsPage.waitForTimeout(400);
    check("no page errors on options.html", optionsErrors.length === 0);

    const defaultFont = await optionsPage.$eval("#opt-font", (el) => el.value);
    const defaultFontSize = await optionsPage.$eval("#opt-font-size", (el) => el.value);
    check("options page loaded the real default profile (font=system)", defaultFont === "system");
    check("options page loaded the real default profile (fontSize=19)", defaultFontSize === "19");

    await optionsPage.fill("#opt-font-size", "23");
    await optionsPage.dispatchEvent("#opt-font-size", "input");
    await optionsPage.click("#opt-save-profile");
    await optionsPage.waitForFunction(() => document.getElementById("opt-profile-status").textContent === "Saved.");
    check("saving the profile from options.html round-trips through background", true);

    await optionsPage.reload();
    await optionsPage.waitForTimeout(400);
    const reloadedFontSize = await optionsPage.$eval("#opt-font-size", (el) => el.value);
    check("saved profile value persisted across an options.html reload", reloadedFontSize === "23");

    const aiFieldsDisabledByDefault = await optionsPage.$eval("#opt-ai-fields", (el) =>
      el.classList.contains("cmo-disabled")
    );
    check("AI fields are visually disabled until AI is turned on", aiFieldsDisabledByDefault);

    const tabId = await optionsPage.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0]?.id ?? null;
    }, testUrl);
    check("located the test page's tab id via chrome.tabs.query", typeof tabId === "number");

    // Turning Cognitive Mode on is gated behind activeTab, on purpose (see
    // manifest.json / background.js comments): chrome.scripting.executeScript
    // only gets host access to a tab after a genuine extension-recognized
    // user gesture on that tab -- clicking the toolbar icon, a context menu
    // click, or its keyboard command. A raw chrome.runtime.sendMessage sent
    // from an extension page is NOT one of those and correctly gets denied
    // with "Extension manifest must request permission to access this host"
    // -- that denial is the minimal-permissions design working as intended,
    // not a bug. To exercise the real path, this test focuses the tab and
    // fires the "toggle-cognitive-mode" keyboard command exactly like a user
    // would (see sendGlobalKeystroke() for why that has to go through X,
    // not CDP-level key events).
    await page.bringToFront();
    await page.waitForTimeout(300);
    sendGlobalKeystroke("ctrl+shift+u");

    await page.waitForSelector("#cm-root .cm-dock", { timeout: 5000 });
    const dockButtonCount = await page.$$eval("#cm-root .cm-dock button", (els) => els.length);
    check("dock injected with all four controls", dockButtonCount === 4);

    // reading mode
    await page.click('#cm-root .cm-dock button[title="Calm reading mode"]');
    await page.waitForSelector(".cm-reader-overlay h1", { timeout: 5000 });
    // extractReadableText() uses document.title, not an in-page <h1> --
    // that's "Sample Reading Page" here, per TEST_HTML's <title>.
    const readerTitle = await page.$eval(".cm-reader-overlay h1", (el) => el.textContent);
    check("reading overlay used the page title", readerTitle === "Sample Reading Page");
    const readerParaCount = await page.$$eval(".cm-reader-overlay .cm-reader-output p", (els) => els.length);
    check("reading overlay rendered all three paragraphs", readerParaCount === 3);
    const readerBodyText = await page.$eval(".cm-reader-overlay .cm-reader-output", (el) => el.textContent);
    check("reading overlay's extracted paragraphs contain the article content", readerBodyText.includes("Lighthouse Keeper"));
    await page.screenshot({ path: path.join(__dirname, "..", "media", "reader-overlay.png") }).catch(() => {});

    // attention-aware summaries (#9), also AI-gated -- same honest-failure check
    await page.click('.cm-reader-toolbar button[title="10-second and 1-minute summaries"]');
    await page.waitForSelector(".cm-summary-panel .cm-error", { timeout: 5000 });
    const summarizeError = await page.$eval(".cm-summary-panel .cm-error", (el) => el.textContent);
    check("leveled summary with AI disabled shows the key error, not a crash", summarizeError.includes("Options"));
    await page.click(".cm-summary-panel .cm-summary-close");

    await page.click('.cm-reader-toolbar button[title="I stopped paying attention -- recap what I just scrolled past"]');
    await page.waitForSelector(".cm-summary-panel .cm-error", { timeout: 5000 });
    const recapError = await page.$eval(".cm-summary-panel .cm-error", (el) => el.textContent);
    // with no scrolling yet, this hits the "not enough scrolled-past text" guard before it would even reach the AI call
    check('"catch me up" with nothing scrolled past yet fails clearly, not silently', recapError.includes("keep reading"));
    await page.click(".cm-summary-panel .cm-summary-close");

    await page.click(".cm-reader-overlay .cm-close");
    await page.waitForSelector(".cm-reader-overlay", { state: "detached", timeout: 5000 });
    check("reading overlay closes cleanly", true);

    // working-memory sidebar (heuristic path, no AI key needed)
    await page.click('#cm-root .cm-dock button[title="Working-memory sidebar"]');
    await page.waitForSelector(".cm-sidebar", { timeout: 5000 });
    await page.waitForFunction(() => {
      const badge = document.querySelector(".cm-sidebar .cm-mode-badge");
      return badge && badge.textContent.includes("page structure");
    }, { timeout: 5000 });
    const chips = await page.$$eval(".cm-sidebar .cm-chip", (els) => els.map((e) => e.textContent));
    check("working-memory sidebar found at least one recurring term heuristically", chips.length > 0);
    check('sidebar found "Lighthouse Keeper" as a recurring term', chips.some((c) => c.includes("Lighthouse")));

    // chunk-this-task: AI is off, so this must fail loudly and clearly, not silently
    await page.click('#cm-root .cm-dock button[title="Chunk this page into steps"]');
    await page.waitForSelector(".cm-chunk-overlay .cm-error", { timeout: 5000 });
    const chunkError = await page.$eval(".cm-chunk-overlay .cm-error", (el) => el.textContent);
    check("chunking with AI disabled shows the bring-your-own-key error, not a crash", chunkError.includes("Options"));

    // "What was I doing?" trail card, driven the same way background.js's
    // command handler does (RECONSTRUCT_TRAIL, then push CM_SHOW_TRAIL)
    const trailResult = await optionsPage.evaluate(async (tid) => {
      const reconstruct = await chrome.runtime.sendMessage({ type: "RECONSTRUCT_TRAIL" });
      await chrome.tabs.sendMessage(tid, { type: "CM_SHOW_TRAIL", result: reconstruct.result });
      return reconstruct;
    }, tabId);
    check("RECONSTRUCT_TRAIL responded ok", trailResult?.ok === true);
    await page.waitForSelector(".cm-trail-card", { timeout: 5000 });
    const trailText = await page.$eval(".cm-trail-card", (el) => el.textContent);
    check("trail card rendered narration text", trailText.includes("What was I doing?"));

    // turn Cognitive Mode back off and confirm the UI tears down
    const toggleOffResult = await optionsPage.evaluate(
      async (tid) => chrome.runtime.sendMessage({ type: "TOGGLE_COGNITIVE_MODE", tabId: tid, on: false }),
      tabId
    );
    check("TOGGLE_COGNITIVE_MODE off succeeded", toggleOffResult?.ok === true);
    await page.waitForFunction(() => !document.querySelector("#cm-root .cm-dock"), { timeout: 5000 });
    check("dock and overlays torn down after turning Cognitive Mode off", true);

    check("no page/console errors accumulated across the whole run", pageErrors.length === 0);
    check("no uncaught web errors (page or worker) across the whole run", consoleErrors.length === 0);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    server.close();
  }

  console.log(`\n${failures.length === 0 ? "All checks passed." : `${failures.length} check(s) failed:`}`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
