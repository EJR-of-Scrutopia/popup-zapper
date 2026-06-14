# Popup Zapper

A Violentmonkey userscript for Brave that removes login/consent/newsletter/paywall
popups, restores blurred/locked content, defeats client-side reload traps, and learns
new popups by click.

> Run alongside **Brave Shields** (on by default) and **uBlock Origin** for
> network-level tracker blocking — this script complements them, it does not replace them.

## Install

1. Install the **Violentmonkey** extension in Brave.
2. Run `npm install && npm run build`.
3. Open `dist/popup-zapper.user.js` in Brave and confirm the Violentmonkey install
   prompt (or drag the file into the Violentmonkey dashboard).

## Hotkeys

- `Alt+Shift+P` — learn a popup (guess shown; click the right element to correct)
- `Alt+Shift+M` — manage rules (delete, promote site rule to global)
- `Alt+Shift+Z` — toggle the zapper on the current site
- `Alt+Shift+C` — toggle post-consent tracker cleanup on the current site (off by default)

## Develop

- `npm test` — run unit tests
- `npm run build` — rebuild `dist/popup-zapper.user.js`