# Popup Zapper — UI Redesign, ArchDaily De-blur Fix, and Auto-Update

**Date:** 2026-07-08
**Status:** Approved design (pending spec review)

## 1. Background & Problem

Popup Zapper is a Violentmonkey userscript that removes login/consent/newsletter/
paywall popups, restores degraded content, and defeats reload traps. It works, but
two things prompted this redesign:

1. **De-blur regressed on ArchDaily.** The page's article/images stay blurred.
2. **The UI has ~10 menu commands.** Too many, overlapping, and it gives almost no
   feedback so the user can't tell whether anything worked.

Separately, the author wants to **share it with a friend and push updates** that the
friend receives automatically.

## 2. Goals

- Fix the ArchDaily (Piano.io) blur so gated articles become readable again.
- Collapse the menu to **3 silent defaults + 3 buttons + Settings + a top toggle**.
- Give clear, per-action feedback (a status strip).
- Make blocking a popup reliable: ranked guesses **plus** manual DOM cycling.
- Let the user see, toggle, edit, and revert what's blocked, per site.
- Enable GitHub-based auto-update for the friend via a one-command release.

## 3. Non-Goals (YAGNI)

- Global keyboard shortcuts (cycling keys are scoped to the Block picker only).
- Cross-device rule sync, rule import/export.
- An in-page button that self-installs a new script version (impossible — the
  userscript manager owns installation).

## 4. Root Cause: ArchDaily De-blur

Evidence gathered from ArchDaily's live CSS:

```css
.piano-meter-overlay{ position:fixed; top:0; left:0; z-index:99999;
  background:rgba(255,255,255,0.8);
  mask:linear-gradient(0deg,#000 0%,transparent 100%);
  backdrop-filter:blur(8px);  display:none }
```

ArchDaily uses **Piano.io** metering. The gate is a full-viewport fixed overlay that
blurs its backdrop (the article) and is flipped from `display:none` to visible
**after the reader has consumed part of the article**.

Two concrete defects:

1. **The MutationObserver ignores attribute changes.** In `src/main.js`:
   `obs.observe(document.documentElement, { childList: true, subtree: true })`.
   When Piano trips the meter by toggling a **class/inline style** on an existing
   element (no node inserted), `runOnce()`/`restoreBlur` never re-fires, so
   late-applied blur is never removed. This matches "worked before, broke again."
2. **De-blur alone leaves a veil.** Even when caught, stripping `backdrop-filter`
   still leaves the overlay's semi-opaque `background: rgba(255,255,255,0.8)`
   covering the article. The overlay must be **removed**, not merely de-blurred.

### Fix

- Extend the observer to watch attributes:
  `{ childList: true, subtree: true, attributes: true, attributeFilter: ["style","class"] }`
  (keep the existing rAF debounce so we don't thrash).
- Add a **paywall-veil pass** to the safe default set: remove an element when it is
  `position: fixed`, covers ~the full viewport, has a high `z-index`, and either
  blurs its backdrop or matches a known metering vendor selector
  (`.piano-meter-overlay`, Poool, Pelcro, Zephr, etc.). This runs alongside the
  existing `removePaywallFrames`.
- Keep page-wide `restoreBlur` (filter + backdrop-filter) in the safe default pass.

## 5. Feature Consolidation

Every current feature is retained; nothing is dropped, only relocated.

| Old command | New home |
|---|---|
| Learn a popup | **Block** |
| Auto-zap (Unlock mode) | folded into **Block** (rules now back it) |
| Rule matching | **Block** / **Settings → Rules** |
| Manage rules | **Settings → Rules** |
| Reset meter, Keep-content | **default** + **Remove paywall** |
| Restore saved content | **Remove paywall** / **Revert** |
| Fetch clean copy | **Remove paywall** |
| Freeze auth (uBlock filters) | secondary action inside **Remove paywall** result |
| Consent auto-reject | **default (always on)** |
| Reload-trap defense, meta-refresh strip | **default (always on)** |
| De-blur / un-gate | **default (safe)** + **Reveal (deeper)** |
| Tracker cleanup | **Settings** (per-site toggle) |
| Disable on site | **top on/off toggle** |
| Activity log, Diagnostics | **Settings** |

## 6. The New UI

Badge menu (bottom-right, `[data-pz]`):

```
┌─────────────────────────────┐
│  ⚡ Zapper   [ On  ●——○ ]    │  ← site on/off toggle (top)
├─────────────────────────────┤
│  ◎  Block                   │
│  ⇪  Remove paywall          │
│  ↩  Revert                  │
├─────────────────────────────┤
│  ✓ Blocked div.modal        │  ← status strip (last action)
│  Still blocked? Reveal ▸     │  ← contextual, only if residual gating
├─────────────────────────────┤
│  ⚙  Settings                │
└─────────────────────────────┘
```

### 6.1 Always-on defaults (no buttons)

Run on every enabled site, invisibly, via the safe pass:

- Reject cookie/consent banners.
- Anti-reload: block automatic `reload()`/redirects, strip `<meta refresh>`; the page
  reloads only on an explicit user refresh.
- Safe de-blur: strip `blur()` filters and backdrop-blur.
- Remove sign-up gate overlays (positioned element + short "register to continue"
  text) and full-viewport paywall veils (§4).
- Unfreeze scroll (`html/body` overflow/position).

**Deliberately NOT automatic** (they break normal pages): clearing `max-height`
truncation and restoring `opacity:0`/`pointer-events:none`. These move to
**Reveal (deeper)**.

### 6.2 Block (melds Learn + Auto-zap + Rule matching)

- Opens a picker overlay. **Ranked candidates first** — ▶ cycles `1 of N` through the
  top-scoring guesses (`scorePopupCandidate`/`findBestGuess`), each outlined.
- **Manual DOM cycling** to fine-tune the current target: grow to parent / shrink to
  first child, via on-screen ▲/▼ and `[` / `]` (keys active only while the picker is
  open). Outline always wraps the current target.
- **Block** removes the target and saves a rule (keyword from `extractKeywords`).
- **Scope, non-annoying:** saves **site-local by default**; the same confirmation has a
  single **"apply on all sites"** checkbox that promotes it to global. One step.
- **Cancel/Esc** closes the picker with no change.
- Because rules now drive removal, the same popup is auto-removed on later visits
  (replacing blind auto-zap).

### 6.3 Remove paywall (melds Fetch-clean-copy + Keep-content + Freeze-auth)

One press runs the sequence:

1. Try to un-gate the current tab **in place** (safe + deep passes, veil removal).
2. If content is still withheld, **re-fetch the page cookie-free** (anonymous
   `GM_xmlhttpRequest`) and, failing that, use the **first-paint snapshot** captured
   at load.
3. **Open the clean, script-free content in a NEW tab**, leaving the original intact.

The result panel offers a secondary **"Block this paywall permanently"** action that
generates uBlock filter lines (the old Freeze-auth), for metered sites that degrade
after load.

### 6.4 Revert

Undo the **last Block**: re-insert the removed element at its original position and
delete the rule that Block just created. Uses an in-session undo stack holding
`{ node, parent, nextSibling, ruleRef }`.

### 6.5 Reveal (deeper) — contextual escalation

- The aggressive restore set: clear `max-height` truncation on long-text containers,
  restore inline `opacity:0`/`pointer-events:none` locks, and a more aggressive
  de-blur.
- **Surfaced contextually only.** After the safe pass, a lightweight detector scans for
  residual gating signals (long-text container with `max-height` clamp + hidden
  overflow, large low-opacity content block, or remaining blur). If found, the status
  strip shows **"Still blocked? Reveal ▸"**. Otherwise it never appears.
- Pressing it runs the aggressive set on the current page.

### 6.6 Status strip

A single line under the buttons echoing the last action (`✓ Blocked div.modal`,
`✓ Removed paywall`, `Nothing matched here`, `Revealed article`) and, when relevant,
the contextual Reveal affordance. Directly addresses "I can't tell if it worked."

### 6.7 Settings panel

Opened from the badge; its own panel:

- **What's blocked on this site** — every rule as a row with an **on/off toggle**
  (disable to see live what it hides), plus **edit** (rename/retarget keyword),
  **delete**, and **promote to global**.
- **Tracker cleanup** — per-site toggle (off by default; can log you out).
- **Version & updates** — shows `Popup Zapper vX.Y.Z` and a **Check for updates**
  button that fetches the remote script's `@version` and reports
  `Up to date ✓` or `vA.B.C available — your userscript manager will install it`.
- **Activity log** and **Copy diagnostics** (debug).

## 7. Data Model

Rules are **already objects** — `{ type, value, action }` (see `extract.js`/`rules.js`),
and `getActiveRules` already filters out `enabled === false`. So there is **no schema
migration**; we only need to:

- Have Settings write `rule.enabled = true/false` on toggle (default treated as `true`
  when the field is absent, which `getActiveRules` already does).
- Support **edit** by rewriting a rule's `value` (and re-running the blocker).
- Keep `loadLibrary`'s existing version guard; `SCHEMA_VERSION` stays `1`.

The only additive per-rule field is the optional boolean `enabled`. Nothing the user
has already taught is lost.

## 8. Distribution & Auto-Update

- **Make `EJR-of-Scrutopia/popup-zapper` public** so the raw `.user.js` URL resolves.
- **Header fixes** (`src/userscript-header.js`):
  - `@namespace https://github.com/EJR-of-Scrutopia/popup-zapper`
  - add `@updateURL`  and `@downloadURL` →
    `https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/main/dist/popup-zapper.user.js`
  - `@homepageURL`/`@supportURL` → the repo.
- **Single source of version truth:** today `package.json` says `1.0.0` while the
  header says `1.9.0`. Fix: version lives in `package.json`; `build.js` injects it into
  the header at build time. Header keeps a `__VERSION__` placeholder.
- **One-command release:** `npm run release [patch|minor|major]` →
  bump `package.json` version → `npm run build` → `git commit` → `git tag vX.Y.Z` →
  `git push --follow-tags`. Nothing pushes until this is run.
- Friend installs once from the raw URL; Violentmonkey auto-updates on version bumps.

## 9. Module Plan

Keep the existing small-module structure. New/changed modules:

- `src/lib/picker.js` — Block picker: ranked-candidate cycling + DOM tree traversal +
  outline rendering. (New; extracts learner UI concerns from `main.js`.)
- `src/lib/reveal.js` — safe vs. aggressive restore passes + residual-gating detector.
  (New; absorbs and splits current `restore.js`/`unlockContent` logic by risk.)
- `src/lib/paywall-veil.js` — full-viewport blur/veil overlay detection & removal.
  (New; complements `frames.js`.)
- `src/lib/undo.js` — Block undo stack for Revert. (New.)
- `src/lib/updates.js` — fetch remote `@version`, compare. (New.)
- `src/lib/rules.js`, `src/lib/storage.js` — rule-object schema + migration.
- `src/lib/ui.js` — new badge menu (top toggle, 3 buttons, status strip), Settings
  panel with rule toggles/edit, version display.
- `src/main.js` — observer attribute-watching; wire the consolidated actions; run
  safe pass by default and gate the aggressive pass behind Reveal.
- `build.js` + `package.json` — version injection + `release` script.

## 10. Testing

TDD, extending the existing Vitest/jsdom suite. New/updated tests:

- **Observer**: an attribute-only mutation (class/style toggle applying blur) triggers
  a de-blur pass. (Assert the reprocess path runs on attribute mutation.)
- **paywall-veil**: a fixed full-viewport high-z element with backdrop blur / vendor
  class is removed; a small blurred decorative element is not.
- **reveal**: safe pass leaves `max-height`/opacity locks untouched; aggressive pass
  clears them; residual detector flags a clamped long-text container.
- **picker**: candidate cycling wraps `1..N`; parent/child traversal changes target;
  cancel makes no change; Block emits the expected rule + scope.
- **undo**: Revert re-inserts at the correct sibling position and removes the added
  rule.
- **rules/storage migration**: string rules load as `{keyword, enabled:true}`;
  disabled rules are excluded from matching.
- **updates**: newer/equal/older remote versions map to the right message.
- Keep the full existing suite green.

## 11. Risk Split (why the default/manual line is drawn here)

| Action | Auto? | Why |
|---|---|---|
| De-blur, veil removal, gate-overlay removal | **Auto** | Worst case cosmetic (lost frosted-glass); rarely legit |
| Cookie-reject, anti-reload, meta strip, scroll unfreeze | **Auto** | Safe |
| Clear `max-height` truncation | **Manual (Reveal)** | Legit carousels/accordions/scroll boxes would break |
| Restore `opacity:0`/`pointer-events:none` | **Manual (Reveal)** | Legit tooltips/menus/tabs hidden by design would pop in |

## 12. Open Questions

None outstanding — all design decisions resolved with the author.