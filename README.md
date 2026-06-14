# Popup Zapper

A Violentmonkey userscript for Brave that removes login/consent/newsletter/paywall
popups, restores blurred/locked content, defeats client-side reload traps, and learns
new popups by click.

> Run alongside **Brave Shields** (on by default) and **uBlock Origin** for
> network-level tracker blocking — this script complements them, it does not replace them.

## Install

1. Install **Violentmonkey** (or **Tampermonkey**) in Brave.
2. Build the script: `npm install && npm run build` (or use the prebuilt
   `dist/popup-zapper.user.js` from the repo).
3. Open the manager's **Dashboard** and drag `dist/popup-zapper.user.js` onto it,
   then confirm the install.

## Controls

All actions are in the **⚡ Zapper** badge menu (bottom-right of every page), and
also in the userscript manager's extension menu. No keyboard shortcuts are used,
to avoid clashing with Brave's built-in shortcuts.

- **Learn a popup** — outlines its best guess; click the real popup to correct, and
  the keyword is saved for this site.
- **Manage rules** — delete a rule, or promote a per-site rule to global.
- **Auto-zap (this site)** — auto-remove the highest-scoring overlay on load AND
  unlock gated content: strips "register to continue" overlays and the `max-height`
  truncation that hides otherwise-free articles, and keeps re-applying as the site
  retries. No learning needed. Off by default; heuristic, so check the activity log.
- **Activity log** — live view of what was removed, de-blurred, rejected, or blocked
  (and a hint when nothing matched).
- **Freeze auth (block paywall)** — scans the page for known metering/paywall vendors
  (Piano/tinypass, Poool, Pelcro, Zephr, etc.), generates uBlock Origin filter lines,
  copies them to the clipboard, and shows how to paste them into uBlock so the site's
  meter is blocked permanently. (For metered content that downgrades after load.)
- **Disable on this site** — per-site on/off switch.

Tracker cleanup (delete analytics cookies/storage after consent) can be toggled per
site from the userscript manager's extension menu.

## Develop

- `npm test` — run unit tests
- `npm run build` — rebuild `dist/popup-zapper.user.js`