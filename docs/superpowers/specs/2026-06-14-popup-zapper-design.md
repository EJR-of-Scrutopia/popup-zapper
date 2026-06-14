# Popup Zapper — Design

**Date:** 2026-06-14
**Status:** Approved (design), pending implementation plan

## Problem

Too many sites force login/signup walls, cookie-consent bars, newsletter/promo
modals, and paywall/anti-adblock nags — largely to harvest tracking consent and
sell data. Worse, many walls also *degrade the underlying content* (e.g.
ArchDaily blurs the image behind a sign-in modal) so killing the modal alone is
not enough. Existing blocklists (uBlock Annoyances, Consent-O-Matic) handle the
common cases but cannot learn from the user in the moment for the long tail.

## Goal

A single Brave-compatible userscript that:

1. **Always blocks** known popups/walls and **restores degraded content**, using
   a keyword library.
2. **Learns** new popups on demand: the user arms it, the script guesses the
   offending element, the user confirms or corrects by click, and identifying
   keywords are saved to the library.

Recommended to run alongside uBlock Origin (Annoyances lists) — this tool covers
what the lists miss.

## Runtime

- Userscript managed by **Violentmonkey** (open-source, Brave-friendly).
- No Chrome Web Store, no extension packaging. Easy to edit and back up.
- `@match *://*/*`, `@run-at document-start`, with `GM_setValue`/`GM_getValue`,
  `GM_registerMenuCommand`.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Keyword Library  (GM storage, JSON)          │
│   • global rules (curated + promoted)         │
│   • per-domain rules + restore instructions   │
│   • whitelist (never touch)                    │
└───────────────┬───────────────────────────────┘
        ┌───────┴────────┐
        ▼                ▼
  BLOCKER engine    LEARNER engine
  (always on)       (hotkey-armed)
```

Two engines share one library. The blocker reads it continuously; the learner
writes to it.

## Component: Blocker engine (always on)

Runs on every page in this order, then re-runs via observer:

1. **Consent pass** — find cookie banners by library keywords + known CMP
   containers (e.g. `#onetrust-banner-sdk`, `.qc-cmp2-container`,
   `#CybotCookiebotDialog`). Try clicking a reject/decline button (text match:
   "reject", "decline", "necessary only", "refuse", locale variants). If no
   reject button is found, hide the banner and restore the page.
2. **Popup pass** — match elements against active rules (global + current
   domain). Remove or hide each match plus any associated full-screen/dark
   overlay.
3. **Restore pass** — undo content-degradation styles:
   - strip `filter: blur(...)` and `backdrop-filter`
   - reset near-zero `opacity` on content
   - re-enable `pointer-events` and `user-select`
   - drop `max-height` clamps and fade-out gradient overlays ("read more")
   - unfreeze scroll: reset `overflow`/`position` on `html`/`body`
4. **Watcher** — a `MutationObserver` re-runs passes 1–3 when popups are injected
   late or styles (e.g. blur) are re-applied on scroll. A throttle/iteration cap
   prevents infinite loops on stubborn sites.

A per-site **master toggle** can disable the engine entirely on a domain.

### Reload-trap defense (part of the blocker)

Some walls keep the page in a loop — repeatedly calling `location.reload()`, a
`setTimeout`/`setInterval` that reloads, or a `<meta http-equiv="refresh">` —
until the user signs up. Because the script runs at `document-start`, it can
neutralize these before the page's own scripts fire:

- override `location.reload` to no-op when triggered programmatically
- intercept `location.assign`/`location.replace` and `window.location` setters
- strip/disable `<meta http-equiv="refresh">` tags
- wrap `setTimeout`/`setInterval` to drop callbacks that perform a reload/redirect

**Policy: smart-auto + circuit breaker.** Only suppress reloads/redirects that
fire **without user interaction** shortly after load (heuristic: no recent
`click`/`keydown`/`submit`, within a few seconds of load). Genuine
user-triggered navigation (SSO, checkout) is allowed through. A **circuit
breaker** counts reloads in a short window (tracked via `sessionStorage`); after
N rapid reloads it freezes further reloads and shows a "reload loop blocked"
badge instead of fighting indefinitely.

**Limits (honest non-goals):** this only defeats *client-side* loops. A
server-side 302 redirect to a login gateway, or a server-side paywall, never
delivers the content to the browser, so it cannot be recovered client-side.

## Component: Learner engine (hotkey-armed)

Flow ("guess, then confirm by click"):

1. **Guess** — score candidate elements by: `position: fixed/sticky`, high
   `z-index`, large viewport coverage, sits above a dark/blur overlay, contains
   wall-ish text ("sign in", "subscribe", "cookies"). Outline the top guess.
2. **Confirm/correct** — small toolbar: **✓ Yes**, **Click the right one**,
   **Cancel**. If correcting, the next click selects the element and is swallowed
   so the site does not react.
3. **Extract keywords** — pull stable identifiers from the chosen element, ranked
   by reliability: `id` → meaningful `class` tokens (skip hashed/random like
   `css-1a2b3c`) → `[data-*]` attrs → distinctive text snippet (last resort).
   Show the user what was found; let them uncheck anything too generic.
4. **Restore capture** — inspect the page/element for degradation styles (blur,
   opacity, scroll-lock) and record a restore instruction for this domain if
   present.
5. **Save + apply** — write to the library (**per-domain by default**) and run
   the blocker immediately so the popup disappears at once.

## Component: Manage panel

Opened by hotkey. Lists rules for the current site + globals. Actions: toggle a
rule, **promote a per-site rule to global**, delete a mistake, whitelist an
element to protect it. Export/import the whole library as a JSON file for backup
and moving between machines.

## Data model

`GM` key `popupZapper.library`:

```json
{
  "version": 1,
  "enabled": true,
  "disabledDomains": ["example.com"],
  "global": [ { "type": "class", "value": "newsletter-modal", "action": "remove" } ],
  "domains": {
    "archdaily.com": {
      "rules": [ { "type": "class", "value": "afd-paywall", "action": "remove" } ],
      "restore": { "blur": true, "scrollLock": true, "pointerEvents": true }
    }
  },
  "whitelist": [ { "type": "id", "value": "checkout-dialog" } ]
}
```

Rule: `{ type: "id|class|attr|text|cmp", value, action: "remove|hide" }`.

## Keyword scope policy

- Learned rules are **per-domain by default** (avoids generic names like `modal`
  breaking unrelated sites' legit dialogs).
- User can **promote** a rule to `global` from the manage panel.
- Ships with a small **curated global list** of safe, well-known patterns
  (common CMP containers, obvious newsletter classes).

## Consent policy

Try a real **Reject all / Decline** click first (genuine opt-out). Only if no
reject control exists, hide the banner + restore the page. Never fabricate an
"accept".

## Controls

- `Alt+Shift+P` — arm learner
- `Alt+Shift+M` — manage panel
- `Alt+Shift+Z` — master on/off for current site
- Tiny unobtrusive badge shows state; also exposed via Violentmonkey menu
  commands.

## Safety / non-goals

- **Whitelist** protects elements the user wants (lightboxes, checkout modals).
- Observer throttle + iteration cap to avoid runaway loops.
- Hashed/random class tokens are skipped during extraction to avoid brittle rules.
- **Non-goal:** defeating true server-side hard paywalls (content never sent to
  the browser) or server-side 302 redirects to login gateways. We only remove
  client-side nags, restore client-degraded content, and break client-side
  reload loops.

## Error handling

- All passes wrapped so one failing selector cannot break the page.
- Library read/write guarded with schema-version check and safe defaults if the
  stored blob is missing or corrupt.
- Learner click-swallow is removed on cancel/timeout so the page is never left in
  a stuck capture state.

## Testing approach

- Pure helper functions (keyword extraction, rule matching, restore-style
  detection) unit-tested against saved HTML fixtures (incl. an ArchDaily-style
  blur+wall fixture).
- Manual test checklist across the four target categories on real sites.

## Future improvements (out of scope for v1)

- Auto-promotion suggestions when a per-site rule fires across many domains.
- Sync library via a hosted gist instead of file export/import.
- Per-rule statistics (how often each fires).