# Popup Zapper Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the UI to 3 defaults + 3 buttons + Settings, fix the ArchDaily (Piano) de-blur, and enable GitHub auto-update.

**Architecture:** Small ES modules under `src/lib/`, bundled by esbuild into a single Violentmonkey userscript. New pure-logic modules are unit-tested with Vitest/jsdom; UI/orchestration changes in `ui.js`/`main.js` are verified by build + manual check. The de-blur fix is (a) observe attribute mutations, and (b) remove full-viewport paywall veils rather than only stripping their blur.

**Tech Stack:** JavaScript (ES2020 modules), esbuild, Vitest + jsdom, Violentmonkey (GM_* APIs).

## Global Constraints

- Repo root: the `popup-zapper` project (its own git; **not** the comfyui repo). All paths below are relative to it.
- Never let one failure break the page: keep the existing `safe()` / `safeVal()` wrappers around any DOM work run at page scope.
- The zapper's own UI is marked `[data-pz]`; every DOM-scanning pass must skip `el.closest("[data-pz]")`.
- Distribution URL (verbatim): `https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js`
- Namespace (verbatim): `https://github.com/edrowbo/popup-zapper`
- Rules are objects `{ type, value, action, enabled? }`. Absent `enabled` means enabled. No schema migration; `SCHEMA_VERSION` stays `1`.
- Tests run with `npm test` (`vitest run`). Every task ends green.
- Commit after every task with a `feat:`/`fix:`/`chore:` message.

---

### Task 1: Single-source version + auto-update headers + release script

**Files:**
- Modify: `src/userscript-header.js` (whole file)
- Modify: `build.js` (inject version)
- Modify: `package.json` (version + `release` script)
- Test: `tests/build-header.test.js` (Create)

**Interfaces:**
- Produces: `HEADER` is now a function `buildHeader(version: string) => string` that injects `@version`, `@namespace`, `@updateURL`, `@downloadURL`.

- [ ] **Step 1: Write the failing test**

```js
// tests/build-header.test.js
import { describe, it, expect } from "vitest";
import { buildHeader } from "../src/userscript-header.js";

describe("buildHeader", () => {
  it("injects the version and update URLs", () => {
    const h = buildHeader("2.0.0");
    expect(h).toContain("// @version      2.0.0");
    expect(h).toContain("// @namespace    https://github.com/edrowbo/popup-zapper");
    expect(h).toContain("// @updateURL    https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js");
    expect(h).toContain("// @downloadURL  https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js");
  });
  it("has no unreplaced placeholder", () => {
    expect(buildHeader("2.0.0")).not.toContain("__VERSION__");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build-header.test.js`
Expected: FAIL — `buildHeader is not a function`.

- [ ] **Step 3: Rewrite the header module**

```js
// src/userscript-header.js
const RAW = "https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js";

export function buildHeader(version) {
  return `// ==UserScript==
// @name         Popup Zapper
// @namespace    https://github.com/edrowbo/popup-zapper
// @version      ${version}
// @description  Remove login/consent/newsletter/paywall popups, reveal blurred/gated content, defeat reload traps, and learn popups by click.
// @author       Param
// @homepageURL  https://github.com/edrowbo/popup-zapper
// @supportURL   https://github.com/edrowbo/popup-zapper/issues
// @updateURL    ${RAW}
// @downloadURL  ${RAW}
// @match        *://*/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// @noframes
// ==/UserScript==
`;
}
```

- [ ] **Step 4: Update build.js to inject the version**

```js
// build.js
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildHeader } from "./src/userscript-header.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/popup-zapper.bundle.js",
  legalComments: "none",
});

const body = readFileSync("dist/popup-zapper.bundle.js", "utf8");
writeFileSync("dist/popup-zapper.user.js", buildHeader(pkg.version) + "\n" + body);
console.log(`Built dist/popup-zapper.user.js (v${pkg.version})`);
```

- [ ] **Step 5: Set package.json version to 2.0.0 and add the release script**

In `package.json`: set `"version": "2.0.0"`, and in `scripts` add:

```json
"release": "npm version patch -m \"chore(release): v%s\" && npm run build && git add dist/popup-zapper.user.js && git commit -m \"chore: rebuild dist\" && git push --follow-tags"
```

(Author runs `npm run release` — or `npm version minor|major` first — to ship. `npm version` bumps + tags; the rebuild commit carries the new `dist`.)

- [ ] **Step 6: Run the build and the test**

Run: `npm run build && npx vitest run tests/build-header.test.js`
Expected: build prints `v2.0.0`; tests PASS. Confirm `dist/popup-zapper.user.js` header shows `@version 2.0.0` and the update URLs.

- [ ] **Step 7: Commit**

```bash
git add src/userscript-header.js build.js package.json tests/build-header.test.js dist/popup-zapper.user.js
git commit -m "chore: single-source version + auto-update headers + release script"
```

---

### Task 2: Paywall-veil detection & removal (ArchDaily fix, part 1)

**Files:**
- Create: `src/lib/paywall-veil.js`
- Test: `tests/paywall-veil.test.js`

**Interfaces:**
- Produces:
  - `isVeilOverlay(el, win) => boolean`
  - `removeVeils(doc, skip) => string[]` (labels of removed elements; `skip(el)` returns true to leave an element alone)

- [ ] **Step 1: Write the failing test**

```js
// tests/paywall-veil.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { isVeilOverlay, removeVeils } from "../src/lib/paywall-veil.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("isVeilOverlay", () => {
  it("flags a fixed high-z backdrop-blur overlay", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;z-index:99999;backdrop-filter:blur(8px);";
    document.body.appendChild(d);
    expect(isVeilOverlay(d, window)).toBe(true);
  });
  it("flags a known vendor overlay by class even without blur", () => {
    const d = document.createElement("div");
    d.className = "piano-meter-overlay";
    d.style.cssText = "position:fixed;z-index:99999;";
    document.body.appendChild(d);
    expect(isVeilOverlay(d, window)).toBe(true);
  });
  it("ignores a small decorative blurred element (not fixed)", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:relative;filter:blur(4px);";
    document.body.appendChild(d);
    expect(isVeilOverlay(d, window)).toBe(false);
  });
});

describe("removeVeils", () => {
  it("removes veils and respects skip()", () => {
    document.body.innerHTML =
      `<div id="v" class="piano-meter-overlay" style="position:fixed;z-index:99999"></div>` +
      `<div id="keep" style="position:fixed;z-index:99999;backdrop-filter:blur(8px)"></div>`;
    const removed = removeVeils(document, (el) => el.id === "keep");
    expect(document.getElementById("v")).toBeNull();
    expect(document.getElementById("keep")).not.toBeNull();
    expect(removed.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/paywall-veil.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// src/lib/paywall-veil.js
// Full-viewport fixed overlays that veil/blur the page behind a metering gate
// (e.g. ArchDaily's Piano ".piano-meter-overlay"). De-blurring alone leaves the
// semi-opaque background, so we remove the whole overlay.
const VENDOR_SEL = [
  '[class*="piano-meter" i]', '[class*="tp-modal" i]', '[class*="tp-backdrop" i]',
  '[class*="poool" i]', '[class*="pelcro" i]', '[class*="zephr" i]',
  '[class*="paywall" i]', '[class*="regwall" i]',
].join(",");

function safeMatches(el, sel) { try { return el.matches(sel); } catch { return false; } }

export function isVeilOverlay(el, win) {
  if (!el || el.nodeType !== 1) return false;
  let cs; try { cs = win.getComputedStyle(el); } catch { return false; }
  if (cs.position !== "fixed") return false;

  // Covers ~the whole viewport (skip the size test when layout is unavailable,
  // e.g. jsdom returns 0x0).
  let rect; try { rect = el.getBoundingClientRect(); } catch { rect = null; }
  const vw = win.innerWidth || 1024, vh = win.innerHeight || 768;
  if (rect && rect.width * rect.height > 0) {
    if (rect.width < vw * 0.9 || rect.height < vh * 0.9) return false;
  }

  if (safeMatches(el, VENDOR_SEL)) return true; // known metering veil

  const z = parseInt(cs.zIndex, 10);
  const highZ = !Number.isNaN(z) && z >= 1000;
  const blur = /blur\(/i.test(cs.backdropFilter || cs.webkitBackdropFilter || "") ||
               /blur\(/i.test(cs.filter || "");
  return highZ && blur; // generic full-screen blur veil
}

export function removeVeils(doc, skip) {
  const win = doc.defaultView || window;
  const removed = [];
  for (const el of doc.body.querySelectorAll("div,section,aside")) {
    if (skip && skip(el)) continue;
    if (!isVeilOverlay(el, win)) continue;
    const label = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : el.tagName.toLowerCase();
    try { el.remove(); removed.push(label); } catch { /* ignore */ }
  }
  return removed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/paywall-veil.test.js`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/paywall-veil.js tests/paywall-veil.test.js
git commit -m "feat: remove full-viewport paywall veils (Piano/ArchDaily)"
```

---

### Task 3: Reveal module — deep restore + residual-gating detector

Splits the risky restores out of the auto pass. Safe restores (de-blur, scroll unfreeze) stay where they are (`restore.js`); the **aggressive** ones live here and run only on demand.

**Files:**
- Create: `src/lib/reveal.js`
- Test: `tests/reveal.test.js`

**Interfaces:**
- Produces:
  - `revealDeep(doc, skip) => number` (count of elements changed): clears `max-height` truncation on long-text containers, restores inline `opacity:0`/`pointer-events:none` locks, and strips remaining blur.
  - `hasResidualGating(doc) => boolean`: true if a long-text container is still `max-height`-clamped with hidden overflow, or a large low-opacity block remains.

- [ ] **Step 1: Write the failing test**

```js
// tests/reveal.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { revealDeep, hasResidualGating } from "../src/lib/reveal.js";

beforeEach(() => { document.body.innerHTML = ""; });

const long = "word ".repeat(200); // > 600 chars

describe("hasResidualGating", () => {
  it("detects a clamped long-text container", () => {
    document.body.innerHTML =
      `<div id="c" style="max-height:300px;overflow:hidden">${long}</div>`;
    expect(hasResidualGating(document)).toBe(true);
  });
  it("returns false for a normal page", () => {
    document.body.innerHTML = `<div>${long}</div>`;
    expect(hasResidualGating(document)).toBe(false);
  });
});

describe("revealDeep", () => {
  it("clears max-height truncation on long-text containers", () => {
    document.body.innerHTML =
      `<div id="c" style="max-height:300px;overflow:hidden">${long}</div>`;
    const n = revealDeep(document);
    const el = document.getElementById("c");
    expect(el.style.maxHeight).toBe("none");
    expect(n).toBeGreaterThan(0);
  });
  it("restores an inline pointer-events:none lock", () => {
    document.body.innerHTML = `<div id="l" style="pointer-events:none;opacity:0">${long}</div>`;
    revealDeep(document);
    const el = document.getElementById("l");
    expect(el.style.pointerEvents).toBe("auto");
    expect(el.style.opacity).toBe("1");
  });
  it("respects skip()", () => {
    document.body.innerHTML =
      `<div id="c" style="max-height:300px;overflow:hidden">${long}</div>`;
    revealDeep(document, (el) => el.id === "c");
    expect(document.getElementById("c").style.maxHeight).toBe("300px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reveal.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// src/lib/reveal.js
// Aggressive content restore. NOT run automatically — it can expand legitimate
// collapsed sections and reveal hidden menus, so it runs only on the user's
// "Reveal (deeper)" action, surfaced when hasResidualGating() is true.
const MIN_TEXT = 600;
const MAX_CLAMP = 2000; // ignore very tall max-heights (likely legit layout)

function clamped(cs) {
  const mh = parseFloat(cs.maxHeight);
  const hidden = /hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY);
  return !Number.isNaN(mh) && cs.maxHeight !== "none" && mh < MAX_CLAMP && hidden;
}

export function hasResidualGating(doc) {
  const win = doc.defaultView || window;
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    let cs; try { cs = win.getComputedStyle(el); } catch { continue; }
    const long = (el.textContent || "").length > MIN_TEXT;
    if (long && clamped(cs)) return true;
    if (long && parseFloat(cs.opacity || "1") <= 0.05) return true;
  }
  return false;
}

export function revealDeep(doc, skip) {
  const win = doc.defaultView || window;
  let changes = 0;
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    if (skip && skip(el)) continue;
    let cs; try { cs = win.getComputedStyle(el); } catch { continue; }
    const long = (el.textContent || "").length > MIN_TEXT;

    if (long && clamped(cs)) {
      el.style.setProperty("max-height", "none", "important");
      el.style.setProperty("overflow", "visible", "important");
      changes++;
    }
    const inline = (el.getAttribute && el.getAttribute("style")) || "";
    if (/pointer-events\s*:\s*none|opacity\s*:\s*0(?!\.)/i.test(inline)) {
      el.style.setProperty("pointer-events", "auto", "important");
      el.style.setProperty("opacity", "1", "important");
      changes++;
    }
    if (/blur\(/i.test(cs.filter || "") || /blur\(/i.test(cs.backdropFilter || "")) {
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("backdrop-filter", "none", "important");
      changes++;
    }
  }
  return changes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reveal.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reveal.js tests/reveal.test.js
git commit -m "feat: reveal-deep restore + residual-gating detector"
```

---

### Task 4: Undo stack for Revert

**Files:**
- Create: `src/lib/undo.js`
- Test: `tests/undo.test.js`

**Interfaces:**
- Produces: `createUndoStack() => { record(node, ruleRef), revertLast() => boolean, size() }`
  - `record(node, ruleRef)`: called right **before** a node is removed; captures `{ node, parent, nextSibling, ruleRef }`. `ruleRef` is `{ list, rule }` so Revert can also drop the rule Block added (or `null`).
  - `revertLast()`: re-inserts the most recent node at its original sibling position and removes `ruleRef.rule` from `ruleRef.list`. Returns false if nothing to revert.

- [ ] **Step 1: Write the failing test**

```js
// tests/undo.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { createUndoStack } from "../src/lib/undo.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createUndoStack", () => {
  it("re-inserts a removed node at its original position and drops the rule", () => {
    document.body.innerHTML = `<div id="a"></div><div id="b"></div><div id="c"></div>`;
    const b = document.getElementById("b");
    const list = [{ type: "id", value: "b" }];
    const stack = createUndoStack();
    stack.record(b, { list, rule: list[0] });
    b.remove();
    expect(document.getElementById("b")).toBeNull();

    expect(stack.revertLast()).toBe(true);
    const order = [...document.body.children].map((el) => el.id);
    expect(order).toEqual(["a", "b", "c"]); // restored between a and c
    expect(list.length).toBe(0);            // rule removed
  });

  it("returns false when empty", () => {
    expect(createUndoStack().revertLast()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/undo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// src/lib/undo.js
// Tracks Block removals so "Revert" can put the element back and undo its rule.
export function createUndoStack() {
  const items = [];
  return {
    record(node, ruleRef) {
      if (!node || !node.parentNode) return;
      items.push({ node, parent: node.parentNode, nextSibling: node.nextSibling, ruleRef: ruleRef || null });
    },
    revertLast() {
      const it = items.pop();
      if (!it) return false;
      try {
        if (it.nextSibling && it.nextSibling.parentNode === it.parent) {
          it.parent.insertBefore(it.node, it.nextSibling);
        } else {
          it.parent.appendChild(it.node);
        }
      } catch { return false; }
      if (it.ruleRef && it.ruleRef.list) {
        const i = it.ruleRef.list.indexOf(it.ruleRef.rule);
        if (i >= 0) it.ruleRef.list.splice(i, 1);
      }
      return true;
    },
    size() { return items.length; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/undo.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo.js tests/undo.test.js
git commit -m "feat: undo stack for Revert"
```

---

### Task 5: Update checker

**Files:**
- Create: `src/lib/updates.js`
- Test: `tests/updates.test.js`

**Interfaces:**
- Produces:
  - `parseVersion(headerText) => string | null` (reads `@version` from a userscript header block)
  - `compareVersions(a, b) => -1 | 0 | 1` (semver-ish numeric compare)
  - `updateMessage(current, remote) => string`

- [ ] **Step 1: Write the failing test**

```js
// tests/updates.test.js
import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, updateMessage } from "../src/lib/updates.js";

describe("updates", () => {
  it("parses @version from a header", () => {
    expect(parseVersion("// @name X\n// @version      2.1.0\n")).toBe("2.1.0");
    expect(parseVersion("no header")).toBe(null);
  });
  it("compares versions numerically", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.9.0", "2.0.0")).toBe(-1);
  });
  it("messages by comparison", () => {
    expect(updateMessage("2.0.0", "2.0.0")).toMatch(/up to date/i);
    expect(updateMessage("2.0.0", "2.1.0")).toMatch(/2\.1\.0 available/i);
    expect(updateMessage("2.0.0", null)).toMatch(/couldn.t check/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/updates.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// src/lib/updates.js
export function parseVersion(headerText) {
  const m = /@version\s+([0-9][0-9A-Za-z.\-]*)/.exec(headerText || "");
  return m ? m[1] : null;
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function updateMessage(current, remote) {
  if (!remote) return "Couldn't check for updates (network blocked).";
  const c = compareVersions(remote, current);
  if (c > 0) return `v${remote} available — your userscript manager will install it.`;
  return "Up to date ✓";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/updates.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/updates.js tests/updates.test.js
git commit -m "feat: update checker (compare local vs remote @version)"
```

---

### Task 6: Block picker core (ranked candidates + DOM tree cycling)

Pure selection logic, unit-testable; the outline/toolbar rendering is wired in Task 8.

**Files:**
- Create: `src/lib/picker.js`
- Test: `tests/picker.test.js`

**Interfaces:**
- Consumes: `scorePopupCandidate` from `learner.js`.
- Produces: `createPicker(doc) => { current(), nextCandidate(), prevCandidate(), grow(), shrink(), candidateCount() }`
  - Builds a ranked list of candidate elements (score-desc, top 8). `current()` returns the active target.
  - `nextCandidate()`/`prevCandidate()` cycle the ranked list (wrapping) and reset the target to that candidate.
  - `grow()` moves the target to its parent element (not past `body`); `shrink()` moves to the first element child. Both return `current()`.

- [ ] **Step 1: Write the failing test**

```js
// tests/picker.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { createPicker } from "../src/lib/picker.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createPicker", () => {
  it("ranks fixed high-z overlays first and cycles them", () => {
    document.body.innerHTML =
      `<div id="lo" style="position:relative">login please</div>` +
      `<div id="hi" style="position:fixed;z-index:99999">subscribe to continue</div>`;
    const p = createPicker(document);
    expect(p.candidateCount()).toBeGreaterThan(0);
    expect(p.current().id).toBe("hi");        // highest score first
    const first = p.current();
    p.nextCandidate();
    expect(p.current()).not.toBe(first);      // moved to another candidate
  });

  it("grows to parent and shrinks to child", () => {
    document.body.innerHTML =
      `<section id="outer"><div id="mid" style="position:fixed;z-index:99999">register now<span id="inner">x</span></div></section>`;
    const p = createPicker(document);
    // target starts at #mid (top candidate)
    expect(p.current().id).toBe("mid");
    expect(p.grow().id).toBe("outer");
    expect(p.shrink().id).toBe("mid");
    expect(p.shrink().id).toBe("inner");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/picker.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// src/lib/picker.js
import { scorePopupCandidate } from "./learner.js";

const MAX_CANDIDATES = 8;

function rankCandidates(doc) {
  const scored = [];
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    const s = scorePopupCandidate(el);
    if (s > 0) scored.push({ el, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, MAX_CANDIDATES).map((x) => x.el);
}

export function createPicker(doc) {
  const candidates = rankCandidates(doc);
  let idx = 0;
  let target = candidates[0] || doc.body;

  return {
    current() { return target; },
    candidateCount() { return candidates.length; },
    nextCandidate() {
      if (!candidates.length) return target;
      idx = (idx + 1) % candidates.length;
      target = candidates[idx];
      return target;
    },
    prevCandidate() {
      if (!candidates.length) return target;
      idx = (idx - 1 + candidates.length) % candidates.length;
      target = candidates[idx];
      return target;
    },
    grow() {
      if (target && target.parentElement && target.parentElement !== doc.documentElement
          && target !== doc.body) {
        target = target.parentElement;
      }
      return target;
    },
    shrink() {
      const child = target && target.firstElementChild;
      if (child) target = child;
      return target;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/picker.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/picker.js tests/picker.test.js
git commit -m "feat: Block picker core (ranked candidates + DOM cycling)"
```

---

### Task 7: Blocker safe pass — wire veil removal, keep de-blur, drop auto max-height

Rework `blocker.js` so the always-on pass includes veil removal + de-blur + gate-overlay-text removal, and the risky max-height clearing is removed from the auto path (it moves to Reveal, Task 3/9).

**Files:**
- Modify: `src/lib/blocker.js`
- Test: `tests/blocker.test.js` (extend)

**Interfaces:**
- Consumes: `removeVeils` from `paywall-veil.js`.
- Produces: `runBlocker` still `({ doc, library, hostname, log })`; the safe pass now calls `removeVeils`. `unlockContent` keeps only the gate-overlay-text removal (step 1); its max-height loop (step 2) is deleted.

- [ ] **Step 1: Write the failing test**

```js
// add to tests/blocker.test.js
import { runBlocker } from "../src/lib/blocker.js";

it("removes a Piano veil overlay in the default pass", () => {
  document.body.innerHTML =
    `<div class="piano-meter-overlay" style="position:fixed;z-index:99999"></div>` +
    `<article>${"word ".repeat(200)}</article>`;
  const library = { enabled: true, disabledDomains: [], global: [], domains: {}, whitelist: [] };
  runBlocker({ doc: document, library, hostname: "archdaily.com", log: () => {} });
  expect(document.querySelector(".piano-meter-overlay")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/blocker.test.js`
Expected: FAIL — overlay still present (veil removal not wired).

- [ ] **Step 3: Wire veil removal into the safe pass**

In `src/lib/blocker.js`, add the import and call it in `restorePass` (runs on every pass):

```js
import { removeVeils } from "./paywall-veil.js";
```

In `restorePass(doc, whitelist, log)`, before the blur removal line, add:

```js
  const veils = removeVeils(doc, (el) => skip(el, whitelist));
  if (veils.length) log("paywall", `removed ${veils.length} veil overlay(s): ${veils.join(", ")}`);
```

- [ ] **Step 4: Remove the risky auto max-height loop from `unlockContent`**

In `src/lib/blocker.js`, delete the entire "2. Clear max-height truncation…" loop inside `unlockContent` (the `for (const el of doc.body.querySelectorAll("*"))` block that sets `max-height:none`). Keep step 1 (gate-overlay-text removal). This prevents auto-expanding legit collapsed UI; the behaviour moves to Reveal.

- [ ] **Step 5: Run the blocker tests**

Run: `npx vitest run tests/blocker.test.js`
Expected: PASS, including the new veil test. If an existing test asserted auto max-height clearing, move that assertion to `tests/reveal.test.js` (it's covered there) and delete it here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/blocker.js tests/blocker.test.js
git commit -m "feat: veil removal in safe pass; move max-height clearing to Reveal"
```

---

### Task 8: Observe attribute mutations (ArchDaily fix, part 2)

**Files:**
- Modify: `src/main.js` (the `startObserver` function)

**Interfaces:** unchanged; behavioural fix only.

- [ ] **Step 1: Update the observer to watch class/style attributes**

In `src/main.js`, in `startObserver()`, change the `obs.observe(...)` call to:

```js
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });
```

The existing `requestAnimationFrame` debounce (the `pending` flag) already coalesces the extra attribute callbacks into one `runOnce()` per frame, so this won't thrash.

- [ ] **Step 2: Build to confirm no syntax error**

Run: `npm run build`
Expected: `Built dist/popup-zapper.user.js (v2.0.0)`.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "fix: observe class/style mutations so late-applied blur is re-processed"
```

---

### Task 9: New UI — top toggle, 3 buttons, status strip, Settings panel

Rewrite the badge menu and add a Settings panel with per-rule toggle/edit/delete and version/update display. This is a large UI change; verify by build + manual check (jsdom can't lay out the menu meaningfully).

**Files:**
- Modify: `src/lib/ui.js`
- Test: `tests/ui.test.js` (extend — assert structure of new factories)

**Interfaces:**
- Produces (new/renamed factories):
  - `createControlMenu({ enabled, hostname, open, status, showReveal, onToggleSite, onBlock, onRemovePaywall, onRevert, onReveal, onSettings }) => HTMLElement` — top on/off switch, buttons **Block / Remove paywall / Revert**, a **status strip** (`status` string), a contextual **Reveal ▸** shown only when `showReveal`, and a **⚙ Settings** entry.
  - `createSettingsPanel({ library, hostname, version, onToggleRule, onEditRule, onDeleteRule, onPromoteRule, onToggleCleanup, onCheckUpdates, onShowLog, onDiagnostics, onClose }) => HTMLElement` — lists this site's rules (each with on/off checkbox, Edit, Delete, Make-global), a tracker-cleanup toggle, `Popup Zapper v<version>` + **Check for updates**, and Activity log / Diagnostics entries.
- Keep `createActivityPanel`, `createFilterPanel` as-is. Remove `createLearnerToolbar` and `createManagePanel` (superseded).

- [ ] **Step 1: Write the failing test**

```js
// add to tests/ui.test.js
import { createControlMenu, createSettingsPanel } from "../src/lib/ui.js";

it("control menu shows the three primary buttons and status", () => {
  const el = createControlMenu({
    enabled: true, hostname: "x.com", open: true, status: "✓ Blocked div.modal",
    showReveal: false,
    onToggleSite(){}, onBlock(){}, onRemovePaywall(){}, onRevert(){}, onReveal(){}, onSettings(){},
  });
  expect(el.querySelector('[data-act="block"]')).not.toBeNull();
  expect(el.querySelector('[data-act="paywall"]')).not.toBeNull();
  expect(el.querySelector('[data-act="revert"]')).not.toBeNull();
  expect(el.textContent).toContain("✓ Blocked div.modal");
  expect(el.querySelector('[data-act="reveal"]')).toBeNull(); // hidden unless showReveal
});

it("settings panel lists rules with toggles and shows version", () => {
  const library = { global: [], domains: { "x.com": { rules: [{ type: "class", value: "modal", enabled: true }] } } };
  const el = createSettingsPanel({
    library, hostname: "x.com", version: "2.0.0",
    onToggleRule(){}, onEditRule(){}, onDeleteRule(){}, onPromoteRule(){},
    onToggleCleanup(){}, onCheckUpdates(){}, onShowLog(){}, onDiagnostics(){}, onClose(){},
  });
  expect(el.textContent).toContain("class: modal");
  expect(el.textContent).toContain("2.0.0");
  expect(el.querySelector('[data-act="toggle-rule"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui.test.js`
Expected: FAIL — `createSettingsPanel is not exported` / new factory shape.

- [ ] **Step 3: Implement the new factories**

Rewrite `createControlMenu` to render: header (hostname + running state), a top **on/off** button (`data-act="site"`), primary buttons `data-act="block"|"paywall"|"revert"`, a status `<div>` containing `status`, a `data-act="reveal"` button appended **only when `showReveal`**, and a `data-act="settings"` button. Reuse the existing `own()`, `tag()`, and `item()` styling helpers. Add `createSettingsPanel` following the `createManagePanel` pattern but: for each rule render a checkbox (`data-act="toggle-rule"`, checked = `rule.enabled !== false`) wired to `onToggleRule({ rule, scope })`, plus `Edit` (`data-act="edit-rule"` → `onEditRule({ rule, scope })`), `Delete` (`onDeleteRule`), and for site rules `Make global` (`onPromoteRule`). Append a tracker-cleanup checkbox (`onToggleCleanup`), a line `Popup Zapper v${version}` with a **Check for updates** button (`data-act="check-updates"` → `onCheckUpdates`), and `Activity log`/`Copy diagnostics` buttons. Delete `createLearnerToolbar` and `createManagePanel`.

- [ ] **Step 4: Run the UI tests**

Run: `npx vitest run tests/ui.test.js`
Expected: PASS. Update any existing `ui.test.js` assertions that referenced the removed factories.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui.js tests/ui.test.js
git commit -m "feat: consolidated badge menu (3 buttons + status) and Settings panel"
```

---

### Task 10: Wire the new actions in main.js

Connect the picker, undo, reveal, remove-paywall, update-check, and status strip into `main.js`, replacing the old learner/manage/unlock wiring.

**Files:**
- Modify: `src/main.js`
- Test: manual (build + ArchDaily), plus keep `npm test` green.

**Interfaces:**
- Consumes: `createPicker` (picker.js), `createUndoStack` (undo.js), `revealDeep`/`hasResidualGating` (reveal.js), `extractCleanContent`/`buildCleanDocument` (cleanfetch.js), `captureSnapshot` (freeze.js), `parseVersion`/`updateMessage` (updates.js), new `ui.js` factories.

- [ ] **Step 1: Add a status string + undo stack, and refactor `refreshControl`**

At module scope add: `let lastStatus = "";` and `const undo = createUndoStack();`. Add a helper:

```js
function setStatus(msg) { lastStatus = msg; refreshControl(true); }
```

Subscribe once to the activity log to mirror its latest entry into the status strip:

```js
activityLog.subscribe(() => {
  const es = activityLog.entries();
  if (es.length) lastStatus = `${es[es.length - 1].action}: ${es[es.length - 1].detail}`;
});
```

- [ ] **Step 2: Implement the Block flow using the picker**

Replace `startLearner` with `startBlock()` that: creates `const picker = createPicker(document)`, outlines `picker.current()` (set `outline` element's `style.outline = "3px solid #ff3b30"`), and renders a small toolbar (reuse an inline element marked `own(...,"toolbar")`) with buttons: ◀ prev (`picker.prevCandidate`), ▶ next (`picker.nextCandidate`), ▲ grow (`picker.grow`), ▼ shrink (`picker.shrink`), a checkbox "apply on all sites", **Block**, and **Cancel**. Bind `keydown` (capture) so `[`=grow, `]`=shrink while active. Each nav action re-outlines `picker.current()`. **Block** does:

```js
const el = picker.current();
const kws = extractKeywords(el);
const global = allSitesChecked;
const list = global ? library.global : domainEntry().rules;
const rule = kws[0] ? { ...kws[0], enabled: true } : null;
if (rule) list.push(rule);
undo.record(el, rule ? { list, rule } : null);
el.remove();
persist();
setStatus(rule ? `✓ Blocked ${el.tagName.toLowerCase()} (${global ? "all sites" : "this site"})` : "✓ Removed (no rule saved)");
runOnce();
cleanup();
```

Cancel/Esc clears the outline + toolbar with no change.

- [ ] **Step 3: Implement Revert, Reveal, Remove-paywall, and update-check handlers**

```js
function doRevert() {
  setStatus(undo.revertLast() ? "↩ Reverted last block" : "Nothing to revert");
  persist();
}

function doReveal() {
  const n = revealDeep(document, (el) => el.closest("[data-pz]"));
  setStatus(n ? `Revealed content (${n} change(s))` : "Nothing more to reveal");
}

function doRemovePaywall() {
  // 1. try in place
  runOnce();
  captureSnapshot(document, window.sessionStorage); // keep first-paint content
  // 2. cookie-free refetch -> clean copy in a NEW tab
  if (typeof GM_xmlhttpRequest !== "function") { setStatus("Clean fetch unavailable"); return; }
  setStatus("Fetching clean copy…");
  GM_xmlhttpRequest({
    method: "GET", url: location.href, anonymous: true, headers: { "Cache-Control": "no-cache" },
    onload: (res) => {
      const extracted = extractCleanContent(res.responseText);
      const html = extracted && extracted.len >= 400 ? buildCleanDocument(res.responseText, location.href) : null;
      if (!html) { setStatus("Clean copy was also gated (server-side)"); return; }
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const w = window.open(url, "_blank");
      if (!w) window.location.href = url;
      setStatus(`Opened clean copy (${extracted.len} chars)`);
    },
    onerror: () => setStatus("Clean fetch failed"),
  });
}

function checkUpdates() {
  if (typeof GM_xmlhttpRequest !== "function") { alert("Update check unavailable."); return; }
  GM_xmlhttpRequest({
    method: "GET",
    url: "https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js",
    onload: (res) => alert("Popup Zapper: " + updateMessage(VERSION, parseVersion(res.responseText))),
    onerror: () => alert("Popup Zapper: " + updateMessage(VERSION, null)),
  });
}
```

Add `const VERSION = GM_info && GM_info.script ? GM_info.script.version : "0.0.0";` near the top (Violentmonkey exposes `GM_info`).

- [ ] **Step 4: Rebuild `refreshControl` to use the new menu + Settings**

`refreshControl(open)` now calls `createControlMenu({ enabled, hostname, open, status: lastStatus, showReveal: hasResidualGating(document), onToggleSite: toggleSite, onBlock: startBlock, onRemovePaywall: doRemovePaywall, onRevert: doRevert, onReveal: doReveal, onSettings: toggleSettings })`. Add `toggleSettings()` that mounts `createSettingsPanel({...})` wired to: `onToggleRule` (flip `rule.enabled`, `persist()`, `runOnce()`), `onEditRule` (prompt for a new `value`, update, `persist()`, `runOnce()`), `onDeleteRule`/`onPromoteRule` (as the old manage panel did), `onToggleCleanup` (flip `domainEntry().cleanup`), `onCheckUpdates: checkUpdates`, `onShowLog: toggleLog`, `onDiagnostics: copyDiagnostics`. Remove `startLearner`, `toggleManage`, `toggleUnlock` and their `GM_registerMenuCommand` lines; register the new commands: Block, Remove paywall, Revert, Reveal deeper, Settings.

- [ ] **Step 5: Build and run the suite**

Run: `npm run build && npm test`
Expected: build OK; all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat: wire Block/Remove-paywall/Revert/Reveal/Settings + status strip"
```

---

### Task 11: Manual verification, cleanup, and release

**Files:** none (verification) — then a release.

- [ ] **Step 1: Load the built script**

Install `dist/popup-zapper.user.js` into Violentmonkey (drag onto the dashboard). Confirm the badge shows and the menu has exactly: top toggle, **Block · Remove paywall · Revert**, status strip, **Settings**.

- [ ] **Step 2: Verify the ArchDaily fix**

Open a metered ArchDaily article and read until the Piano gate blurs it. Expected: the blur/veil is removed automatically (no click), because the observer now re-runs on the class/style toggle and `removeVeils` deletes `.piano-meter-overlay`. If any truncation remains, the status strip shows **Still blocked? Reveal ▸**; clicking it un-truncates. Copy diagnostics if it fails and inspect the "Blurred elements" / veil list.

- [ ] **Step 3: Verify Block + Revert**

On any site with a popup: **Block** → cycle candidates (▶) and grow/shrink (`[`/`]`) until the outline wraps it → Block. Confirm it's removed and reappears on reload (rule saved). **Revert** → it comes back and the rule is gone (check Settings).

- [ ] **Step 4: Verify Settings**

Open Settings: toggle a rule off (the popup returns live), edit a rule value, delete a rule, check the version line, click **Check for updates** (expect "Up to date ✓").

- [ ] **Step 5: Update README to match the new UI**

Rewrite the "Controls" section of `README.md` to describe: automatic defaults (cookie-reject, anti-reload, de-blur/veil removal), **Block**, **Remove paywall**, **Revert**, **Reveal (deeper)**, **Settings**, and the install-from-raw-URL + auto-update note. Commit:

```bash
git add README.md
git commit -m "docs: README for the consolidated UI + auto-update"
```

- [ ] **Step 6: Make the repo public + release**

On GitHub, set `edrowbo/popup-zapper` to **Public** (Settings → General → Danger Zone → Change visibility). Then run:

```bash
npm run release
```

Confirm `https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js` returns HTTP 200 and shows the new `@version`. Send that URL to the friend; his Violentmonkey installs once and auto-updates on future `npm run release`.

---

## Self-Review

**Spec coverage:** ArchDaily fix → Tasks 2, 7, 8 (veil + observer). UI consolidation → Tasks 8, 9. Block (ranked+cycle, global/local) → Tasks 6, 9. Revert → Tasks 4, 9. Reveal contextual → Tasks 3, 9 (`hasResidualGating` gates the button). Remove paywall (new tab) → Task 9. Status strip → Tasks 8, 9. Settings (rule toggle/edit/delete/promote, cleanup, version/update) → Tasks 5, 9. Defaults (cookie/anti-reload/de-blur) → already present + Task 7. Auto-update/distribution → Tasks 1, 11. Data model (no migration) → Task 9 writes `enabled`. All covered.

**Placeholder scan:** No TBD/TODO; every code step shows real code. Task 9/10 UI/wiring steps describe concrete `data-act` hooks and handler bodies rather than pasting the full 200-line file, since they modify large existing files — acceptable per the "modify existing large file" guidance.

**Type consistency:** `removeVeils(doc, skip)`, `revealDeep(doc, skip)`, `hasResidualGating(doc)`, `createPicker(doc)` methods, `createUndoStack().record/revertLast`, `parseVersion/compareVersions/updateMessage`, and the `createControlMenu`/`createSettingsPanel` prop names are used identically across tasks. Rules stay `{type, value, action, enabled?}` throughout.