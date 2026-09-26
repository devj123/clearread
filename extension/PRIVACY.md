# Privacy: what Cognitive Mode actually does with your data

The original ClearRead's rule was nothing leaves your browser. This extension keeps that rule for six of its seven features and bends it, on purpose and only when you opt in, for the ones that genuinely need a model. This document is the full accounting, not a summary of it.

## Runs entirely on-device, no network calls, ever

**"What was I doing?" / trail reconstruction.** Built from `chrome.tabs` and `chrome.webNavigation` metadata only: tab titles, URLs, timestamps, opener relationships, and search-engine query parameters when you search on Google, Bing, DuckDuckGo, or Yahoo. Stored in `chrome.storage.session`, which Chrome clears when the browser closes. It never reads the content of any page. See `background/trail.js`.

**Working-memory sidebar, default mode.** Built by scanning the extracted page text on your machine for repeated capitalized phrases, numbers, and the first sentence of the article. Nothing about the page leaves the tab it came from. See `heuristicWorkingMemory()` in `content/content.js`.

**Visual complexity detector.** Reads the page's own DOM (font size, paragraph length, line height, count of nav/ad-style elements) to compute a density score, entirely with `document.*` and `getComputedStyle()`. No network call, no storage beyond a per-session "I dismissed this" flag. See `computeComplexityScore()` in `content/reader-engine.js`.

**Cross-tab mission control.** Reads `chrome.tabs` and `chrome.tabGroups` metadata (titles, URLs, opener IDs) to cluster and optionally suspend tabs. Suspending a tab (`chrome.tabs.discard()`) unloads its memory; it does not close it or send anything anywhere.

**The always-on pill (`content/cm-pill.js`).** The one script that runs on every page without you clicking anything first. It does exactly one thing: ask the background service worker whether there's an active task with a checklist, and render a small corner widget if so. It never reads `document` content on the host page at all, not even to check if there's readable text; that check only happens once you've explicitly turned Cognitive Mode on for that specific tab.

## Sends data to an AI provider, and only when you've opted in

Four features need an actual model, not a heuristic, to do what they claim to do: turning "Write a 5-paragraph essay" into concrete steps is not something a regex can do honestly.

- Chunk this task
- Working-memory sidebar's "Enhance with AI" button
- Attention-aware summaries ("Summarize" and "Catch me up")

All four are wired through one function, `callAI()` in `background/ai.js`, the only file in this extension that calls `fetch()` to anything outside the browser. Here's exactly what happens when you use one:

1. **Off by default.** `aiConfig.enabled` starts `false`. None of these four buttons will do anything but show you an error telling you to turn AI on in Options, until you do.
2. **You bring your own key.** There's no ClearRead-operated backend, no shared API key, no proxy server. You paste your own OpenAI or Anthropic API key into the Options page. It's stored in `chrome.storage.local`, which is local to your browser profile and is never synced to Chrome Sync or sent anywhere except directly to the provider you chose, in the `Authorization` (OpenAI) or `x-api-key` (Anthropic) header of the one request that feature makes.
3. **What gets sent, per feature:**
   - *Chunk this task* sends the selected text or the extracted page text (capped at a few thousand characters) and asks for a step list.
   - *Enhance with AI* (sidebar) sends the extracted page text so far and asks for a main idea, key terms, key numbers, and a recap.
   - *Summarize* sends the extracted page text and asks for a 10-second and a 1-minute summary.
   - *Catch me up* sends only the paragraphs your scroll position indicates you just passed, not the whole page.
   - Nothing else. No browsing history, no other tabs, no tab titles, no personal information, is ever included in these requests.
4. **Only on your action.** Every one of these calls happens synchronously in response to you clicking a button. None of them run automatically, on a timer, or in the background.

## What's stored, and where

| Data | Location | Cleared when |
|---|---|---|
| Reading profile (font, spacing, theme, etc.) | `chrome.storage.local` | You reset it or uninstall |
| AI config (enabled flag, provider, model, your API key) | `chrome.storage.local` | You clear it or uninstall |
| Chunk checklists | `chrome.storage.local` | You clear the task or uninstall |
| Working-memory snapshots | `chrome.storage.local`, keyed by tab ID | The tab closes |
| Trail ring buffer, current task, per-tab Cognitive Mode state | `chrome.storage.session` | The browser closes |

Nothing here is synced to a server ClearRead operates, because there isn't one. Uninstalling the extension removes all of it.
