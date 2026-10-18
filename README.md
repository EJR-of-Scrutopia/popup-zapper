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
   `https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js`
3. Violentmonkey checks that URL periodically, so new releases install themselves when
   the author bumps the version.

**From source:** `npm install && npm run build`, then drag `dist/popup-zapper.user.js`
onto the Violentmonkey **Dashboard**.

### On a phone (iPhone / Android)

See [docs/INSTALL-mobile.md](docs/INSTALL-mobile.md) for the per-platform guide.

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
- **Batch clicker** — opens a small panel for clicking many things on a page in turn
  (see below). It stays open when the menu closes, and does nothing until opened.
- **Settings** — see every rule saved for this site, toggle each on/off (to see what it
  hides), edit, delete, or promote to global; toggle tracker cleanup (delete analytics
  cookies/storage — can log you out); see the version and **check for updates**; open the
  activity log and diagnostics.

## Batch clicker

For download pages that cap a selection (tick ten, download, untick, next ten) and for
pages where every item has its own "Add to zip" or "Add to basket" button.

- **Tick & download** (rows with checkboxes): **Play** ticks a batch, presses the page's
  download button, waits until the file is actually handed over, unticks, and carries
  on, pressing *Load more* when the rows run out. A ledger in the site's own storage
  remembers every row, so nothing is fetched twice; **Stop** saves the list as JSON.
  **Batch**, **Start at row** and the **Types** switches choose what is taken;
  **Select all** ticks everything and leaves the download to you.
- **Click each** (items with their own button): **Play** presses each item's button
  once, turns the pages itself, and stops at the last page or at **Stop after**.
- **Pick item**: click one of the things you want clicked many times (a checkbox or a
  button) and every match on the page is used. Remembered for the site; the switch
  under it says whether to tick them in batches or click each. **✕** forgets it.
- **⬇ Download button**: click the page's own download button if it is not found by
  itself.
- **Reset** forgets the site's ledger (press twice). **Details** shows what the page did
  when something went wrong.

Allow automatic downloads for the site, and keep the tab in front while it runs.

## Step recorder

For libraries where each document takes a chain of clicks across pages and tabs (open
the item, open its viewer in a new tab, press download, close the viewer, go back). Open
it with **⏺ Steps** on the Batch clicker, or the **Step recorder** menu command.

- **Record**, then do one item by hand, starting with its button in the list. Every
  click and every Back is noted, on any site and in any tab it opens. Press **Stop
  recording** when you are back on the list. The recorder learns that the button you
  pressed is the same one on every other item. A tab you closed becomes *wait 5 s,
  close the tab*.
- **Play** repeats the steps for every item not yet done, then presses the list's
  next page and carries on until the last page (or **Pages**). Tabs the run opens close
  themselves. Done items fade, skipped ones get a red outline and failed ones amber.
  **Pause** and **Stop** work from any tab.
- Edit the steps: choose one, then **＋ Wait** adds a wait after it, or type some words
  and press **＋ Skip if** to skip any item whose page at that step says them. **✕**
  removes a step. **Skip items with** and **Only items with** filter the list by the
  items' own words, and **Highlight** marks words on every page.
- A step whose button does not show within **Step timeout** fails that item and the
  run goes on; three failures in a row (a lapsed login, say) stop the run. The next
  Play tries failed items again. **Reset** forgets which items are done (press twice).
  **Export** saves the steps and the ledger as JSON; send that file when a site does
  not behave.
- If the run's own tab is closed, the other tabs stop taking steps; after a browser
  restart the run comes back paused, never clicking on by itself.

Turn off *Ask where to save each file*, allow automatic downloads for the viewer's
site, and log in before you record. Keep the browser window visible while it runs:
a hidden window slows its timers to a crawl.

## Develop

- `npm test` — run unit tests
- `npm run build` — rebuild `dist/popup-zapper.user.js`
- `npm run release` — bump the version, rebuild, commit, tag, and push (this is what makes
  installed copies auto-update)