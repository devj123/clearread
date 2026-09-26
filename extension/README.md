# ClearRead: Cognitive Mode

ReverieHacks 2026, Software Development track. Built on top of [ClearRead](../README.md), the reading tool from the same submission.

A browser extension for readers who lose their place: reconstructs what you were doing before you got pulled into a rabbit hole of tabs, turns a dense assignment into a checklist you can actually start, and shows any page in a calmer layout. Five features, one underlying idea: most reading and focus problems aren't about willpower, they're about the browser giving you no scaffolding to hold your place in. Cognitive Mode is that scaffolding.

## Install

No Chrome Web Store listing yet, this is a hackathon submission. Load it unpacked:

1. Open `chrome://extensions`.
2. Turn on Developer mode (top right).
3. Click "Load unpacked" and select this `extension/` folder.
4. Pin the icon if you want quick access to the popup.

Requires Chrome 116 or newer (`chrome.tabGroups` and `chrome.scripting` need it).

## What it does

**"What was I doing?"** (Ctrl+Shift+Y). Reconstructs the trail of tabs, searches, and page loads that led to wherever you are now, entirely from `chrome.tabs` and `chrome.webNavigation` metadata: titles, URLs, opener relationships. It never reads page content to do this. "Start a task" marks the current tab as home base; "Return to task" jumps back to it and sweeps every tab opened since into a collapsed grey "Detour" group, not closed, just out of the way.

**Working-memory sidebar.** A panel that tracks the main idea, the people and terms introduced so far, key numbers, and a short recap of what happened a couple of paragraphs back, the things a reader normally has to hold in their head. The default version is built from page structure alone: repeated capitalized phrases as candidate terms, a regex pass for numbers and years, the first sentence as the main idea. An "Enhance with AI" button exists for a sharper version when you've opted into AI features.

**Chunk this task.** Select an assignment's instructions, right-click "Chunk this into steps," and get back 4 to 8 concrete, physically-startable steps instead of a wall of text. This one genuinely needs a model. There's no rule-based way to turn "Write a 5-paragraph essay on the causes of the French Revolution" into a real first step; that takes actually understanding the assignment. The checklist follows you across tabs through a small always-on pill in the corner of every page (see `content/cm-pill.js`), so it's visible whether you chunked it from the assignment page or a completely different tab.

**Visual complexity detector.** Runs a heuristic scoring pass on page density (tiny text, run-on paragraphs, heavy nav/ad chrome, link-dense main content) and offers a cleaned reading view when a page crosses the threshold, instead of asking you to configure a reading mode per site. The same profile (font, spacing, theme, bionic reading, syllable marks) carries over from the original ClearRead app.

**Attention-aware summaries.** Inside reading mode: a "Summarize" button for a 10-second and a 1-minute version of the page, and a "Catch me up" button that recaps roughly the last screenful of text you scrolled past, on the theory that if you're reaching for this button, you scrolled through it without actually reading it. Both need AI. Neither pretends to track your eyes or attention directly, they work from scroll position, which is the honest thing this extension can actually measure.

**Cross-tab mission control.** The popup shows your tabs clustered by Chrome tab group, plus an "Auto-group tabs" button that clusters ungrouped tabs by opener lineage (a tab opened from another tab almost always belongs to the same task, even across different domains), plus "Suspend the rest," which discards every tab outside the group you're working in. Discarding isn't closing: Chrome unloads the tab's memory and reloads it automatically the moment you click back.

## AI features are opt-in, and that's a real architectural line

The original ClearRead's whole pitch was "nothing leaves your browser." Chunking an assignment, enhancing the working-memory sidebar, and the two attention-aware summary buttons are the one place that promise has to bend, because turning "Write a 5-paragraph essay" into real steps needs a model that understands the assignment, not a regex.

So the bend is scoped as tightly as it can be: those four features and only those four features call out to an API, and only after you turn AI on and paste in your own key on the Options page. Off by default. Every other feature, "What was I doing," the sidebar's default view, mission control, the complexity detector, runs entirely on-device with zero network calls, key or no key. See [`PRIVACY.md`](PRIVACY.md) for the full accounting of what gets sent, when, and to which provider.

## Architecture

- `manifest.json`, MV3 with deliberately minimal permissions: `activeTab` + `scripting` for the heavy on-demand UI (dock, reading overlay, sidebar, chunk checklist, trail card), so most tabs never get the broad "read and change all your data on all websites" warning. The one static content script, `content/cm-pill.js`, runs everywhere but is tiny by design: it never reads page content, only asks the background for sticky-checklist state.
- `background/background.js` is the single source of truth. Every other surface (popup, options, content scripts) talks to it over `chrome.runtime.sendMessage`; nothing else touches `chrome.storage` directly. `background/storage.js` defines the schema, `background/trail.js` is the heuristic trail reconstruction, `background/missionControl.js` is tab clustering/suspension, `background/ai.js` is the one file in the whole extension that calls an external API.
- `content/reader-engine.js` has the syllable splitter and rendering logic ported from the original ClearRead's `js/syllables.js` and `js/app.js`, plus the complexity scorer and a readability-style content extractor.
- `content/content.js` builds the on-demand UI: dock, complexity banner, reading overlay, working-memory sidebar, chunk checklist, trail card.
- `popup/` and `options/` are the two standalone UI surfaces, same message-passing rule as everything else.

## Testing

`tests/load.mjs` loads the real unpacked extension in real Chromium via Playwright and drives it end to end: background service worker starts clean, the dock injects and its four tools work (reading mode, working-memory sidebar, chunk-this-page, attention-aware summaries), the trail card renders, and the AI-gated features fail with a clear message rather than crashing when no key is configured. It also exercises the `activeTab` permission model honestly: toggling Cognitive Mode on has to go through the real `toggle-cognitive-mode` keyboard command dispatched at the X server level, not a synthetic message, because that's the actual gate Chrome enforces. Run it with:

```
xvfb-run -a node tests/load.mjs
```

(needs `xdotool` on `PATH`; see the comment at the top of the file for why).

## Known limitations

Mission control's auto-grouping works within the current window only; it doesn't merge tabs across separate browser windows. The complexity detector and readability extractor are heuristics, not a real Readability.js port, so they'll misjudge some unusual page layouts, the reading overlay says so plainly when it can't find a clean candidate instead of guessing badly. The working-memory sidebar's default heuristic mode is noticeably weaker than its AI-enhanced mode; that gap is intentional, not hidden, the badge at the top of the sidebar always says which mode produced what you're looking at.
