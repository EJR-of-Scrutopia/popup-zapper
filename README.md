# Popup Zapper

A Violentmonkey userscript for Brave that removes login/consent/newsletter/paywall
popups, reveals blurred/gated content, defeats client-side reload traps, and lets you
block new popups by pointing at them.

> Run alongside **Brave Shields** (on by default) and **uBlock Origin** for
> network-level tracker blocking — this script complements them, it does not replace them.

## Install

**From the repo (auto-updates):**

1. Install **Violentmonkey** (or **Tampermonkey**) in Brave.
2. Open this raw file and confirm the install:
   `https://raw.githubusercontent.com/edrowbo/popup-zapper/master/dist/popup-zapper.user.js`
3. Violentmonkey checks that URL periodically, so new releases install themselves when
   the author bumps the version.

**From source:** `npm install && npm run build`, then drag `dist/popup-zapper.user.js`
onto the Violentmonkey **Dashboard**.

## What runs automatically (no buttons)

On every enabled site these happen silently:

- **Reject cookie/consent banners** — clicks reject / hides the banner.
- **Anti-reload** — blocks automatic reloads and redirects and strips `<meta refresh>`;
  the page only reloads when *you* refresh it.
- **De-blur & de-veil** — strips `blur()` filters and removes full-screen metering veils
  (e.g. ArchDaily's Piano overlay) so gated articles and images become readable.

## The menu

The **⚡ Zapper** badge (bottom-right) opens a small menu; the same actions are in the
userscript manager's extension menu.

- **On/off toggle** (top) — enable or disable the zapper for this site.
- **Block a popup** — opens a picker. It highlights the most likely popups first; press
  ▶ / ◀ to cycle candidates and ▲ / ▼ (or `[` / `]`) to grow/shrink the selection up and
  down the page structure until the outline wraps exactly the thing. Tick **all sites**
  to make it global, then **Block**. A rule is saved so it's removed automatically next
  time.
- **Remove paywall** — for stubborn metered articles: wipes the meter, grabs the content,
  and opens a clean, script-free copy in a **new tab** (your original tab is kept). If the
  site gates server-side, it offers uBlock filter lines to block the vendor permanently.
- **Revert** — undo the last Block and bring the element back.
- **Status strip** — shows the last thing the zapper did, so you can tell it worked.
- **Reveal deeper** — appears only when a page still looks gated after the automatic pass.
  Runs the aggressive restores (un-truncate clamped articles, un-hide locked elements)
  that are too risky to run everywhere by default.
- **Settings** — see every rule saved for this site, toggle each on/off (to see what it
  hides), edit, delete, or promote to global; toggle tracker cleanup (delete analytics
  cookies/storage — can log you out); see the version and **check for updates**; open the
  activity log and diagnostics.

## Develop

- `npm test` — run unit tests
- `npm run build` — rebuild `dist/popup-zapper.user.js`
- `npm run release` — bump the version, rebuild, commit, tag, and push (this is what makes
  installed copies auto-update)