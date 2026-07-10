# Popup Zapper — Mobile (iPhone + Android) support

**Date:** 2026-07-10
**Status:** Design approved, pending spec review
**Approach:** A — adapt the single codebase (no fork, no native app, no fees)

## Goal

Make the existing Popup Zapper userscript run well on phones with **full feature
parity** and an **adaptive UI**, distributed through extension-capable mobile
browsers. No separate app, no App Store, no Mac/Xcode, no ongoing fees.

Target managers:

- **Android:** Firefox + Violentmonkey — full `GM_*` support, auto-update works
  exactly like desktop. No compatibility work needed here; only mobile-UX.
- **iPhone:** Safari + the free **Userscripts** app (quoid). This is the
  constraint that drives the design: its GM API is **async-only** and missing
  some calls.

Out of scope: native Safari Web Extension, App Store / Play Store distribution,
Brave-on-iOS (WebKit browsers can't run userscripts). Chrome-on-Android and
Safari-on-iOS-without-the-app also can't run userscripts and are not targeted.

## Compatibility facts (verified 2026-07-10)

Source: quoid/userscripts README, issue #189.

| Capability | Violentmonkey (Android) | Userscripts app (iPhone) |
|---|---|---|
| Synchronous `GM_getValue`/`GM_setValue` | yes | **no — async `GM.getValue` only** |
| `GM.xmlHttpRequest` / legacy `GM_xmlhttpRequest` | yes | yes |
| `GM.setClipboard` | yes | yes (async) |
| `GM.openInTab` | yes | yes (async) |
| `GM_registerMenuCommand` | yes | **no** |
| `GM.addStyle` | yes | yes |
| `GM_info` / `GM.info` | yes | yes (no `@grant` needed) |
| Auto-update via `@version`+`@updateURL` | yes, like desktop | partial — "does not correctly implement the entire update process" |

Two facts have architectural weight:

1. **No synchronous storage on iPhone.** The code currently loads its rule
   library synchronously at module top (`loadLibrary(getV)`) and reads
   `library.*` throughout. On the Userscripts app the only storage API returns a
   Promise, so the synchronous boot must become asynchronous.
2. **No `.user.js` navigation-intercept on iPhone.** The desktop "Update → open
   the raw `.user.js` → manager shows Reinstall" trick relies on
   Tampermonkey/Violentmonkey intercepting that navigation. Safari + Userscripts
   app does not do this, so the iPhone update story is "reinstall from the raw
   link," made as low-friction as possible and documented honestly.

## Components (four bounded pieces)

### 1. Async storage bootstrap (the one real refactor)

**What changes.** Storage load moves from synchronous module-top to an async
step that completes before the first render / first zap.

- New async entry: load the rule library **and** the theme preference via the GM
  adapter (below), then run the existing `boot()` (`runOnce()` + observer +
  `refreshControl()`).
- `library` remains the in-memory source of truth after load. Writes
  (`persist()`, theme save) become **fire-and-forget async** — we never need to
  await a write for correctness.
- **`installReloadDefense()` stays synchronous at `document-start`.** It depends
  only on `window.sessionStorage` (per-tab reload counting) and in-memory state,
  not GM storage, so the time-critical reload trap is installed immediately, before
  the async library resolves. This preserves anti-reload behavior during the
  brief async window.
- Consequence: a few-millisecond delay before the first automatic zap on the
  slowest manager. The MutationObserver + initial `runOnce()` after load cover
  anything that appears in that window. Acceptable.

**Why it works on desktop too.** Violentmonkey/Tampermonkey also expose async
`GM.getValue`, so a single async path serves every manager — no per-manager
branching in the boot flow.

**Boundary.** `lib/storage.js` gains an async `loadLibraryAsync(gmGet)` /
`saveLibrary(gmSet, library)` pair (or the existing functions are adapted to take
the async adapter). Its interface is: "give me async get/set, I give you a
library object and persist it." Unit-testable with a fake async store.

### 2. `lib/gm.js` — GM adapter

One small module that normalizes manager differences behind a stable interface.
Every export prefers the richest available API and falls back:

- `gmGet(key, dflt)` → `GM.getValue` ?? promisified `GM_getValue` ?? `null`
- `gmSet(key, val)` → `GM.setValue` ?? `GM_setValue`
- `gmXhr(details)` → `GM_xmlhttpRequest` ?? `GM.xmlHttpRequest` ?? `fetch` shim
- `gmClipboard(text)` → `GM_setClipboard` ?? `GM.setClipboard` ?? `navigator.clipboard.writeText`
- `gmOpenTab(url)` → `GM_openInTab` ?? `GM.openInTab` ?? `window.open` ?? `location.href`

`GM_registerMenuCommand` stays in its existing `try/catch` at the call site — on
iPhone it's simply absent and the on-page badge menu (our primary UI) covers it.

**Boundary.** Pure capability detection + thin wrappers; no app logic. Testable
by injecting fake globals. `main.js` and the update-check code call the adapter
instead of raw `GM_*`.

### 3. Adaptive (touch / small-screen) UI

Same components in `lib/ui.js`, responsive styles driven by a runtime check.

- `isTouch()` — coarse-pointer / `ontouchstart` / small-viewport detection
  (guarded for jsdom, like `prefersDark()`).
- **Badge:** on touch, always show the "Popup Zapper" label (no hover-expand,
  since touch has no hover). Tap still opens the menu.
- **Tap targets:** menu items, toggle, and picker-toolbar buttons get a minimum
  ~40px touch height on touch devices.
- **Panels:** `max-width:92vw` (already partly there) and scrollable; menu/pickers
  reposition so they never sit under the browser chrome.
- **Safe areas:** add `env(safe-area-inset-*)` padding to the fixed badge and the
  picker toolbar so they clear the iPhone notch and Safari's bottom toolbar.
- Desktop rendering is unchanged when `isTouch()` is false.

**Boundary.** UI factories keep their current signatures; a single `isTouch()`
helper toggles a handful of style branches. Existing ui tests stay valid (jsdom →
`isTouch()` false → desktop styles); add touch-path assertions.

### 4. Header metadata + distribution docs

- **Header:** `@grant` both the underscore and dotted forms of the APIs used
  (`GM_setValue`/`GM.setValue`, `GM_getValue`/`GM.getValue`, `GM_xmlhttpRequest`/
  `GM.xmlHttpRequest`, `GM_setClipboard`/`GM.setClipboard`, `GM_openInTab`/
  `GM.openInTab`, `GM.addStyle`). Keep `@connect *`, `@match *://*/*`,
  `@run-at document-start`, `@noframes`. Keep `GM_registerMenuCommand` granted for
  desktop; its absence on iPhone is harmless.
- **README / install guide** additions:
  - **Android:** install Firefox → add Violentmonkey from AMO → open the raw
    `.user.js` link → Install. Auto-updates like desktop.
  - **iPhone:** install the **Userscripts** app → enable it in Safari Settings →
    Extensions → add the script (via the app's directory or the raw link). Note
    plainly that **updates are semi-manual**: to update, re-open the raw link
    through the app / re-import. Provide the exact tap sequence.
- **Update flow on iPhone:** the desktop in-panel "Update → install page → reload"
  path is desktop-only. On touch/iPhone, the Settings update row instead surfaces
  a "Copy update link" + short reinstall instructions (no reliance on `.user.js`
  navigation-intercept). Desktop behavior is unchanged.

## Data flow

```
document-start:
  installReloadDefense()            // sync, sessionStorage only
  bootAsync():
    library = await gmGet("library")   // via lib/storage + lib/gm
    theme   = await gmGet("pz-theme")
    setTheme(theme)
    runOnce(); startObserver(); refreshControl()

runtime (unchanged, in-memory library):
  user/action → mutate library → persist() [async fire-and-forget]
  update check → gmXhr(raw) → updatePlan → in-panel state (desktop) / copy-link (touch)
```

## Testing

- **Unit (Vitest/jsdom):** async `loadLibraryAsync` with a fake async store; `gm.js`
  adapter fallbacks with injected fake globals; `isTouch()` touch-path style
  assertions in ui tests. Keep the existing 120 green.
- **Manual device pass (user-run, since the agent can't):**
  - Android Firefox+Violentmonkey: install, auto-update, zap a known popup site,
    Block-a-popup picker by tap, theme toggle, revert.
  - iPhone Safari+Userscripts app: install, rules persist across reloads (proves
    async storage), full menu by touch, safe-area spacing clears the toolbar,
    update via copy-link path.
- A short **device smoke checklist** added to the repo for repeatable testing.

## Risks / open points

- **iPhone auto-update is genuinely weaker.** Mitigation: honest docs + one-tap
  copy-link reinstall. Not solvable without a native wrapper (rejected).
- **Async boot timing:** verified the reload trap stays synchronous, so the only
  exposure is automatic zapping in the first few ms, covered by the observer.
- **`@grant` dual-listing:** confirm Violentmonkey ignores unknown dotted grants
  gracefully (expected; verify during implementation).
- No change to the desktop experience is intended; desktop tests must stay green.

## Non-goals

Native apps, store distribution, Brave/Chrome-on-mobile support, and any paid
tooling. A separate mobile build (Approach B) is explicitly rejected to avoid UI
drift and double maintenance.