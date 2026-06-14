# Popup Zapper v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Brave/Violentmonkey userscript that always removes login/consent/newsletter/paywall popups, restores degraded content (de-blur, unfreeze scroll), defeats client-side reload traps, and learns new popups by click.

**Architecture:** Logic lives in small pure-ish ES modules under `src/lib/` (unit-tested with Vitest + jsdom). A thin `src/main.js` wires them to the browser, GM storage, and hotkeys. `build.js` bundles everything with esbuild into a single `dist/popup-zapper.user.js` carrying the Violentmonkey metadata header. Two engines (Blocker, Learner) share one JSON library in GM storage.

**Tech Stack:** Vanilla JavaScript (ES modules), Violentmonkey (`GM_*` APIs), Vitest + jsdom (tests), esbuild (bundle). Node 18+.

---

## File Structure

- `package.json` — scripts + dev deps (vitest, jsdom, esbuild)
- `vitest.config.js` — jsdom environment
- `build.js` — esbuild bundle + userscript banner
- `src/userscript-header.js` — the `==UserScript==` metadata block (string export, injected by build)
- `src/lib/storage.js` — library defaults, load/save, schema-version guard
- `src/lib/rules.js` — rule matching + active-rule resolution
- `src/lib/extract.js` — keyword extraction from an element (skips hashed tokens)
- `src/lib/restore.js` — detect + undo content-degradation styles
- `src/lib/consent.js` — find a reject/decline button
- `src/lib/cleanup.js` — optional post-consent tracker cleanup (off by default)
- `src/lib/reload-guard.js` — reload-trap defense + circuit breaker (injectable window)
- `src/lib/learner.js` — popup-candidate scoring / best-guess finder
- `src/lib/blocker.js` — orchestrate consent→popup→restore passes + observer
- `src/lib/ui.js` — learner toolbar, manage panel, status badge (DOM)
- `src/main.js` — GM glue, hotkeys, engine wiring
- `dist/popup-zapper.user.js` — build output (generated)
- `tests/*.test.js` — one per lib module

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "popup-zapper",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "node build.js"
  },
  "devDependencies": {
    "esbuild": "^0.23.0",
    "jsdom": "^24.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.js"],
  },
});
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.log
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Verify the test runner works (no tests yet)**

Run: `npm test`
Expected: Vitest reports "No test files found" and exits 0 (or exits with "no tests" — acceptable at this stage).

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.js .gitignore
git commit -m "chore: scaffold popup-zapper project (vitest + esbuild)"
```

---

## Task 1: Storage module

**Files:**
- Create: `src/lib/storage.js`
- Test: `tests/storage.test.js`

The library is one JSON blob. `loadLibrary`/`saveLibrary` take injected getter/setter
functions so they are testable without `GM_*`.

- [ ] **Step 1: Write the failing test**

```js
// tests/storage.test.js
import { describe, it, expect } from "vitest";
import { DEFAULT_LIBRARY, loadLibrary, saveLibrary } from "../src/lib/storage.js";

describe("storage", () => {
  it("returns defaults when nothing is stored", () => {
    const lib = loadLibrary(() => undefined);
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });

  it("returns defaults when stored blob is corrupt", () => {
    const lib = loadLibrary(() => "{not valid json");
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });

  it("returns defaults when stored version mismatches", () => {
    const lib = loadLibrary(() => JSON.stringify({ version: 999, global: [{}] }));
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });

  it("merges stored fields over defaults", () => {
    const stored = JSON.stringify({
      version: 1,
      global: [{ type: "class", value: "promo", action: "remove" }],
    });
    const lib = loadLibrary(() => stored);
    expect(lib.global).toHaveLength(1);
    expect(lib.domains).toEqual({});
    expect(lib.enabled).toBe(true);
  });

  it("saveLibrary serializes via the injected setter", () => {
    let saved = null;
    saveLibrary((v) => { saved = v; }, DEFAULT_LIBRARY);
    expect(JSON.parse(saved).version).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.js`
Expected: FAIL — cannot find module `../src/lib/storage.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/storage.js
export const SCHEMA_VERSION = 1;

export const DEFAULT_LIBRARY = {
  version: SCHEMA_VERSION,
  enabled: true,
  disabledDomains: [],
  global: [],
  domains: {},
  whitelist: [],
};

export function loadLibrary(getValue) {
  let raw;
  try {
    raw = getValue("popupZapper.library");
  } catch {
    return clone(DEFAULT_LIBRARY);
  }
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

export function saveLibrary(setValue, library) {
  setValue("popupZapper.library", JSON.stringify(library));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage.test.js`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.js tests/storage.test.js
git commit -m "feat: library storage with schema guard and safe defaults"
```

---

## Task 2: Rule matching

**Files:**
- Create: `src/lib/rules.js`
- Test: `tests/rules.test.js`

A rule is `{ type: "id|class|attr|text|cmp", value, action: "remove|hide", enabled?, scope? }`.
`getActiveRules` returns global + per-domain rules, honoring `enabled` and `disabledDomains`.

- [ ] **Step 1: Write the failing test**

```js
// tests/rules.test.js
import { describe, it, expect } from "vitest";
import { matchesRule, getActiveRules, findMatches } from "../src/lib/rules.js";

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

describe("matchesRule", () => {
  it("matches by id", () => {
    expect(matchesRule(el(`<div id="signup-wall"></div>`),
      { type: "id", value: "signup-wall" })).toBe(true);
  });
  it("matches by class token", () => {
    expect(matchesRule(el(`<div class="a newsletter-modal b"></div>`),
      { type: "class", value: "newsletter-modal" })).toBe(true);
  });
  it("matches by attribute presence", () => {
    expect(matchesRule(el(`<div data-paywall="1"></div>`),
      { type: "attr", value: "data-paywall" })).toBe(true);
  });
  it("matches by text substring (case-insensitive)", () => {
    expect(matchesRule(el(`<div>Please Sign In to continue</div>`),
      { type: "text", value: "sign in" })).toBe(true);
  });
  it("matches by cmp selector", () => {
    expect(matchesRule(el(`<div id="onetrust-banner-sdk"></div>`),
      { type: "cmp", value: "#onetrust-banner-sdk" })).toBe(true);
  });
  it("does not match unrelated element", () => {
    expect(matchesRule(el(`<div class="article"></div>`),
      { type: "class", value: "newsletter-modal" })).toBe(false);
  });
});

describe("getActiveRules", () => {
  const lib = {
    version: 1, enabled: true, disabledDomains: ["off.com"],
    global: [
      { type: "class", value: "g1", action: "remove" },
      { type: "class", value: "g2", action: "remove", enabled: false },
    ],
    domains: { "site.com": { rules: [{ type: "id", value: "d1", action: "hide" }] } },
    whitelist: [],
  };
  it("returns enabled global + domain rules", () => {
    const rules = getActiveRules(lib, "site.com");
    expect(rules.map((r) => r.value)).toEqual(["g1", "d1"]);
  });
  it("returns nothing for a disabled domain", () => {
    expect(getActiveRules(lib, "off.com")).toEqual([]);
  });
  it("returns nothing when globally disabled", () => {
    expect(getActiveRules({ ...lib, enabled: false }, "site.com")).toEqual([]);
  });
});

describe("findMatches", () => {
  it("finds all matching elements under a root", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="promo"></div><p>x</p><div class="promo"></div>`;
    const matches = findMatches(root, [{ type: "class", value: "promo" }]);
    expect(matches).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rules.test.js`
Expected: FAIL — cannot find module `../src/lib/rules.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/rules.js
export function matchesRule(el, rule) {
  if (!el || el.nodeType !== 1) return false;
  switch (rule.type) {
    case "id":
      return el.id === rule.value;
    case "class":
      return el.classList && el.classList.contains(rule.value);
    case "attr":
      return el.hasAttribute(rule.value);
    case "text":
      return (el.textContent || "").toLowerCase().includes(rule.value.toLowerCase());
    case "cmp":
      try { return el.matches(rule.value); } catch { return false; }
    default:
      return false;
  }
}

export function getActiveRules(library, hostname) {
  if (!library.enabled) return [];
  if ((library.disabledDomains || []).includes(hostname)) return [];
  const enabled = (r) => r.enabled !== false;
  const global = (library.global || []).filter(enabled);
  const domain = (((library.domains || {})[hostname] || {}).rules || []).filter(enabled);
  return [...global, ...domain];
}

export function findMatches(root, rules) {
  const out = [];
  const all = root.querySelectorAll("*");
  for (const el of all) {
    for (const rule of rules) {
      if (matchesRule(el, rule)) { out.push(el); break; }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rules.test.js`
Expected: PASS (all passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.js tests/rules.test.js
git commit -m "feat: rule matching and active-rule resolution"
```

---

## Task 3: Keyword extraction

**Files:**
- Create: `src/lib/extract.js`
- Test: `tests/extract.test.js`

Extract stable identifiers from an element, ranked id > class > attr > text, skipping
hashed/random class tokens so learned rules are not brittle.

- [ ] **Step 1: Write the failing test**

```js
// tests/extract.test.js
import { describe, it, expect } from "vitest";
import { isHashedToken, extractKeywords } from "../src/lib/extract.js";

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

describe("isHashedToken", () => {
  it("flags css-module / hashed tokens", () => {
    expect(isHashedToken("css-1a2b3c")).toBe(true);
    expect(isHashedToken("_3xYz9k")).toBe(true);
  });
  it("keeps human class names", () => {
    expect(isHashedToken("newsletter-modal")).toBe(false);
    expect(isHashedToken("signup")).toBe(false);
    expect(isHashedToken("btn")).toBe(false);
  });
});

describe("extractKeywords", () => {
  it("prefers id, then human classes, skipping hashed", () => {
    const node = el(`<div id="paywall" class="modal css-1a2b3c" data-testid="gate">Sign in</div>`);
    const kws = extractKeywords(node);
    const values = kws.map((k) => k.value);
    expect(values).toContain("paywall");
    expect(values).toContain("modal");
    expect(values).not.toContain("css-1a2b3c");
    // id ranked before class
    expect(kws[0]).toEqual({ type: "id", value: "paywall", action: "remove" });
  });

  it("falls back to a data-attr when no id/usable class", () => {
    const node = el(`<div class="css-1a2b3c" data-modal="login"></div>`);
    const kws = extractKeywords(node);
    expect(kws.some((k) => k.type === "attr" && k.value === "data-modal")).toBe(true);
  });

  it("uses a short text snippet only as a last resort", () => {
    const node = el(`<div>Subscribe now</div>`);
    const kws = extractKeywords(node);
    expect(kws).toEqual([{ type: "text", value: "Subscribe now", action: "remove" }]);
  });

  it("returns empty for an element with no usable signal", () => {
    const node = el(`<div></div>`);
    expect(extractKeywords(node)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/extract.test.js`
Expected: FAIL — cannot find module `../src/lib/extract.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/extract.js
const MAX_TEXT_LEN = 40;

export function isHashedToken(token) {
  if (!token || token.length < 4) return false;
  if (/^_[a-z0-9]{4,}$/i.test(token)) return true;
  const digits = (token.match(/[0-9]/g) || []).length;
  const hasMix = /[a-z][0-9]|[0-9][a-z]/i.test(token);
  return hasMix && digits >= 2 && token.length >= 5;
}

export function extractKeywords(el) {
  const out = [];
  if (!el || el.nodeType !== 1) return out;

  if (el.id && !isHashedToken(el.id)) {
    out.push({ type: "id", value: el.id, action: "remove" });
  }

  for (const cls of el.classList || []) {
    if (!isHashedToken(cls)) out.push({ type: "class", value: cls, action: "remove" });
  }

  for (const attr of el.attributes || []) {
    if (attr.name.startsWith("data-")) {
      out.push({ type: "attr", value: attr.name, action: "remove" });
    }
  }

  if (out.length === 0) {
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    if (text && text.length <= MAX_TEXT_LEN) {
      out.push({ type: "text", value: text, action: "remove" });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/extract.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/extract.js tests/extract.test.js
git commit -m "feat: keyword extraction with hashed-token filtering"
```

---

## Task 4: Content restore

**Files:**
- Create: `src/lib/restore.js`
- Test: `tests/restore.test.js`

Detect and undo degradation: blur, near-zero opacity, disabled pointer-events/select,
max-height clamps, and html/body scroll-lock.

- [ ] **Step 1: Write the failing test**

```js
// tests/restore.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { detectDegradation, restoreElement, restorePage } from "../src/lib/restore.js";

beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("detectDegradation", () => {
  it("detects inline blur", () => {
    const d = document.createElement("div");
    d.style.filter = "blur(8px)";
    expect(detectDegradation(d).blur).toBe(true);
  });
  it("detects near-zero opacity", () => {
    const d = document.createElement("div");
    d.style.opacity = "0.02";
    expect(detectDegradation(d).opacity).toBe(true);
  });
  it("reports nothing for a clean element", () => {
    const d = document.createElement("div");
    expect(detectDegradation(d)).toEqual({
      blur: false, opacity: false, pointerEvents: false,
      userSelect: false, maxHeight: false,
    });
  });
});

describe("restoreElement", () => {
  it("strips blur and resets opacity/pointer-events", () => {
    const d = document.createElement("div");
    d.style.filter = "blur(8px)";
    d.style.opacity = "0.02";
    d.style.pointerEvents = "none";
    restoreElement(d);
    expect(d.style.filter).toBe("none");
    expect(d.style.opacity).toBe("1");
    expect(d.style.pointerEvents).toBe("auto");
  });
});

describe("restorePage", () => {
  it("unfreezes html/body scroll", () => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    restorePage(document);
    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.position).toBe("static");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/restore.test.js`
Expected: FAIL — cannot find module `../src/lib/restore.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/restore.js
function styleOf(el) {
  const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
  return {
    filter: el.style.filter || cs.filter || "",
    backdrop: el.style.backdropFilter || cs.backdropFilter || "",
    opacity: el.style.opacity || cs.opacity || "1",
    pointerEvents: el.style.pointerEvents || cs.pointerEvents || "auto",
    userSelect: el.style.userSelect || cs.userSelect || "auto",
    maxHeight: el.style.maxHeight || cs.maxHeight || "none",
  };
}

export function detectDegradation(el) {
  const s = styleOf(el);
  const blur = /blur\(/i.test(s.filter) || /blur\(/i.test(s.backdrop);
  const opacity = parseFloat(s.opacity) <= 0.05;
  const pointerEvents = s.pointerEvents === "none";
  const userSelect = s.userSelect === "none";
  const maxHeight = /\d/.test(s.maxHeight) && s.maxHeight !== "none";
  return { blur, opacity, pointerEvents, userSelect, maxHeight };
}

export function restoreElement(el) {
  if (!el || el.nodeType !== 1) return;
  el.style.setProperty("filter", "none", "important");
  el.style.setProperty("backdrop-filter", "none", "important");
  el.style.setProperty("opacity", "1", "important");
  el.style.setProperty("pointer-events", "auto", "important");
  el.style.setProperty("user-select", "auto", "important");
  el.style.removeProperty("max-height");
}

export function restorePage(doc) {
  const html = doc.documentElement;
  const body = doc.body;
  for (const node of [html, body]) {
    if (!node) continue;
    node.style.setProperty("overflow", "auto", "important");
    node.style.setProperty("position", "static", "important");
    node.style.removeProperty("height");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/restore.test.js`
Expected: PASS.

> Note: `setProperty(..., "important")` makes `el.style.filter` read back as `"none"`,
> satisfying the assertions, and overrides stylesheet rules in the browser.

- [ ] **Step 5: Commit**

```bash
git add src/lib/restore.js tests/restore.test.js
git commit -m "feat: content-degradation detection and restore"
```

---

## Task 5: Consent reject finder

**Files:**
- Create: `src/lib/consent.js`
- Test: `tests/consent.test.js`

Find a reject/decline button within a banner by visible text, plus known CMP selectors.

- [ ] **Step 1: Write the failing test**

```js
// tests/consent.test.js
import { describe, it, expect } from "vitest";
import { findRejectButton, CMP_SELECTORS } from "../src/lib/consent.js";

function mount(html) {
  document.body.innerHTML = html;
  return document.body;
}

describe("findRejectButton", () => {
  it("finds a button whose text says Reject all", () => {
    const root = mount(`<div><button>Accept all</button><button>Reject all</button></div>`);
    const btn = findRejectButton(root);
    expect(btn.textContent).toBe("Reject all");
  });
  it("matches Decline / Necessary only variants", () => {
    const root = mount(`<div><a role="button">Necessary only</a></div>`);
    expect(findRejectButton(root).textContent).toBe("Necessary only");
  });
  it("ignores accept-only banners", () => {
    const root = mount(`<div><button>Accept all</button><button>Got it</button></div>`);
    expect(findRejectButton(root)).toBeNull();
  });
  it("exposes known CMP container selectors", () => {
    expect(CMP_SELECTORS).toContain("#onetrust-banner-sdk");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/consent.test.js`
Expected: FAIL — cannot find module `../src/lib/consent.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/consent.js
export const CMP_SELECTORS = [
  "#onetrust-banner-sdk",
  ".qc-cmp2-container",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  ".cc-window",
  "[id*='cookie' i][class*='banner' i]",
];

const REJECT_PATTERNS = [
  /reject all/i, /reject/i, /decline/i, /refuse/i,
  /necessary only/i, /only necessary/i, /essential only/i,
  /do not (accept|consent)/i, /deny/i,
];

const CLICKABLE = "button, a, [role='button'], input[type='button'], input[type='submit']";

export function findRejectButton(root) {
  if (!root) return null;
  const candidates = root.matches && root.matches(CLICKABLE)
    ? [root, ...root.querySelectorAll(CLICKABLE)]
    : [...root.querySelectorAll(CLICKABLE)];
  for (const node of candidates) {
    const label = (node.textContent || node.value || "").trim();
    if (!label) continue;
    if (REJECT_PATTERNS.some((re) => re.test(label))) return node;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/consent.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/consent.js tests/consent.test.js
git commit -m "feat: consent reject-button finder and CMP selectors"
```

---

## Task 6: Reload-trap guard

**Files:**
- Create: `src/lib/reload-guard.js`
- Test: `tests/reload-guard.test.js`

Suppress programmatic reloads/redirects that fire without recent user interaction, and
trip a circuit breaker after N rapid reloads. The guard takes an injected environment so
it is testable without a real browser.

- [ ] **Step 1: Write the failing test**

```js
// tests/reload-guard.test.js
import { describe, it, expect, vi } from "vitest";
import { createReloadGuard } from "../src/lib/reload-guard.js";

function fakeEnv() {
  const store = {};
  let t = 1000;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    reloadCalled: 0,
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: { reload() { this.host.reloadCalled++; } },
  };
}

describe("reload guard", () => {
  it("blocks a programmatic reload with no recent interaction", () => {
    const env = fakeEnv(); env.location.host = env;
    const guard = createReloadGuard({
      now: env.now, sessionStorage: env.sessionStorage,
      hadRecentInteraction: () => false, maxReloads: 3, windowMs: 5000,
    });
    expect(guard.allowReload()).toBe(false);
  });

  it("allows a reload right after user interaction", () => {
    const env = fakeEnv();
    const guard = createReloadGuard({
      now: env.now, sessionStorage: env.sessionStorage,
      hadRecentInteraction: () => true, maxReloads: 3, windowMs: 5000,
    });
    expect(guard.allowReload()).toBe(true);
  });

  it("trips the circuit breaker after maxReloads in the window", () => {
    const env = fakeEnv();
    const guard = createReloadGuard({
      now: env.now, sessionStorage: env.sessionStorage,
      hadRecentInteraction: () => true, maxReloads: 2, windowMs: 5000,
    });
    guard.recordReload();
    guard.recordReload();
    expect(guard.isTripped()).toBe(true);
    expect(guard.allowReload()).toBe(false); // breaker overrides interaction
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reload-guard.test.js`
Expected: FAIL — cannot find module `../src/lib/reload-guard.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/reload-guard.js
const KEY = "popupZapper.reloads";

export function createReloadGuard({
  now, sessionStorage, hadRecentInteraction,
  maxReloads = 3, windowMs = 5000,
}) {
  function readStamps() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); }
    catch { return []; }
  }
  function writeStamps(stamps) {
    sessionStorage.setItem(KEY, JSON.stringify(stamps));
  }
  function recent() {
    const cutoff = now() - windowMs;
    return readStamps().filter((t) => t >= cutoff);
  }

  return {
    recordReload() {
      const stamps = recent();
      stamps.push(now());
      writeStamps(stamps);
    },
    isTripped() {
      return recent().length >= maxReloads;
    },
    allowReload() {
      if (this.isTripped()) return false;
      return !!hadRecentInteraction();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reload-guard.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reload-guard.js tests/reload-guard.test.js
git commit -m "feat: reload-trap guard with circuit breaker"
```

---

## Task 7: Learner candidate scoring

**Files:**
- Create: `src/lib/learner.js`
- Test: `tests/learner.test.js`

Score how "popup-like" an element is and pick the best guess. Scoring uses inline styles
in jsdom (jsdom does not lay out, so tests rely on inline style + text signals).

- [ ] **Step 1: Write the failing test**

```js
// tests/learner.test.js
import { describe, it, expect } from "vitest";
import { scorePopupCandidate, findBestGuess } from "../src/lib/learner.js";

function el(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe("scorePopupCandidate", () => {
  it("scores fixed + high z-index + wall text higher than plain content", () => {
    const popup = el(`<div style="position:fixed;z-index:9999">Please sign in to continue</div>`);
    const popupScore = scorePopupCandidate(popup);
    const article = el(`<div style="position:static">Just an article paragraph</div>`);
    expect(popupScore).toBeGreaterThan(scorePopupCandidate(article));
  });
});

describe("findBestGuess", () => {
  it("returns the highest-scoring element on the page", () => {
    document.body.innerHTML = `
      <div id="content" style="position:static">article body text</div>
      <div id="gate" style="position:fixed;z-index:5000">Subscribe to read more</div>
    `;
    const guess = findBestGuess(document);
    expect(guess.id).toBe("gate");
  });

  it("returns null when nothing looks like a popup", () => {
    document.body.innerHTML = `<div style="position:static">plain</div>`;
    expect(findBestGuess(document)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/learner.test.js`
Expected: FAIL — cannot find module `../src/lib/learner.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/learner.js
const WALL_TEXT = /sign ?in|log ?in|subscribe|sign ?up|register|cookie|consent|create (an )?account|continue reading/i;
const MIN_SCORE = 3;

export function scorePopupCandidate(el) {
  if (!el || el.nodeType !== 1) return 0;
  const view = el.ownerDocument.defaultView || window;
  const cs = view.getComputedStyle(el);
  let score = 0;

  const pos = el.style.position || cs.position;
  if (pos === "fixed" || pos === "sticky") score += 3;
  if (pos === "absolute") score += 1;

  const z = parseInt(el.style.zIndex || cs.zIndex, 10);
  if (!Number.isNaN(z)) {
    if (z >= 1000) score += 3;
    else if (z > 0) score += 1;
  }

  const filter = el.style.filter || cs.filter || "";
  if (/blur\(/i.test(filter)) score += 1;

  if (WALL_TEXT.test(el.textContent || "")) score += 2;

  return score;
}

export function findBestGuess(doc) {
  let best = null;
  let bestScore = MIN_SCORE - 1;
  for (const el of doc.body.querySelectorAll("*")) {
    const s = scorePopupCandidate(el);
    if (s > bestScore) { bestScore = s; best = el; }
  }
  return bestScore >= MIN_SCORE ? best : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/learner.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/learner.js tests/learner.test.js
git commit -m "feat: learner popup-candidate scoring and best-guess finder"
```

---

## Task 8: Blocker orchestration

**Files:**
- Create: `src/lib/blocker.js`
- Test: `tests/blocker.test.js`

`runBlocker` runs consent → popup → restore passes once over a document. The observer is
wired in `main.js`; here we test the single-pass orchestration with injected dependencies.

- [ ] **Step 1: Write the failing test**

```js
// tests/blocker.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { runBlocker } from "../src/lib/blocker.js";

const lib = {
  version: 1, enabled: true, disabledDomains: [],
  global: [{ type: "class", value: "promo-modal", action: "remove" }],
  domains: {}, whitelist: [],
};

beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("runBlocker", () => {
  it("removes a popup that matches a rule", () => {
    document.body.innerHTML = `<div class="promo-modal">x</div><p id="keep">y</p>`;
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.querySelector(".promo-modal")).toBeNull();
    expect(document.querySelector("#keep")).not.toBeNull();
  });

  it("clicks a reject button when a banner is present", () => {
    let clicked = false;
    document.body.innerHTML = `<div id="onetrust-banner-sdk"><button>Reject all</button></div>`;
    document.querySelector("button").addEventListener("click", () => { clicked = true; });
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(clicked).toBe(true);
  });

  it("restores page scroll lock", () => {
    document.body.style.overflow = "hidden";
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.body.style.overflow).toBe("auto");
  });

  it("does nothing on a disabled domain", () => {
    document.body.innerHTML = `<div class="promo-modal">x</div>`;
    runBlocker({
      doc: document,
      library: { ...lib, disabledDomains: ["site.com"] },
      hostname: "site.com",
    });
    expect(document.querySelector(".promo-modal")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/blocker.test.js`
Expected: FAIL — cannot find module `../src/lib/blocker.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/blocker.js
import { getActiveRules, findMatches, matchesRule } from "./rules.js";
import { restoreElement, restorePage } from "./restore.js";
import { findRejectButton, CMP_SELECTORS } from "./consent.js";

function isWhitelisted(el, whitelist) {
  return (whitelist || []).some((rule) => matchesRule(el, rule));
}

function consentPass(doc) {
  for (const sel of CMP_SELECTORS) {
    let banner;
    try { banner = doc.querySelector(sel); } catch { banner = null; }
    if (!banner) continue;
    const reject = findRejectButton(banner);
    if (reject) { safe(() => reject.click()); return; }
    safe(() => banner.remove());
  }
}

function popupPass(doc, rules, whitelist) {
  const matches = findMatches(doc.body, rules);
  for (const el of matches) {
    if (isWhitelisted(el, whitelist)) continue;
    safe(() => el.remove());
  }
}

function restorePass(doc, rules, whitelist) {
  restorePage(doc);
  for (const el of doc.body.querySelectorAll("*")) {
    if (isWhitelisted(el, whitelist)) continue;
    const style = el.getAttribute && el.getAttribute("style");
    if (style && /blur\(|pointer-events\s*:\s*none|opacity\s*:\s*0/i.test(style)) {
      safe(() => restoreElement(el));
    }
  }
}

export function runBlocker({ doc, library, hostname }) {
  if (!library.enabled) return;
  if ((library.disabledDomains || []).includes(hostname)) return;
  const rules = getActiveRules(library, hostname);
  safe(() => consentPass(doc));
  safe(() => popupPass(doc, rules, library.whitelist));
  safe(() => restorePass(doc, rules, library.whitelist));
}

function safe(fn) {
  try { fn(); } catch { /* never let one failure break the page */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/blocker.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: All test files pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/blocker.js tests/blocker.test.js
git commit -m "feat: blocker orchestration (consent, popup, restore passes)"
```

---

## Task 9: UI module (toolbar, manage panel, badge)

**Files:**
- Create: `src/lib/ui.js`
- Test: `tests/ui.test.js`

DOM-building helpers for the learner toolbar, the status badge, and the manage panel.
Kept free of `GM_*`; callbacks are injected so they are testable in jsdom.

- [ ] **Step 1: Write the failing test**

```js
// tests/ui.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createBadge, createLearnerToolbar, createManagePanel } from "../src/lib/ui.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createBadge", () => {
  it("shows enabled/disabled state and toggles on click", () => {
    const onToggle = vi.fn();
    const badge = createBadge({ enabled: true, onToggle });
    document.body.appendChild(badge);
    expect(badge.textContent).toMatch(/on/i);
    badge.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("createLearnerToolbar", () => {
  it("wires confirm / pick / cancel buttons", () => {
    const onConfirm = vi.fn(), onPick = vi.fn(), onCancel = vi.fn();
    const bar = createLearnerToolbar({ onConfirm, onPick, onCancel });
    document.body.appendChild(bar);
    bar.querySelector("[data-act='confirm']").click();
    bar.querySelector("[data-act='pick']").click();
    bar.querySelector("[data-act='cancel']").click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("createManagePanel", () => {
  it("lists rules and fires delete/promote callbacks", () => {
    const onDelete = vi.fn(), onPromote = vi.fn();
    const lib = {
      global: [{ type: "class", value: "g1", action: "remove" }],
      domains: { "site.com": { rules: [{ type: "id", value: "d1", action: "hide" }] } },
    };
    const panel = createManagePanel({ library: lib, hostname: "site.com", onDelete, onPromote });
    document.body.appendChild(panel);
    expect(panel.textContent).toContain("g1");
    expect(panel.textContent).toContain("d1");
    panel.querySelector("[data-act='delete']").click();
    expect(onDelete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui.test.js`
Expected: FAIL — cannot find module `../src/lib/ui.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/ui.js
const PREFIX = "pz-";

function tag(name, props = {}, children = []) {
  const el = document.createElement(name);
  Object.assign(el, props);
  for (const c of children) el.appendChild(c);
  return el;
}

export function createBadge({ enabled, onToggle }) {
  const badge = tag("button", {
    className: PREFIX + "badge",
    textContent: enabled ? "Zapper: ON" : "Zapper: OFF",
    title: "Toggle Popup Zapper on this site",
  });
  badge.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:2147483647;" +
    "padding:4px 8px;font:12px sans-serif;border:0;border-radius:6px;" +
    "color:#fff;cursor:pointer;opacity:.6;background:" +
    (enabled ? "#2e7d32" : "#9e9e9e");
  badge.addEventListener("click", onToggle);
  return badge;
}

export function createLearnerToolbar({ onConfirm, onPick, onCancel }) {
  const mk = (act, label) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText = "margin:0 4px;padding:4px 8px;font:12px sans-serif;cursor:pointer;";
    return b;
  };
  const bar = tag("div", { className: PREFIX + "toolbar" }, [
    tag("span", { textContent: "Popup? " }),
    mk("confirm", "✓ Yes"),
    mk("pick", "Click the right one"),
    mk("cancel", "Cancel"),
  ]);
  bar.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);" +
    "z-index:2147483647;background:#222;color:#fff;padding:8px 12px;" +
    "border-radius:8px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);";
  bar.querySelector("[data-act='confirm']").addEventListener("click", onConfirm);
  bar.querySelector("[data-act='pick']").addEventListener("click", onPick);
  bar.querySelector("[data-act='cancel']").addEventListener("click", onCancel);
  return bar;
}

export function createManagePanel({ library, hostname, onDelete, onPromote }) {
  const panel = tag("div", { className: PREFIX + "panel" });
  panel.style.cssText =
    "position:fixed;top:40px;right:12px;z-index:2147483647;background:#fff;" +
    "color:#111;padding:12px;border-radius:8px;font:13px sans-serif;" +
    "max-height:70vh;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.3);min-width:280px;";

  const rows = [];
  const addRow = (rule, scope) => {
    const row = tag("div");
    row.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";
    row.appendChild(tag("span", {
      textContent: `[${scope}] ${rule.type}: ${rule.value}`,
      style: "flex:1",
    }));
    const del = tag("button", { textContent: "Delete" });
    del.setAttribute("data-act", "delete");
    del.addEventListener("click", () => onDelete({ rule, scope }));
    row.appendChild(del);
    if (scope === "site") {
      const prom = tag("button", { textContent: "Make global" });
      prom.setAttribute("data-act", "promote");
      prom.addEventListener("click", () => onPromote({ rule }));
      row.appendChild(prom);
    }
    rows.push(row);
  };

  panel.appendChild(tag("strong", { textContent: "Popup Zapper rules" }));
  for (const r of library.global || []) addRow(r, "global");
  const dom = (library.domains || {})[hostname];
  for (const r of (dom && dom.rules) || []) addRow(r, "site");
  for (const row of rows) panel.appendChild(row);
  return panel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui.js tests/ui.test.js
git commit -m "feat: UI helpers for badge, learner toolbar, manage panel"
```

---

## Task 10: Userscript header + main glue

**Files:**
- Create: `src/userscript-header.js`
- Create: `src/main.js`

`main.js` is the browser entry point: it wires GM storage, hotkeys, the reload guard,
the blocker observer, and the learner flow. It is exercised by the manual checklist in
Task 12 (GM APIs and live DOM events are not unit-tested).

- [ ] **Step 1: Create the userscript header**

```js
// src/userscript-header.js
export const HEADER = `// ==UserScript==
// @name         Popup Zapper
// @namespace    https://github.com/param/popup-zapper
// @version      1.0.0
// @description  Remove login/consent/newsletter/paywall popups, restore blurred content, defeat reload traps, and learn new popups by click.
// @author       Param
// @match        *://*/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==
`;
```

- [ ] **Step 2: Create `src/main.js`**

```js
// src/main.js
import { loadLibrary, saveLibrary } from "./lib/storage.js";
import { runBlocker } from "./lib/blocker.js";
import { createReloadGuard } from "./lib/reload-guard.js";
import { findBestGuess } from "./lib/learner.js";
import { extractKeywords } from "./lib/extract.js";
import { detectDegradation } from "./lib/restore.js";
import { createBadge, createLearnerToolbar, createManagePanel } from "./lib/ui.js";

const getV = (k) => GM_getValue(k);
const setV = (k, v) => GM_setValue(k, v);
const hostname = location.hostname.replace(/^www\./, "");

let library = loadLibrary(getV);
const persist = () => saveLibrary(setV, library);

// ---- interaction tracking for the reload guard ----
let lastInteraction = 0;
for (const ev of ["click", "keydown", "submit", "pointerdown"]) {
  window.addEventListener(ev, () => { lastInteraction = Date.now(); }, true);
}
const guard = createReloadGuard({
  now: () => Date.now(),
  sessionStorage: window.sessionStorage,
  hadRecentInteraction: () => Date.now() - lastInteraction < 1500,
});

// ---- reload-trap defense (install before page scripts run) ----
function installReloadDefense() {
  guard.recordReload(); // count this load
  const origReload = Location.prototype.reload;
  try {
    Location.prototype.reload = function (...args) {
      if (guard.allowReload()) return origReload.apply(this, args);
    };
  } catch { /* some browsers lock this; ignore */ }

  const origAssign = Location.prototype.assign;
  Location.prototype.assign = function (url) {
    if (guard.allowReload()) return origAssign.call(this, url);
  };
  const origReplace = Location.prototype.replace;
  Location.prototype.replace = function (url) {
    if (guard.allowReload()) return origReplace.call(this, url);
  };

  // strip meta refresh as soon as the head exists
  const stripMeta = () => {
    document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove());
  };
  document.addEventListener("DOMContentLoaded", stripMeta, { once: true });
}

// ---- blocker engine ----
function runOnce() { runBlocker({ doc: document, library, hostname }); }

function startObserver() {
  let pending = false;
  const obs = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; runOnce(); });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// ---- learner engine ----
let learnerActive = false;
function startLearner() {
  if (learnerActive) return;
  learnerActive = true;
  let guess = findBestGuess(document);
  let outline = null;
  const highlight = (el) => {
    if (outline) outline.style.outline = "";
    outline = el;
    if (el) el.style.outline = "3px solid red";
  };
  highlight(guess);

  const cleanup = () => {
    learnerActive = false;
    if (outline) outline.style.outline = "";
    toolbar.remove();
    document.removeEventListener("click", onPick, true);
  };

  const saveFrom = (el) => {
    if (!el) return cleanup();
    const kws = extractKeywords(el);
    if (kws.length) {
      const dom = (library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} });
      dom.rules.push(...kws);
      const deg = detectDegradation(el);
      dom.restore = { ...dom.restore, ...deg };
      persist();
      runOnce();
    }
    cleanup();
  };

  const onPick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    saveFrom(e.target);
  };

  const toolbar = createLearnerToolbar({
    onConfirm: () => saveFrom(guess),
    onPick: () => { document.addEventListener("click", onPick, true); },
    onCancel: cleanup,
  });
  document.body.appendChild(toolbar);
}

// ---- manage panel ----
let panel = null;
function toggleManage() {
  if (panel) { panel.remove(); panel = null; return; }
  panel = createManagePanel({
    library, hostname,
    onDelete: ({ rule, scope }) => {
      if (scope === "global") {
        library.global = library.global.filter((r) => r !== rule);
      } else {
        const dom = library.domains[hostname];
        if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
      }
      persist(); panel.remove(); panel = null; toggleManage();
    },
    onPromote: ({ rule }) => {
      const dom = library.domains[hostname];
      if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
      library.global.push(rule);
      persist(); panel.remove(); panel = null; toggleManage();
    },
  });
  document.body.appendChild(panel);
}

// ---- master toggle ----
function toggleSite() {
  const i = library.disabledDomains.indexOf(hostname);
  if (i >= 0) library.disabledDomains.splice(i, 1);
  else library.disabledDomains.push(hostname);
  persist();
  refreshBadge();
}

let badge = null;
function refreshBadge() {
  if (badge) badge.remove();
  badge = createBadge({
    enabled: !library.disabledDomains.includes(hostname),
    onToggle: toggleSite,
  });
  document.body.appendChild(badge);
}

// ---- hotkeys ----
window.addEventListener("keydown", (e) => {
  if (!e.altKey || !e.shiftKey) return;
  const k = e.key.toLowerCase();
  if (k === "p") { e.preventDefault(); startLearner(); }
  else if (k === "m") { e.preventDefault(); toggleManage(); }
  else if (k === "z") { e.preventDefault(); toggleSite(); }
}, true);

// ---- GM menu commands (fallback for hotkeys) ----
try {
  GM_registerMenuCommand("Learn a popup (Alt+Shift+P)", startLearner);
  GM_registerMenuCommand("Manage rules (Alt+Shift+M)", toggleManage);
  GM_registerMenuCommand("Toggle on this site (Alt+Shift+Z)", toggleSite);
} catch { /* not available in all managers */ }

// ---- boot ----
installReloadDefense();
function boot() {
  runOnce();
  startObserver();
  refreshBadge();
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
```

- [ ] **Step 3: Commit**

```bash
git add src/userscript-header.js src/main.js
git commit -m "feat: userscript entry point (GM glue, hotkeys, engines)"
```

---

## Task 11: Build script

**Files:**
- Create: `build.js`

Bundle `src/main.js` into a single IIFE with the userscript header prepended.

- [ ] **Step 1: Create `build.js`**

```js
// build.js
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HEADER } from "./src/userscript-header.js";

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
writeFileSync("dist/popup-zapper.user.js", HEADER + "\n" + body);
console.log("Built dist/popup-zapper.user.js");
```

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: Console prints "Built dist/popup-zapper.user.js"; the file exists and starts
with `// ==UserScript==`.

- [ ] **Step 3: Verify the header is present**

Run: `head -n 3 dist/popup-zapper.user.js`
Expected: First line is `// ==UserScript==`.

- [ ] **Step 4: Run the full test suite once more**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add build.js
git commit -m "build: esbuild bundle into single .user.js with header"
```

---

## Task 12: Install + manual verification

**Files:**
- Create: `README.md`

No code — install the script in Brave and verify against real sites.

- [ ] **Step 1: Write `README.md`**

````markdown
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
````

- [ ] **Step 2: Build and install**

Run: `npm run build`, then load `dist/popup-zapper.user.js` into Violentmonkey in Brave.
Expected: Violentmonkey lists "Popup Zapper" as enabled.

- [ ] **Step 3: Manual checklist — record pass/fail for each**

- [ ] ArchDaily article: image de-blurs and the sign-in wall is gone after load.
- [ ] A cookie-banner site (e.g. one using OneTrust): banner auto-rejects or disappears, page scroll works.
- [ ] A newsletter-popup site: promo modal is removed; if not, `Alt+Shift+P`, confirm/click the modal, and verify it is gone now and on reload.
- [ ] A reload-trap/anti-adblock site: page stops auto-reloading; badge shows the zapper is on.
- [ ] `Alt+Shift+M`: learned rules appear; delete one and confirm it returns; promote a site rule to global.
- [ ] `Alt+Shift+Z`: disables the zapper on the current site (reload to confirm popups return).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with install, hotkeys, and manual test checklist"
```

---

## Task 13: Post-consent tracker cleanup (off by default)

**Files:**
- Create: `src/lib/cleanup.js`
- Test: `tests/cleanup.test.js`
- Modify: `src/lib/blocker.js` (call cleanup from the consent pass when enabled)
- Modify: `src/main.js` (hotkey + menu command to toggle per-site cleanup)

A thin complement to Brave Shields / uBlock: after consent is dismissed, delete known
analytics cookies + storage keys and neutralize `navigator.sendBeacon`. Gated per-site by
`library.domains[host].cleanup === true`; default off.

- [ ] **Step 1: Write the failing test**

```js
// tests/cleanup.test.js
import { describe, it, expect } from "vitest";
import { ANALYTICS_KEYS, clearTrackingStorage, neutralizeBeacon } from "../src/lib/cleanup.js";

describe("clearTrackingStorage", () => {
  it("removes known analytics keys from a storage-like object", () => {
    const store = { _ga: "1", keepme: "2", _gid: "3" };
    const storage = {
      key: (i) => Object.keys(store)[i],
      get length() { return Object.keys(store).length; },
      removeItem: (k) => { delete store[k]; },
    };
    clearTrackingStorage(storage);
    expect(store).toEqual({ keepme: "2" });
  });

  it("exposes a default analytics key list", () => {
    expect(ANALYTICS_KEYS.some((re) => re.test("_ga"))).toBe(true);
  });
});

describe("neutralizeBeacon", () => {
  it("replaces sendBeacon with a no-op returning true", () => {
    const nav = { sendBeacon: () => { throw new Error("should not run"); } };
    neutralizeBeacon(nav);
    expect(nav.sendBeacon("url", "data")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cleanup.test.js`
Expected: FAIL — cannot find module `../src/lib/cleanup.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/cleanup.js
export const ANALYTICS_KEYS = [
  /^_ga/, /^_gid/, /^_gat/, /^__utm/, /^_fbp$/, /^_fbc$/,
  /^_hj/, /^amplitude/, /^mp_/, /^ajs_/, /^optimizely/,
];

function isTrackingKey(key) {
  return ANALYTICS_KEYS.some((re) => re.test(key));
}

export function clearTrackingStorage(storage) {
  if (!storage) return;
  const doomed = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isTrackingKey(k)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
}

export function clearTrackingCookies(doc) {
  if (!doc || !doc.cookie) return;
  for (const pair of doc.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (name && isTrackingKey(name)) {
      doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  }
}

export function neutralizeBeacon(nav) {
  if (!nav) return;
  try { nav.sendBeacon = () => true; } catch { /* read-only in some envs */ }
}

export function runCleanup(doc, win) {
  clearTrackingCookies(doc);
  if (win) {
    clearTrackingStorage(win.localStorage);
    clearTrackingStorage(win.sessionStorage);
    neutralizeBeacon(win.navigator);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cleanup.test.js`
Expected: PASS.

- [ ] **Step 5: Wire cleanup into the blocker (modify `src/lib/blocker.js`)**

Add the import at the top, next to the other `./` imports:

```js
import { runCleanup } from "./cleanup.js";
```

Then in `runBlocker`, after the consent pass, add the gated cleanup call so the final
body reads:

```js
export function runBlocker({ doc, library, hostname }) {
  if (!library.enabled) return;
  if ((library.disabledDomains || []).includes(hostname)) return;
  const rules = getActiveRules(library, hostname);
  safe(() => consentPass(doc));
  const domain = (library.domains || {})[hostname];
  if (domain && domain.cleanup) {
    safe(() => runCleanup(doc, doc.defaultView));
  }
  safe(() => popupPass(doc, rules, library.whitelist));
  safe(() => restorePass(doc, rules, library.whitelist));
}
```

- [ ] **Step 6: Update the blocker test to cover the gated cleanup (modify `tests/blocker.test.js`)**

Append this test inside the `describe("runBlocker", ...)` block:

```js
it("clears tracking cookies only when cleanup is enabled for the domain", () => {
  document.cookie = "_ga=abc;path=/";
  const cleanupLib = {
    ...lib,
    domains: { "site.com": { rules: [], cleanup: true } },
  };
  runBlocker({ doc: document, library: cleanupLib, hostname: "site.com" });
  expect(document.cookie).not.toMatch(/_ga=/);
});
```

Run: `npx vitest run tests/blocker.test.js`
Expected: PASS (existing tests plus the new one).

- [ ] **Step 7: Add a per-site cleanup toggle (modify `src/main.js`)**

Add this function near `toggleSite`:

```js
function toggleCleanup() {
  const dom = (library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} });
  dom.cleanup = !dom.cleanup;
  persist();
  runOnce();
}
```

Add a hotkey branch inside the existing `keydown` handler (alongside `p`/`m`/`z`):

```js
  else if (k === "c") { e.preventDefault(); toggleCleanup(); }
```

Add a menu command alongside the others:

```js
  GM_registerMenuCommand("Toggle tracker cleanup here (Alt+Shift+C)", toggleCleanup);
```

- [ ] **Step 8: Rebuild and run the full suite**

Run: `npm run build && npm test`
Expected: Build succeeds; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cleanup.js tests/cleanup.test.js src/lib/blocker.js tests/blocker.test.js src/main.js
git commit -m "feat: optional post-consent tracker cleanup (off by default)"
```

---

## Notes for the implementer

- **TDD order matters:** write the test, watch it fail, implement, watch it pass, commit.
- **jsdom limits:** it does not lay out elements, so scoring/restore tests rely on inline
  styles and `getComputedStyle` of inline values — do not add tests that depend on real
  geometry (`getBoundingClientRect` returns zeros in jsdom).
- **`safe()` wrapping:** every pass in the blocker is wrapped so a single bad selector can
  never break the host page. Preserve this when extending.
- **Out of scope (Phase 2):** burner credentials — see
  `2026-06-14-burner-credentials-design.md`.