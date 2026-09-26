# Community posts: Reddit, Hacker News, Product Hunt, Indie Hackers

One honest note before any of these: check each subreddit's self-promotion rules before posting, some (particularly r/dyslexia and r/ADHD) either ban promotional posts outright or want you to message the mods first and ask. Getting removed or banned for ignoring that costs more than it's worth. Where that applies, I've said so under the post.

## Reddit

### r/SideProject or r/InternetIsBeautiful (building-in-public audience)

**Title:** I built a free reading tool for dyslexia/ADHD after learning most people with reading difficulties never get diagnosed

**Body:**

The International Dyslexia Association estimates 15-20% of people show some sign of dyslexia, but only about 6-7% ever get a formal diagnosis. That gap is most of the point: the other ~10% get told nothing's wrong and given no accommodations.

I built ClearRead for a software hackathon: paste or upload text, adjust font, letter/word spacing, line length, color theme, syllable breaks, and read-aloud with live word highlighting. Every control is labeled by how strong the actual evidence for it is. Letter/word spacing has real controlled-study backing (Zorzi et al. 2012, PNAS); bionic reading doesn't (a 2,000-reader Readwise study found no speed improvement), so it's in there as an optional toggle labeled "mixed evidence," not sold as a fix.

There's also a browser extension, Cognitive Mode, for the ADHD side: reconstructing what you were doing before a distraction pulled you into five other tabs, breaking an assignment into steps you can actually start, and a calmer reading layout that follows you across pages.

No account, no signup, no data leaves your browser unless you turn on an optional AI feature with your own API key. Free, source is up on GitHub.

Link: [GitHub repo / demo link]

Would genuinely appreciate feedback, especially from anyone who deals with this stuff daily. If something about it is more marketing than it is useful, tell me, that's exactly the feedback I need.

---

### r/dyslexia or r/ADHD (check the sub's self-promo rules or message mods first)

**Title:** Made a free tool for reading/focus stuff, would love feedback from people who actually deal with this

**Body:**

I'm a high school student, I built this for a hackathon, and I wanted feedback from people this is actually meant for rather than just other developers.

ClearRead lets you change font, spacing, and layout to make text easier to read, plus syllable breaks and read-aloud. There's also a browser extension called Cognitive Mode with a "what was I doing?" button that reconstructs your trail back to what you were working on before you got sidetracked, a working-memory sidebar that keeps track of the main idea and key terms so you don't lose them, and a "chunk this" feature that turns a dense assignment into actual steps instead of one big wall of text.

It's free, no account, and I'm not trying to sell anything, I genuinely want to know if this is useful or if I'm missing something an actual daily experience with this would tell me right away. Happy to answer questions or take the post down if it's not welcome here, just let me know.

Link: [GitHub repo / demo link]

---

### r/webdev or r/chrome_extensions (developer audience, technical framing)

**Title:** Built a Manifest V3 extension with a deliberately minimal-permissions architecture (activeTab + on-demand injection instead of `<all_urls>` host_permissions)

**Body:**

Sharing this mostly for the architecture, though the actual use case (reading/focus support) is real too.

The extension has five main features (trail reconstruction from tab metadata, a working-memory sidebar, task chunking via an optional user-supplied AI key, a visual complexity detector, cross-tab mission control via `chrome.tabGroups`), and all the heavy UI is injected on demand through `chrome.scripting.executeScript` under `activeTab`, not a static `<all_urls>` content script. The only always-on content script is a deliberately tiny one that never reads page content, it just polls the background for whether there's an active checklist to show.

Background service worker is the single source of truth: popup, options page, and content scripts all talk to it exclusively through `chrome.runtime.sendMessage`, nothing touches `chrome.storage` from anywhere else. Also wrote an end-to-end test that loads the real unpacked extension in real Chromium via Playwright, including driving the `activeTab`-gated features through an actual OS-level keyboard shortcut (via xdotool) instead of faking the permission grant, since a synthetic `chrome.runtime.sendMessage` gets correctly denied by Chrome and I wanted the test to prove the real path works, not dodge around it.

Repo: [GitHub repo link]

Curious if anyone's hit issues with the `activeTab` + on-demand injection pattern at scale, or has a cleaner way to test MV3's user-gesture requirements than routing through the X server.

---

## Hacker News (Show HN)

**Title:** Show HN: ClearRead – reading/focus tool for dyslexia and ADHD, built for a hackathon

**Body:**

I'm a high school student. I built this for a software development hackathon (ReverieHacks 2026) after reading the International Dyslexia Association's numbers: roughly 15-20% of people show some sign of dyslexia, but only about 6-7% ever get a formal diagnosis. That gap, not the 6-7%, is most of what this is trying to help with.

ClearRead is a browser-based reading tool: adjustable font, letter/word spacing, line length, color themes, syllable breaks, bionic reading, and read-aloud with live word highlighting. Every control is labeled honestly by how strong the evidence behind it actually is, letter/word spacing has real controlled-study support (Zorzi et al. 2012, PNAS), bionic reading has weak evidence and is marked that way in the UI instead of oversold.

There's also a browser extension, Cognitive Mode, for ADHD-related focus support: reconstructing your trail back to what you were doing before a distraction, a working-memory sidebar, turning an assignment into concrete steps, a page-density detector that offers a cleaner layout, and cross-tab grouping/suspension.

No account, no backend, no data collection. Two or three features (task chunking, AI-enhanced summaries) need a model, so those are opt-in and use your own API key, off by default; everything else runs entirely client-side.

Source: [GitHub repo link]
Demo: [demo link]

Happy to answer anything about the implementation, the evidence behind the features, or what I got wrong.

---

## Product Hunt

**Tagline (max ~60 chars):** Reading and focus support that shows its evidence

**Description:**

ClearRead is a free browser reading tool plus a companion extension, Cognitive Mode, built for people with dyslexia or ADHD-related focus difficulties, and honestly, for anyone reading a dense page at 11pm.

ClearRead adjusts font, spacing, line length, and color theme, with syllable breaks, bionic reading, and read-aloud. Every feature is labeled by how strong the actual research behind it is, no feature here is marketed as a universal fix.

Cognitive Mode adds a "What was I doing?" button that reconstructs your trail after a distraction, a working-memory sidebar, a "chunk this" button that turns assignments into concrete steps, a visual complexity detector, and cross-tab tab grouping.

No account. No data collection. Two or three AI-backed features are opt-in with your own API key; everything else runs entirely in your browser.

**First comment (post as the maker):**

Hey, maker here. I built this for a software hackathon while in high school, so it's a small project, not a company, but I tried to build it the way I'd want an actual tool to work: nothing oversold, no dark patterns, no account wall. Would genuinely love feedback, especially anything that feels off or unfinished, that's more useful to me than a compliment right now.

---

## Indie Hackers

**Title:** Built a free reading/focus tool as a high schooler, here's what I learned about not overselling accessibility features

**Body:**

Some context: I built ClearRead for a software development hackathon. It's a browser reading tool (adjustable font, spacing, syllable breaks, bionic reading, read-aloud) plus a companion browser extension, Cognitive Mode, for ADHD-related focus support (trail reconstruction, task chunking, a working-memory sidebar, tab management).

The thing I'd actually want to share here isn't the feature list, it's a decision I made partway through: I looked up the actual evidence behind each accessibility feature before deciding whether to ship it as default-on, default-off, or not at all. Letter/word spacing has solid controlled-study support (Zorzi et al. 2012, PNAS). Bionic reading, despite being marketed everywhere as a productivity hack, has a 2,000-reader study (Readwise) showing no speed benefit and a slight slowdown. I still included it, some people report it helps them regardless of what the study says, but it's off by default and labeled "mixed evidence" directly in the UI instead of being sold as proven.

That felt like the right call for a project aimed at people who've probably already been oversold "fixes" that didn't work. I don't know yet if it's the right call for growth, being honest about a feature's weak evidence is not exactly a conversion-optimized headline. Curious how other people building in health/accessibility-adjacent spaces have handled that tension.

No account, no data collection, free. Source and demo: [GitHub repo / demo link]

Would appreciate any feedback, especially from anyone who's built something in this space and hit the same tradeoff.
