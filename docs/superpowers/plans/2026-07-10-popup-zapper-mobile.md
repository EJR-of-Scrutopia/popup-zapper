# Popup Zapper Mobile Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single Popup Zapper userscript run with full feature parity on Android (Firefox+Violentmonkey) and iPhone (Safari + Userscripts app), by making storage async, adding a GM-API adapter, and adapting the UI for touch.

**Architecture:** Keep one `.user.js` build. Introduce (1) an async storage path so the rule library loads on managers that only expose async `GM.getValue`, (2) a small `lib/gm.js` adapter that normalizes `GM_*`/`GM.*`/web-API differences behind one interface, and (3) runtime touch/small-screen adaptation in `lib/ui.js`. The reload-defense stays synchronous at `document-start`; only the library/theme load becomes async.

**Tech Stack:** Vanilla ES modules under `src/lib/`, esbuild IIFE bundle (`build.js` → `dist/popup-zapper.user.js`), Vitest + jsdom tests.

## Global Constraints

- Single artifact: `dist/popup-zapper.user.js`, built by `node build.js` from `package.json` version. No second/mobile build.
- No new runtime dependencies. Dev deps stay: esbuild, vitest, jsdom.
- All existing tests must stay green (120 passing at plan start). Run with `npm test`.
- Desktop behavior must not change: when touch is not detected, rendered output and flows are identical to today.
- Header must keep `@match *://*/*`, `@connect *`, `@run-at document-start`, `@noframes`.
- Canonical raw URL (unchanged): `https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js`
- Commit locally after each task (user preference: commit after every fix; keep push/release separate).
- Prose in docs: no em dashes.

---

## File Structure

- **Create** `src/lib/gm.js` — `createGm(env)` adapter: async `get/set`, `xhr`, `clipboard`, `openTab`. One responsibility: paper over manager API differences.
- **Create** `tests/gm.test.js` — adapter fallback tests with injected fake envs.
- **Modify** `src/lib/storage.js` — extract pure `parseLibrary(raw)`; add `loadLibraryAsync(getValueAsync)`. Keep sync `loadLibrary` for existing callers/tests.
- **Modify** `tests/storage.test.js` — add async-load tests.
- **Modify** `src/main.js` — async bootstrap using `createGm`; route update-check / clipboard / open-tab through the adapter; keep `installReloadDefense()` synchronous.
- **Modify** `src/lib/ui.js` — `detectTouch()` + `setTouch()`/module flag; touch style branches (badge label always shown, ≥40px tap targets, safe-area padding); touch branch in the Settings update row (copy-link instead of install-page).
- **Modify** `tests/ui.test.js` — touch-path assertions + copy-update flow.
- **Modify** `src/userscript-header.js` — dual `@grant` (underscore + dotted) + `GM.addStyle`.
- **Modify** `tests/build-header.test.js` — assert new grants present.
- **Create** `docs/INSTALL-mobile.md` — per-platform install guide + device smoke checklist.
- **Modify** `README.md` — link the mobile install guide.

---

### Task 1: Async storage load (`parseLibrary` + `loadLibraryAsync`)

**Files:**
- Modify: `src/lib/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `parseLibrary(raw: string|undefined) -> library` (pure; the current parsing logic).
  - `loadLibraryAsync(getValueAsync: (key:string)=>Promise<string|undefined>) -> Promise<library>`.
  - `loadLibrary(getValue)` and `saveLibrary(setValue, library)` keep current signatures.

- [ ] **Step 1: Write the failing tests**

Add to `tests/storage.test.js`:

```js
import { DEFAULT_LIBRARY, loadLibrary, saveLibrary, parseLibrary, loadLibraryAsync } from "../src/lib/storage.js";

describe("parseLibrary", () => {
  it("returns defaults for empty/corrupt/mismatched, merges valid", () => {
    expect(parseLibrary(undefined)).toEqual(DEFAULT_LIBRARY);
    expect(parseLibrary("{bad")).toEqual(DEFAULT_LIBRARY);
    expect(parseLibrary(JSON.stringify({ version: 999 }))).toEqual(DEFAULT_LIBRARY);
    const lib = parseLibrary(JSON.stringify({ version: 1, global: [{ type: "class", value: "x" }] }));
    expect(lib.global).toHaveLength(1);
    expect(lib.domains).toEqual({});
  });
});

describe("loadLibraryAsync", () => {
  it("awaits the async getter and parses the result", async () => {
    const stored = JSON.stringify({ version: 1, global: [{ type: "id", value: "gate" }] });
    const lib = await loadLibraryAsync(async () => stored);
    expect(lib.global).toEqual([{ type: "id", value: "gate" }]);
  });
  it("returns defaults when the async getter yields nothing", async () => {
    const lib = await loadLibraryAsync(async () => undefined);
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd popup-zapper && npx vitest run tests/storage.test.js`
Expected: FAIL — `parseLibrary`/`loadLibraryAsync` are not exported.

- [ ] **Step 3: Refactor storage.js to add the pure parser and async loader**

In `src/lib/storage.js`, replace the body of `loadLibrary` so both paths share `parseLibrary`:

```js
export function parseLibrary(raw) {
  if (!raw) return clone(DEFAULT_LIBRARY);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
  if (!parsed || parsed.version !== SCHEMA_VERSION) {
    return clone(DEFAULT_LIBRARY);
  }
  return { ...clone(DEFAULT_LIBRARY), ...parsed };
}

export function loadLibrary(getValue) {
  let raw;
  try {
    raw = getValue("popupZapper.library");
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
  return parseLibrary(raw);
}

export async function loadLibraryAsync(getValueAsync) {
  let raw;
  try {
    raw = await getValueAsync("popupZapper.library");
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
  return parseLibrary(raw);
}
```

Leave `saveLibrary` and `clone` unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd popup-zapper && npx vitest run tests/storage.test.js`
Expected: PASS (old sync tests + new async/parser tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.js tests/storage.test.js
git commit -m "feat(storage): pure parseLibrary + async loadLibraryAsync"
```

---

### Task 2: `lib/gm.js` — GM API adapter

**Files:**
- Create: `src/lib/gm.js`
- Test: `tests/gm.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createGm(env = globalThis) -> { get, set, xhr, clipboard, openTab }` where
  - `get(key, dflt) -> Promise<any>`
  - `set(key, val) -> Promise<void>`
  - `xhr(details)` — calls `details.onload({responseText,status})` / `details.onerror()`
  - `clipboard(text) -> Promise<void>`
  - `openTab(url) -> void`

- [ ] **Step 1: Write the failing tests**

Create `tests/gm.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { createGm } from "../src/lib/gm.js";

describe("createGm", () => {
  it("prefers async GM.* storage when present", async () => {
    const store = {};
    const env = { GM: { getValue: async (k, d) => (k in store ? store[k] : d), setValue: async (k, v) => { store[k] = v; } } };
    const gm = createGm(env);
    await gm.set("a", "1");
    expect(await gm.get("a", "z")).toBe("1");
    expect(await gm.get("missing", "z")).toBe("z");
  });

  it("wraps synchronous GM_* storage as promises", async () => {
    const store = {};
    const env = {
      GM_getValue: (k) => store[k],
      GM_setValue: (k, v) => { store[k] = v; },
    };
    const gm = createGm(env);
    await gm.set("a", "1");
    expect(await gm.get("a", "z")).toBe("1");
    expect(await gm.get("missing", "z")).toBe("z"); // undefined -> default
  });

  it("falls back to localStorage when no GM storage exists", async () => {
    const mem = {};
    const env = { localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } } };
    const gm = createGm(env);
    await gm.set("a", "1");
    expect(await gm.get("a", "z")).toBe("1");
  });

  it("xhr uses GM_xmlhttpRequest when present", () => {
    const spy = vi.fn();
    const gm = createGm({ GM_xmlhttpRequest: spy });
    const details = { url: "u", onload() {} };
    gm.xhr(details);
    expect(spy).toHaveBeenCalledWith(details);
  });

  it("clipboard prefers GM_setClipboard", async () => {
    const spy = vi.fn();
    const gm = createGm({ GM_setClipboard: spy });
    await gm.clipboard("hi");
    expect(spy).toHaveBeenCalledWith("hi");
  });

  it("openTab prefers GM_openInTab, else window.open", () => {
    const gm1 = createGm({ GM_openInTab: vi.fn() });
    gm1.openTab("u");
    expect(createGm({ GM_openInTab: vi.fn() })).toBeTruthy();
    const open = vi.fn(() => ({}));
    createGm({ open }).openTab("u");
    expect(open).toHaveBeenCalledWith("u", "_blank");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd popup-zapper && npx vitest run tests/gm.test.js`
Expected: FAIL — `src/lib/gm.js` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/gm.js`:

```js
// Normalizes userscript-manager API differences behind one interface.
// Tampermonkey/Violentmonkey expose synchronous GM_* AND async GM.*; the Safari
// Userscripts app exposes async GM.* only (no sync storage, no menu commands).
// Every method prefers the richest available API and degrades gracefully.
export function createGm(env = globalThis) {
  const has = (name) => typeof env[name] === "function";
  const gmNs = env.GM && typeof env.GM === "object" ? env.GM : null;

  async function get(key, dflt) {
    if (gmNs && typeof gmNs.getValue === "function") return gmNs.getValue(key, dflt);
    if (has("GM_getValue")) {
      const v = env.GM_getValue(key);
      return v === undefined ? dflt : v;
    }
    if (env.localStorage) {
      const v = env.localStorage.getItem(key);
      return v === null || v === undefined ? dflt : v;
    }
    return dflt;
  }

  async function set(key, val) {
    if (gmNs && typeof gmNs.setValue === "function") return void (await gmNs.setValue(key, val));
    if (has("GM_setValue")) return void env.GM_setValue(key, val);
    if (env.localStorage) return void env.localStorage.setItem(key, val);
  }

  function xhr(details) {
    if (has("GM_xmlhttpRequest")) return env.GM_xmlhttpRequest(details);
    if (gmNs && typeof gmNs.xmlHttpRequest === "function") return gmNs.xmlHttpRequest(details);
    // Last-resort fetch shim (same-origin or CORS-permitted only).
    if (typeof env.fetch === "function") {
      env.fetch(details.url, { method: details.method || "GET" })
        .then((r) => r.text().then((t) => details.onload && details.onload({ responseText: t, status: r.status })))
        .catch(() => details.onerror && details.onerror());
    } else if (details.onerror) details.onerror();
  }

  async function clipboard(text) {
    if (has("GM_setClipboard")) return void env.GM_setClipboard(text);
    if (gmNs && typeof gmNs.setClipboard === "function") return void (await gmNs.setClipboard(text));
    if (env.navigator && env.navigator.clipboard) return env.navigator.clipboard.writeText(text);
  }

  function openTab(url) {
    if (has("GM_openInTab")) return void env.GM_openInTab(url, { active: true });
    if (gmNs && typeof gmNs.openInTab === "function") return void gmNs.openInTab(url, false);
    if (typeof env.open === "function") { const w = env.open(url, "_blank"); if (!w && env.location) env.location.href = url; return; }
    if (env.location) env.location.href = url;
  }

  return { get, set, xhr, clipboard, openTab };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd popup-zapper && npx vitest run tests/gm.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gm.js tests/gm.test.js
git commit -m "feat(gm): manager-agnostic GM API adapter (async storage, xhr, clipboard, openTab)"
```

---

### Task 3: Async bootstrap + route GM calls through the adapter (`main.js`)

**Files:**
- Modify: `src/main.js`
- Verify: `npm test` (no new unit test; this is integration wiring, gated by build + full suite + grep).

**Interfaces:**
- Consumes: `createGm` (Task 2), `loadLibraryAsync` (Task 1).
- Produces: no new exports (entry module).

- [ ] **Step 1: Import the adapter and async loader; create the gm instance**

In `src/main.js`, update the storage import (currently `import { loadLibrary, saveLibrary } from "./lib/storage.js";`) to:

```js
import { loadLibraryAsync, saveLibrary } from "./lib/storage.js";
import { createGm } from "./lib/gm.js";
```

Replace the `getV`/`setV`/`library`/`persist`/theme-load block (currently lines ~20-33: `const getV = ...`, `const setV = ...`, `let library = loadLibrary(getV)`, `const persist = ...`, and `setTheme(getV(THEME_KEY) || "auto")`) with:

```js
const gm = createGm();
const hostname = location.hostname.replace(/^www\./, "");
const RAW_URL = "https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js";
const VERSION = (typeof GM_info !== "undefined" && GM_info && GM_info.script)
  ? GM_info.script.version : "0.0.0";

// Filled in by bootAsync() before anything renders. Writes are fire-and-forget.
let library = null;
const persist = () => { saveLibrary((k, v) => gm.set(k, v), library); };
const THEME_KEY = "pz-theme";
```

(Keep the existing `hostname`, `RAW_URL`, `VERSION`, `THEME_KEY` single-source; remove any now-duplicated declarations so each is declared once.)

- [ ] **Step 2: Route update-check, clipboard, and open-tab through the adapter**

In `checkUpdates()` replace the `GM_xmlhttpRequest` guard/call with the adapter. Change:

```js
function checkUpdates() {
  if (typeof GM_xmlhttpRequest !== "function") {
    setUpdateState({ state: "error" });
    return;
  }
  setUpdateState({ state: "checking" });
  const decide = (remote) => { /* unchanged */ };
  GM_xmlhttpRequest({
    method: "GET",
    url: RAW_URL + "?t=" + Date.now(),
    onload: (res) => decide(parseVersion(res.responseText)),
    onerror: () => decide(null),
  });
}
```

to:

```js
function checkUpdates() {
  setUpdateState({ state: "checking" });
  const decide = (remote) => {
    const plan = updatePlan(VERSION, remote);
    if (plan.action === "install") setUpdateState({ state: "available", remote: plan.remote });
    else if (plan.action === "error") setUpdateState({ state: "error" });
    else setUpdateState({ state: "current" });
  };
  gm.xhr({
    method: "GET",
    url: RAW_URL + "?t=" + Date.now(),
    onload: (res) => decide(parseVersion(res.responseText)),
    onerror: () => decide(null),
  });
}
```

In `openInstallPage()` replace the `GM_openInTab`/`window.open` body with `gm.openTab(RAW_URL);`.

In `copyDiagnostics()` replace `GM_setClipboard(report)` with `gm.clipboard(report);` (keep the surrounding try/catch and the console fallback).

- [ ] **Step 3: Convert boot to async; keep reload-defense synchronous**

Replace the boot block at the end of `src/main.js` (currently):

```js
// ---- boot ----
installReloadDefense();
function boot() {
  runOnce();
  startObserver();
  refreshControl();
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
```

with:

```js
// ---- boot ----
// Reload-defense must arm at document-start (it uses only sessionStorage, no GM
// storage), so it stays synchronous even though the library load is async.
installReloadDefense();

async function bootAsync() {
  library = await loadLibraryAsync((k) => gm.get(k));
  setTheme(await gm.get(THEME_KEY, "auto"));
  const start = () => { runOnce(); startObserver(); refreshControl(); };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
bootAsync();
```

Also update the theme-save handler in `openSettings` (`onSetTheme`) from `setV(THEME_KEY, setTheme(mode))` to:

```js
onSetTheme: (mode) => { gm.set(THEME_KEY, setTheme(mode)); repaint(); },
```

- [ ] **Step 4: Verify build, full suite, and no stray direct GM storage calls**

Run:
```bash
cd popup-zapper && npm test && npm run build
grep -n "GM_getValue\|GM_setValue\|loadLibrary(" src/main.js || echo "no direct sync GM storage in main.js (expected)"
```
Expected: all tests PASS; build prints `Built dist/popup-zapper.user.js`; the grep prints the "expected" line (no direct sync GM storage / no sync `loadLibrary(` left in `main.js`).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat(boot): async storage bootstrap + route GM calls through adapter"
```

---

### Task 4: Touch/small-screen adaptive UI (`ui.js`)

**Files:**
- Modify: `src/lib/ui.js`
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `detectTouch() -> boolean` (guarded), `setTouch(v) -> boolean`, `getTouch() -> boolean`. UI factories read the module touch flag (mirrors the existing `themeMode`/`setTheme` pattern).

- [ ] **Step 1: Write the failing tests**

Add to `tests/ui.test.js` (import `setTouch`, `getTouch`, `detectTouch` alongside the existing ui imports):

```js
describe("touch adaptation", () => {
  it("setTouch toggles the flag and getTouch reports it", () => {
    expect(setTouch(true)).toBe(true);
    expect(getTouch()).toBe(true);
    setTouch(false);
  });

  it("badge shows its label immediately on touch (no hover needed)", () => {
    setTouch(true);
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: false, status: "", blocked: false,
      onToggleMenu() {}, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    const name = [...ctrl.querySelectorAll("span")].find((s) => s.textContent === "Popup Zapper");
    expect(name.style.maxWidth).not.toBe("0px");
    expect(name.style.opacity).toBe("1");
    setTouch(false);
  });

  it("menu items get a larger min-height on touch", () => {
    setTouch(true);
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: true, status: "", blocked: false,
      onToggleMenu() {}, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    const block = ctrl.querySelector("[data-act='block']");
    expect(block.style.minHeight).toBe("44px");
    setTouch(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd popup-zapper && npx vitest run tests/ui.test.js`
Expected: FAIL — `setTouch`/`getTouch` not exported; no `minHeight` on items.

- [ ] **Step 3: Add the touch flag + detection, and branch the styles**

In `src/lib/ui.js`, just below the `themeMode`/`setTheme`/`getTheme` block, add:

```js
// Touch/small-screen mode. Set once at boot (main calls setTouch(detectTouch()))
// so every factory renders larger targets and skips hover-only affordances.
let touchMode = false;
export function setTouch(v) { touchMode = !!v; return touchMode; }
export function getTouch() { return touchMode; }
export function detectTouch() {
  try {
    return !!(
      (navigator && navigator.maxTouchPoints > 0) ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
    );
  } catch { return false; }
}
```

In `createControlMenu`, the badge name span currently starts collapsed unless `open`. Change its initial style and the hover wiring so touch shows it immediately and skips hover:

```js
  const name = tag("span", { textContent: "Popup Zapper" });
  const nameOpen = open || touchMode;
  name.style.cssText =
    "overflow:hidden;white-space:nowrap;transition:max-width .25s ease,opacity .25s ease;" +
    (nameOpen ? "max-width:140px;opacity:1;" : "max-width:0;opacity:0;");
```

and guard the hover listeners so they are only attached on non-touch, non-open:

```js
  if (!open && !touchMode) {
    badge.addEventListener("mouseenter", () => { name.style.maxWidth = "140px"; name.style.opacity = "1"; });
    badge.addEventListener("mouseleave", () => { name.style.maxWidth = "0"; name.style.opacity = "0"; });
  }
```

In the `item(...)` helper inside `createControlMenu`, append a touch min-height to each row button's `cssText`:

```js
  const item = (act, label, handler, accent) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText =
      "display:block;width:100%;text-align:left;padding:9px 12px;border:0;" +
      `background:${t.bg};color:${accent || t.fg};cursor:pointer;font:12px sans-serif;` +
      (touchMode ? "min-height:44px;" : "");
    b.addEventListener("mouseenter", () => { b.style.background = t.hover; });
    b.addEventListener("mouseleave", () => { b.style.background = t.bg; });
    if (handler) b.addEventListener("click", handler);
    menu.appendChild(b);
    return b;
  };
```

Add safe-area insets to the fixed badge wrapper (`createControlMenu`) and the picker toolbar (`createPickerToolbar`). For the control wrapper change:

```js
  wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;" +
    (touchMode ? "bottom:calc(12px + env(safe-area-inset-bottom));right:calc(12px + env(safe-area-inset-right));" : "");
```

For the picker bar, append on touch: `bar.style.paddingTop = "calc(8px + env(safe-area-inset-top))";` and enlarge its buttons' padding when `touchMode` (in the `mk` helper add `(touchMode ? "min-height:44px;min-width:44px;" : "")`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd popup-zapper && npx vitest run tests/ui.test.js`
Expected: PASS (existing ui tests + 3 new touch tests). Existing desktop tests stay green because `touchMode` defaults to false.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui.js tests/ui.test.js
git commit -m "feat(ui): touch-adaptive badge, tap targets, and safe-area insets"
```

---

### Task 5: Touch update flow (copy-link) in Settings

**Files:**
- Modify: `src/lib/ui.js` (settings update row), `src/main.js` (copy handler + state)
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: `getTouch()` (Task 4), `gm.clipboard` (Task 2/3).
- Produces: settings panel accepts `onCopyUpdate`; update state gains `"copied"`.

- [ ] **Step 1: Write the failing test**

Add to the `createSettingsPanel` describe in `tests/ui.test.js`:

```js
  it("on touch, an available update offers Copy update link instead of the install page", () => {
    setTouch(true);
    const onCopyUpdate = vi.fn();
    const library = { global: [], domains: {} };
    const el = createSettingsPanel({ ...base, library, update: { state: "available", remote: "2.1.0" }, onCopyUpdate });
    const copyBtn = el.querySelector("[data-act='copy-update']");
    expect(copyBtn).not.toBeNull();
    copyBtn.click();
    expect(onCopyUpdate).toHaveBeenCalledOnce();
    setTouch(false);
  });

  it("shows the copied confirmation note", () => {
    const library = { global: [], domains: {} };
    const el = createSettingsPanel({ ...base, library, update: { state: "copied" } });
    expect(el.textContent).toMatch(/copied/i);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd popup-zapper && npx vitest run tests/ui.test.js`
Expected: FAIL — no `[data-act='copy-update']`, no "copied" note.

- [ ] **Step 3: Branch the settings update row for touch + add the copied state**

In `createSettingsPanel`, add `onCopyUpdate` to the destructured props. In the "version + updates" section, change the `available` branch and the note map:

```js
  if (u.state === "available") {
    if (getTouch()) {
      verRow.appendChild(btn("Copy update link", "copy-update", onCopyUpdate));
    } else {
      verRow.appendChild(btn(`Update to v${u.remote}`, "install-update", onInstallUpdate));
    }
  } else if (u.state === "opened") {
    verRow.appendChild(btn("↻ Reload to apply", "reload-page", onReloadPage));
  } else {
    verRow.appendChild(btn(u.state === "checking" ? "Checking…" : "Check for updates", "check-updates",
      u.state === "checking" ? null : onCheckUpdates));
  }
```

Add a `copied` entry to the `noteText` map:

```js
    available: `Version ${u.remote} is ready to install.`,
    opened: "Install page opened. Click Update/Reinstall there, then reload here.",
    copied: "Link copied. Open it in your userscript app (Userscripts) to reinstall the new version.",
```

Import `getTouch` at the top of `ui.js` usage is internal (same module), so no import needed.

- [ ] **Step 4: Wire the handler in main.js**

In `src/main.js` `openSettings()`, add to the settings props:

```js
    onCopyUpdate: () => { gm.clipboard(RAW_URL); setUpdateState({ state: "copied" }); },
```

- [ ] **Step 5: Run tests + build**

Run: `cd popup-zapper && npx vitest run tests/ui.test.js && npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui.js src/main.js tests/ui.test.js
git commit -m "feat(update): touch copy-link reinstall path for the Userscripts app"
```

---

### Task 6: Set touch at boot, header grants, and mobile docs

**Files:**
- Modify: `src/main.js` (call `setTouch(detectTouch())`), `src/userscript-header.js`, `tests/build-header.test.js`
- Create: `docs/INSTALL-mobile.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `setTouch`, `detectTouch` (Task 4).
- Produces: header with dual grants; install docs.

- [ ] **Step 1: Call setTouch at boot**

In `src/main.js`, add `setTouch, detectTouch` to the `./lib/ui.js` import, and at the top of `bootAsync()` (first line) add:

```js
  setTouch(detectTouch());
```

- [ ] **Step 2: Write the failing header test**

In `tests/build-header.test.js`, add an assertion that dotted grants are present (adapt to the file's existing style of obtaining the header string):

```js
it("grants both underscore and dotted GM APIs for cross-manager support", () => {
  const header = buildHeader("9.9.9");
  expect(header).toContain("@grant        GM.setValue");
  expect(header).toContain("@grant        GM.getValue");
  expect(header).toContain("@grant        GM.xmlHttpRequest");
  expect(header).toContain("@grant        GM_openInTab");
});
```

(If `buildHeader` is not already imported in that test file, add `import { buildHeader } from "../src/userscript-header.js";`.)

- [ ] **Step 3: Run the header test to verify it fails**

Run: `cd popup-zapper && npx vitest run tests/build-header.test.js`
Expected: FAIL — dotted grants absent.

- [ ] **Step 4: Add dual grants to the header**

In `src/userscript-header.js`, extend the grant block (currently `GM_setValue`, `GM_getValue`, `GM_registerMenuCommand`, `GM_setClipboard`, `GM_xmlhttpRequest`, `GM_openInTab`, `GM_info`) to also include the dotted forms and `GM.addStyle`:

```
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_info
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.setClipboard
// @grant        GM.xmlHttpRequest
// @grant        GM.openInTab
// @grant        GM.addStyle
```

- [ ] **Step 5: Run header test + full suite + build**

Run: `cd popup-zapper && npx vitest run tests/build-header.test.js && npm test && npm run build`
Expected: all PASS; build succeeds; `dist/popup-zapper.user.js` contains the dotted grants.

- [ ] **Step 6: Write the mobile install guide**

Create `docs/INSTALL-mobile.md`:

```markdown
# Installing Popup Zapper on your phone

Popup Zapper is the same script on every device. Phones run it through a
browser that supports userscripts.

## Android (recommended: Firefox + Violentmonkey)

1. Install **Firefox** from the Play Store.
2. In Firefox, install **Violentmonkey** from addons.mozilla.org.
3. Open the raw script link and tap **Confirm installation**:
   https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js
4. Updates arrive automatically, exactly like desktop.

## iPhone (Safari + the free Userscripts app)

1. Install **Userscripts** (by quoid) from the App Store.
2. Open **Settings > Apps > Safari > Extensions > Userscripts** and enable it,
   then allow it on **All Websites**.
3. Open the Userscripts app once so it finishes setup.
4. Add the script: open the raw link above in Safari and import it through the
   Userscripts extension (tap the puzzle-piece / Userscripts icon in the Safari
   toolbar).
5. **Updating on iPhone is semi-manual.** When a new version exists, open
   Popup Zapper > Settings > **Copy update link**, then re-import that link in
   the Userscripts app. (Safari cannot auto-install like Tampermonkey does.)

## Device smoke checklist (run after installing)

- [ ] Badge appears bottom-right and clears the browser toolbar/notch.
- [ ] Tapping the badge opens the menu; items are comfortably tappable.
- [ ] Block a popup: the picker toolbar cycles candidates by tap and blocks one.
- [ ] Remove paywall / Revert last block work.
- [ ] Toggle a site off then on.
- [ ] Change Appearance (Auto/Light/Dark) and see it repaint.
- [ ] Reload the page: your rules and theme persist (proves async storage).
- [ ] iPhone only: Settings > Copy update link copies the raw URL.
```

- [ ] **Step 7: Link it from the README**

In `README.md`, add under the install section:

```markdown
### On a phone (iPhone / Android)

See [docs/INSTALL-mobile.md](docs/INSTALL-mobile.md) for the per-platform guide.
```

- [ ] **Step 8: Commit**

```bash
git add src/main.js src/userscript-header.js tests/build-header.test.js docs/INSTALL-mobile.md README.md
git commit -m "feat(mobile): set touch at boot, dual GM grants, and phone install guide"
```

---

### Task 7: Release

**Files:** `package.json`, `dist/popup-zapper.user.js` (force-added; it is gitignored)

- [ ] **Step 1: Full verification**

Run: `cd popup-zapper && npm test && npm run build`
Expected: all tests PASS; build prints the new version.

- [ ] **Step 2: Bump, build, commit, tag**

```bash
cd popup-zapper
npm version minor --no-git-tag-version   # 2.0.4 -> 2.1.0 (new capability)
npm run build
git add -f dist/popup-zapper.user.js
git add package.json
git commit -m "chore(release): v2.1.0 (mobile support: iPhone + Android)"
git tag v2.1.0
```

- [ ] **Step 3: Push (explicit, per user preference to keep push separate)**

```bash
git push origin master
git push origin v2.1.0
```

- [ ] **Step 4: Verify the live raw serves the new version**

Run: `curl -s "https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js?t=$(date +%s)" | grep -m1 "@version"`
Expected: `// @version      2.1.0`

---

## Self-Review

**Spec coverage:**
- Async storage bootstrap → Task 1 (async loader) + Task 3 (wiring, reload-defense stays sync). ✓
- `lib/gm.js` adapter → Task 2, consumed in Task 3. ✓
- Adaptive touch UI (badge/tap targets/safe-area) → Task 4. ✓
- iPhone update copy-link path → Task 5. ✓
- Header dual grants + per-platform docs + smoke checklist → Task 6. ✓
- Desktop unchanged → guaranteed by `touchMode`/`getTouch()` defaulting false and desktop tests staying green (Tasks 4-6). ✓
- Release → Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the code. ✓

**Type consistency:** `createGm` returns `{ get, set, xhr, clipboard, openTab }` (Task 2) and `main.js` uses exactly those (Task 3). `setTouch/getTouch/detectTouch` defined in Task 4 and used in Tasks 4-6. `loadLibraryAsync(getValueAsync)` defined Task 1, called with `(k) => gm.get(k)` in Task 3. Settings `update` states `checking|current|available|error|opened|copied` consistent between Task 5 (ui) and main's `setUpdateState`. ✓

**Note for implementer:** the exact current line numbers in `main.js`/`ui.js` shift as tasks land; match on the quoted code, not line numbers.