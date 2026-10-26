// ==UserScript==
// @name         Popup Zapper
// @namespace    https://github.com/EJR-of-Scrutopia/popup-zapper
// @version      2.4.0
// @description  Remove login/consent/newsletter/paywall popups, reveal blurred/gated content, defeat reload traps, learn popups by click, click many checkboxes or buttons in batches, and record one item's clicks to repeat for every item in a list.
// @author       Param
// @homepageURL  https://github.com/EJR-of-Scrutopia/popup-zapper
// @supportURL   https://github.com/EJR-of-Scrutopia/popup-zapper/issues
// @updateURL    https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js
// @downloadURL  https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js
// @match        *://*/*
// @run-at       document-start
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
// @grant        unsafeWindow
// @grant        window.close
// @grant        window.focus
// @connect      *
// @noframes
// ==/UserScript==

(() => {
  // src/lib/storage.js
  var SCHEMA_VERSION = 1;
  var DEFAULT_LIBRARY = {
    version: SCHEMA_VERSION,
    enabled: true,
    disabledDomains: [],
    global: [],
    domains: {},
    whitelist: []
  };
  function parseLibrary(raw) {
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
  async function loadLibraryAsync(getValueAsync) {
    let raw;
    try {
      raw = await getValueAsync("popupZapper.library");
    } catch {
      return clone(DEFAULT_LIBRARY);
    }
    return parseLibrary(raw);
  }
  function saveLibrary(setValue, library2) {
    setValue("popupZapper.library", JSON.stringify(library2));
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // src/lib/gm.js
  function createGm(env = globalThis) {
    const has = (name) => typeof env[name] === "function";
    const gmNs = env.GM && typeof env.GM === "object" ? env.GM : null;
    async function get(key, dflt) {
      if (gmNs && typeof gmNs.getValue === "function") return gmNs.getValue(key, dflt);
      if (has("GM_getValue")) {
        const v = env.GM_getValue(key);
        return v === void 0 ? dflt : v;
      }
      if (env.localStorage) {
        const v = env.localStorage.getItem(key);
        return v === null || v === void 0 ? dflt : v;
      }
      return dflt;
    }
    async function set(key, val) {
      if (gmNs && typeof gmNs.setValue === "function") return void await gmNs.setValue(key, val);
      if (has("GM_setValue")) return void env.GM_setValue(key, val);
      if (env.localStorage) return void env.localStorage.setItem(key, val);
    }
    function getNow(key) {
      return has("GM_getValue") ? env.GM_getValue(key) : void 0;
    }
    function setNow(key, val) {
      if (has("GM_setValue")) {
        env.GM_setValue(key, val);
        return true;
      }
      set(key, val);
      return false;
    }
    function xhr(details) {
      if (has("GM_xmlhttpRequest")) return env.GM_xmlhttpRequest(details);
      if (gmNs && typeof gmNs.xmlHttpRequest === "function") return gmNs.xmlHttpRequest(details);
      if (typeof env.fetch === "function") {
        env.fetch(details.url, { method: details.method || "GET" }).then((r) => r.text().then((t) => details.onload && details.onload({ responseText: t, status: r.status }))).catch(() => details.onerror && details.onerror());
      } else if (details.onerror) details.onerror();
    }
    async function clipboard(text) {
      if (has("GM_setClipboard")) return void env.GM_setClipboard(text);
      if (gmNs && typeof gmNs.setClipboard === "function") return void await gmNs.setClipboard(text);
      if (env.navigator && env.navigator.clipboard) return env.navigator.clipboard.writeText(text);
    }
    function openTab(url) {
      if (has("GM_openInTab")) return env.GM_openInTab(url, { active: true });
      if (gmNs && typeof gmNs.openInTab === "function") return void gmNs.openInTab(url, false);
      if (typeof env.open === "function") {
        const w = env.open(url, "_blank");
        if (!w && env.location) env.location.href = url;
        return;
      }
      if (env.location) env.location.href = url;
    }
    return { get, set, getNow, setNow, xhr, clipboard, openTab };
  }

  // src/lib/rules.js
  function matchesRule(el, rule) {
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
        try {
          return el.matches(rule.value);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }
  function getActiveRules(library2, hostname2) {
    if (!library2.enabled) return [];
    if ((library2.disabledDomains || []).includes(hostname2)) return [];
    const enabled = (r) => r.enabled !== false;
    const global = (library2.global || []).filter(enabled);
    const domain = (((library2.domains || {})[hostname2] || {}).rules || []).filter(enabled);
    return [...global, ...domain];
  }
  function findMatches(root, rules) {
    const out = [];
    const all = root.querySelectorAll("*");
    for (const el of all) {
      for (const rule of rules) {
        if (matchesRule(el, rule)) {
          out.push(el);
          break;
        }
      }
    }
    return out;
  }

  // src/lib/restore.js
  function restoreBlur(doc, isWhitelisted2) {
    const win = doc.defaultView || window;
    let count = 0;
    for (const el of doc.body.querySelectorAll("*")) {
      if (isWhitelisted2 && isWhitelisted2(el)) continue;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      const f = cs.filter || "";
      const b = cs.backdropFilter || cs.webkitBackdropFilter || "";
      if (/blur\(/i.test(f) || /blur\(/i.test(b)) {
        el.style.setProperty("filter", "none", "important");
        el.style.setProperty("backdrop-filter", "none", "important");
        el.style.setProperty("-webkit-backdrop-filter", "none", "important");
        count++;
      }
    }
    return count;
  }
  function overflowY(cs) {
    return cs.overflowY || (cs.overflow || "").trim().split(/\s+/).pop() || "";
  }
  function restorePage(doc) {
    const win = doc.defaultView || window;
    for (const node of [doc.documentElement, doc.body]) {
      if (!node) continue;
      let cs;
      try {
        cs = win.getComputedStyle(node);
      } catch {
        continue;
      }
      const hidden = /^(hidden|clip)$/.test(overflowY(cs));
      const fixed = node === doc.body && cs.position === "fixed";
      if (hidden) node.style.setProperty("overflow", "visible", "important");
      if (fixed) node.style.setProperty("position", "static", "important");
      if (hidden || fixed) node.style.removeProperty("height");
    }
  }

  // src/lib/paywall-veil.js
  var VENDOR_SEL = [
    '[class*="piano-meter" i]',
    '[class*="tp-modal" i]',
    '[class*="tp-backdrop" i]',
    '[class*="poool" i]',
    '[class*="pelcro" i]',
    '[class*="zephr" i]',
    '[class*="paywall" i]',
    '[class*="regwall" i]'
  ].join(",");
  function safeMatches(el, sel) {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  }
  function isVeilOverlay(el, win) {
    if (!el || el.nodeType !== 1) return false;
    let cs;
    try {
      cs = win.getComputedStyle(el);
    } catch {
      return false;
    }
    if (cs.position !== "fixed") return false;
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      rect = null;
    }
    const vw = win.innerWidth || 1024, vh = win.innerHeight || 768;
    if (rect && rect.width * rect.height > 0) {
      if (rect.width < vw * 0.9 || rect.height < vh * 0.9) return false;
    }
    if (safeMatches(el, VENDOR_SEL)) return true;
    const z = parseInt(cs.zIndex, 10);
    const highZ = !Number.isNaN(z) && z >= 1e3;
    const rawStyle = el.getAttribute && el.getAttribute("style") || "";
    const blur = /blur\(/i.test(cs.backdropFilter || cs.webkitBackdropFilter || "") || /blur\(/i.test(cs.filter || "") || /blur\(/i.test(rawStyle);
    return highZ && blur;
  }
  function removeVeils(doc, skip2) {
    const win = doc.defaultView || window;
    const removed = [];
    for (const el of doc.body.querySelectorAll("div,section,aside")) {
      if (skip2 && skip2(el)) continue;
      if (!isVeilOverlay(el, win)) continue;
      const label = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : el.tagName.toLowerCase();
      try {
        el.remove();
        removed.push(label);
      } catch {
      }
    }
    return removed;
  }

  // src/lib/consent.js
  var CMP_SELECTORS = [
    "#onetrust-banner-sdk",
    ".qc-cmp2-container",
    "#CybotCookiebotDialog",
    "#usercentrics-root",
    ".cc-window",
    "[id*='cookie' i][class*='banner' i]"
  ];
  var REJECT_PATTERNS = [
    /reject all/i,
    /reject/i,
    /decline/i,
    /refuse/i,
    /necessary only/i,
    /only necessary/i,
    /essential only/i,
    /do not (accept|consent)/i,
    /deny/i
  ];
  var CLICKABLE = "button, a, [role='button'], input[type='button'], input[type='submit']";
  function findRejectButton(root) {
    if (!root) return null;
    const candidates = root.matches && root.matches(CLICKABLE) ? [root, ...root.querySelectorAll(CLICKABLE)] : [...root.querySelectorAll(CLICKABLE)];
    for (const node of candidates) {
      const label = (node.textContent || node.value || "").trim();
      if (!label) continue;
      if (REJECT_PATTERNS.some((re) => re.test(label))) return node;
    }
    return null;
  }

  // src/lib/learner.js
  var WALL_TEXT = /sign ?in|log ?in|subscribe|sign ?up|register|cookie|consent|create (an )?account|continue reading/i;
  var MIN_SCORE = 3;
  var EXT_ROOTS = /protonpass|1password|onepassword|bitwarden|lastpass|dashlane|grammarly|honey-|metamask|__crx/i;
  var CHROME_SEL = "header,nav,footer,[role=banner],[role=navigation],[role=contentinfo]";
  function scorePopupCandidate(el) {
    if (!el || el.nodeType !== 1) return 0;
    const view = el.ownerDocument.defaultView || window;
    const cs = view.getComputedStyle(el);
    let score = 0;
    const pos = el.style.position || cs.position;
    if (pos === "fixed" || pos === "sticky") score += 3;
    if (pos === "absolute") score += 1;
    const z = parseInt(el.style.zIndex || cs.zIndex, 10);
    if (!Number.isNaN(z)) {
      if (z >= 1e3) score += 3;
      else if (z > 0) score += 1;
    }
    const filter = el.style.filter || cs.filter || "";
    if (/blur\(/i.test(filter)) score += 1;
    if (WALL_TEXT.test(el.textContent || "")) score += 2;
    return score;
  }
  function isVisible(el, win) {
    let cs;
    try {
      cs = win.getComputedStyle(el);
    } catch {
      return true;
    }
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (parseFloat(cs.opacity || "1") < 0.05) return false;
    return true;
  }
  function isWallSized(el, win) {
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      return true;
    }
    const area = rect.width * rect.height;
    if (area <= 0) return true;
    const vw = win.innerWidth || 1024;
    const vh = win.innerHeight || 768;
    return area >= vw * vh * 0.12;
  }
  function findBestGuess(doc, opts = {}) {
    const requireText = !!opts.requireText;
    const win = doc.defaultView || window;
    let best = null;
    let bestScore = MIN_SCORE - 1;
    for (const el of doc.body.querySelectorAll("*")) {
      if (el.closest && el.closest("[data-pz]")) continue;
      if (el.id && EXT_ROOTS.test(el.id)) continue;
      if (el.closest && el.closest(CHROME_SEL)) continue;
      if (!isVisible(el, win)) continue;
      if (requireText) {
        const text = (el.textContent || "").trim();
        if (!text || text.length > 800 || !WALL_TEXT.test(text)) continue;
        if (!isWallSized(el, win)) continue;
      }
      const s = scorePopupCandidate(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return bestScore >= MIN_SCORE ? best : null;
  }

  // src/lib/frames.js
  var PAYWALL_FRAME_HOSTS = [
    /(^|\.|\/)piano\.io/i,
    /tinypass\.com/i,
    /poool\.(fr|tech)/i,
    /qiota\./i,
    /leakypaywall/i,
    /pelcro\./i
  ];
  var OVERLAY_SEL = [
    '[class*="piano" i]',
    '[class*="paywall" i]',
    '[class*="gate" i]',
    '[class*="overlay" i]',
    '[class*="modal" i]',
    '[id*="piano" i]',
    '[id*="paywall" i]'
  ].join(",");
  function removePaywallFrames(doc) {
    const removed = [];
    for (const frame of doc.querySelectorAll("iframe")) {
      const src = frame.getAttribute("src") || "";
      if (!PAYWALL_FRAME_HOSTS.some((re) => re.test(src))) continue;
      let target = frame;
      try {
        target = frame.closest(OVERLAY_SEL) || frame.parentElement || frame;
      } catch {
      }
      const label = target.className && typeof target.className === "string" ? `.${target.className.trim().split(/\s+/).slice(0, 2).join(".")}` : target.tagName.toLowerCase();
      try {
        target.remove();
        removed.push(label);
      } catch {
        try {
          frame.remove();
          removed.push("iframe");
        } catch {
        }
      }
    }
    return removed;
  }

  // src/lib/cleanup.js
  var ANALYTICS_KEYS = [
    /^_ga/,
    /^_gid/,
    /^_gat/,
    /^__utm/,
    /^_fbp$/,
    /^_fbc$/,
    /^_hj/,
    /^amplitude/,
    /^mp_/,
    /^ajs_/,
    /^optimizely/
  ];
  function isTrackingKey(key) {
    return ANALYTICS_KEYS.some((re) => re.test(key));
  }
  function clearTrackingStorage(storage) {
    if (!storage) return;
    const doomed = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && isTrackingKey(k)) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
  }
  function clearTrackingCookies(doc) {
    if (!doc || !doc.cookie) return;
    for (const pair of doc.cookie.split(";")) {
      const name = pair.split("=")[0].trim();
      if (name && isTrackingKey(name)) {
        doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    }
  }
  function neutralizeBeacon(nav) {
    if (!nav) return;
    try {
      nav.sendBeacon = () => true;
    } catch {
    }
  }
  function runCleanup(doc, win) {
    clearTrackingCookies(doc);
    if (win) {
      clearTrackingStorage(win.localStorage);
      clearTrackingStorage(win.sessionStorage);
      neutralizeBeacon(win.navigator);
    }
  }

  // src/lib/blocker.js
  function isWhitelisted(el, whitelist) {
    return (whitelist || []).some((rule) => matchesRule(el, rule));
  }
  function isOwnUI(el) {
    return !!(el.closest && el.closest("[data-pz]"));
  }
  function skip(el, whitelist) {
    return isOwnUI(el) || isWhitelisted(el, whitelist);
  }
  function describe(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList && el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }
  function consentPass(doc, log) {
    for (const sel of CMP_SELECTORS) {
      let banner;
      try {
        banner = doc.querySelector(sel);
      } catch {
        banner = null;
      }
      if (!banner) continue;
      const reject = findRejectButton(banner);
      if (reject) {
        safe(() => reject.click());
        log("consent", `clicked reject in ${describe(banner)}`);
        return;
      }
      safe(() => banner.remove());
      log("consent", `hid banner ${describe(banner)}`);
    }
  }
  function popupPass(doc, rules, whitelist, log) {
    const matches = findMatches(doc.body, rules);
    for (const el of matches) {
      if (skip(el, whitelist)) continue;
      const desc = describe(el);
      safe(() => el.remove());
      log("popup", `removed ${desc} (matched rule)`);
    }
  }
  function autozapPass(doc, whitelist, log) {
    const guess = findBestGuess(doc, { requireText: true });
    if (!guess) return;
    if (skip(guess, whitelist)) return;
    const desc = describe(guess);
    safe(() => guess.remove());
    log("autozap", `auto-removed ${desc}`);
  }
  var GATE_TEXT = /register|sign ?up|create (a )?(free )?account|continue reading|keep reading|to continue|unlock( this)? (article|content)|to read (the|this|more)|log ?in to (read|view|continue)|free account to/i;
  function unlockContent(doc, whitelist, log) {
    const win = doc.defaultView || window;
    let changes = 0;
    for (const el of doc.body.querySelectorAll("div,section,aside,dialog,form")) {
      if (skip(el, whitelist)) continue;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      if (!/^(fixed|absolute|sticky)$/.test(cs.position)) continue;
      const text = (el.textContent || "").trim();
      if (text.length > 0 && text.length < 600 && GATE_TEXT.test(text)) {
        safe(() => el.remove());
        changes++;
      }
    }
    if (changes) log("unlock", `unlocked gated content (${changes} change(s))`);
  }
  function restorePass(doc, whitelist, log) {
    restorePage(doc);
    const veils = safeVal(() => removeVeils(doc, (el) => skip(el, whitelist)), []);
    if (veils.length) log("paywall", `removed ${veils.length} veil overlay(s): ${veils.join(", ")}`);
    const n = safeVal(() => restoreBlur(doc, (el) => skip(el, whitelist)), 0);
    if (n) log("deblur", `removed blur from ${n} element(s)`);
  }
  function runBlocker({ doc, library: library2, hostname: hostname2, log = () => {
  } }) {
    if (!library2.enabled) return;
    if ((library2.disabledDomains || []).includes(hostname2)) return;
    const rules = getActiveRules(library2, hostname2);
    const domain = (library2.domains || {})[hostname2];
    safe(() => consentPass(doc, log));
    const frames = safeVal(() => removePaywallFrames(doc), []);
    if (frames.length) log("paywall", `removed ${frames.length} paywall overlay(s): ${frames.join(", ")}`);
    if (domain && domain.cleanup) {
      safe(() => runCleanup(doc, doc.defaultView));
      log("cleanup", "cleared tracking cookies/storage");
    }
    safe(() => popupPass(doc, rules, library2.whitelist, log));
    if (domain && domain.autozap) {
      safe(() => autozapPass(doc, library2.whitelist, log));
      safe(() => unlockContent(doc, library2.whitelist, log));
    }
    safe(() => restorePass(doc, library2.whitelist, log));
  }
  function safe(fn) {
    try {
      fn();
    } catch {
    }
  }
  function safeVal(fn, fallback) {
    try {
      return fn();
    } catch {
      return fallback;
    }
  }

  // src/lib/reload-guard.js
  var KEY = "popupZapper.reloads";
  function createReloadGuard({
    now,
    sessionStorage,
    hadRecentInteraction,
    maxReloads = 3,
    windowMs = 5e3
  }) {
    function readStamps() {
      try {
        return JSON.parse(sessionStorage.getItem(KEY) || "[]");
      } catch {
        return [];
      }
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
      }
    };
  }

  // src/lib/extract.js
  var MAX_TEXT_LEN = 40;
  function isHashedToken(token) {
    if (!token || token.length < 4) return false;
    if (/^_[a-z0-9]{4,}$/i.test(token)) return true;
    const digits = (token.match(/[0-9]/g) || []).length;
    const hasMix = /[a-z][0-9]|[0-9][a-z]/i.test(token);
    return hasMix && digits >= 2 && token.length >= 5;
  }
  function extractKeywords(el) {
    const out = [];
    if (!el || el.nodeType !== 1) return out;
    if (el.id && !isHashedToken(el.id)) {
      out.push({ type: "id", value: el.id, action: "remove" });
    }
    for (const cls of el.classList || []) {
      if (!isHashedToken(cls)) out.push({ type: "class", value: cls, action: "remove" });
    }
    for (const attr3 of el.attributes || []) {
      if (attr3.name.startsWith("data-")) {
        out.push({ type: "attr", value: attr3.name, action: "remove" });
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

  // src/lib/log.js
  function createActivityLog(max = 200) {
    const entries = [];
    const listeners = /* @__PURE__ */ new Set();
    const notify = () => {
      for (const fn of listeners) {
        try {
          fn(entries);
        } catch {
        }
      }
    };
    return {
      add(action, detail) {
        detail = detail || "";
        const last = entries[entries.length - 1];
        if (last && last.action === action && last.detail === detail) {
          last.t = Date.now();
          last.count = (last.count || 1) + 1;
          return;
        }
        entries.push({ t: Date.now(), action, detail });
        if (entries.length > max) entries.shift();
        notify();
      },
      entries() {
        return entries.slice();
      },
      clear() {
        entries.length = 0;
        notify();
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    };
  }

  // src/lib/diagnostics.js
  function describe2(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList && el.classList.length ? "." + [...el.classList].slice(0, 3).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }
  function collectDiagnostics(doc) {
    const win = doc.defaultView || window;
    const out = [];
    out.push(`Popup Zapper diagnostics`);
    out.push(`URL: ${doc.location && doc.location.href || ""}`);
    const iframes = [...doc.querySelectorAll("iframe")];
    out.push(`iframes: ${iframes.length}`);
    iframes.slice(0, 12).forEach((f) => out.push(`  iframe src=${f.getAttribute("src") || "(none)"}`));
    const scored = [];
    const blurred = [];
    for (const el of doc.body.querySelectorAll("*")) {
      if (el.closest && el.closest("[data-pz]")) continue;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      const score = scorePopupCandidate(el);
      if (score > 0) {
        let w = 0, h = 0;
        try {
          const r = el.getBoundingClientRect();
          w = Math.round(r.width);
          h = Math.round(r.height);
        } catch {
        }
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
        scored.push({ score, label: describe2(el), pos: cs.position, z: cs.zIndex, w, h, text });
      }
      const f = cs.filter || "";
      const b = cs.backdropFilter || cs.webkitBackdropFilter || "";
      if (/blur\(/i.test(f) || /blur\(/i.test(b)) {
        blurred.push(`${describe2(el)}  filter=${f || "-"}  backdrop=${b || "-"}`);
      }
    }
    scored.sort((a, b) => b.score - a.score);
    out.push(`
Top popup candidates (score > 0): ${scored.length}`);
    scored.slice(0, 15).forEach((s) => out.push(`  [${s.score}] ${s.label} pos=${s.pos} z=${s.z} ${s.w}x${s.h} "${s.text}"`));
    out.push(`
Blurred elements: ${blurred.length}`);
    blurred.slice(0, 15).forEach((b) => out.push(`  ${b}`));
    return out.join("\n");
  }

  // src/lib/paywall-filters.js
  var PAYWALL_VENDORS = [
    /piano\.io/i,
    /tinypass\.com/i,
    /npttech\.com/i,
    // Piano infra
    /cxense\.com/i,
    // Piano/Cxense data
    /cxpublic\.com/i,
    /poool\.(fr|tech)/i,
    /pelcro\.com/i,
    /qiota/i,
    /zephr\.(io|com)/i,
    /evolok/i,
    /blueconic/i,
    /getadmiral\.com/i,
    /leakypaywall/i,
    /sophi\.io/i,
    /mather(economics)?\./i
  ];
  function findPaywallHosts(doc, perf) {
    const urls = /* @__PURE__ */ new Set();
    try {
      const entries = perf && perf.getEntriesByType ? perf.getEntriesByType("resource") : [];
      for (const e of entries) if (e && e.name) urls.add(e.name);
    } catch {
    }
    for (const el of doc.querySelectorAll("script[src],iframe[src],link[href]")) {
      const u = el.getAttribute("src") || el.getAttribute("href");
      if (u) urls.add(u);
    }
    const base = doc.baseURI || doc.location && doc.location.href || "https://example.com";
    const hosts = /* @__PURE__ */ new Set();
    for (const u of urls) {
      let host;
      try {
        host = new URL(u, base).hostname;
      } catch {
        continue;
      }
      if (host && PAYWALL_VENDORS.some((re) => re.test(host))) hosts.add(host);
    }
    return [...hosts].sort();
  }
  function buildUblockFilters(hosts) {
    if (!hosts || !hosts.length) return "";
    const lines = ["! Popup Zapper \u2014 paywall/metering blockers"];
    for (const h of hosts) lines.push(`||${h}^`);
    return lines.join("\n");
  }

  // src/lib/meter.js
  var METER_KEYS = /paywall|meter|reg-?wall|hard-?wall|soft-?wall|freemium|article.?(count|views?|read)|(page|view|read|visit|article).?count|free.?(article|view|read)|content.?gate/i;
  var AUTH_KEYS = /auth|session|token|login|logged|jwt|csrf|xsrf|\bsid\b|\buid\b|guid|remember|credential|oauth|sso|account|cart|checkout|consent|gdpr/i;
  function shouldClear(key) {
    if (!key) return false;
    if (AUTH_KEYS.test(key)) return false;
    return METER_KEYS.test(key);
  }
  function clearStorage(storage) {
    if (!storage) return [];
    const doomed = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (shouldClear(k)) doomed.push(k);
      }
      for (const k of doomed) storage.removeItem(k);
    } catch {
    }
    return doomed;
  }
  function clearCookies(doc) {
    if (!doc || !doc.cookie) return [];
    const cleared = [];
    for (const pair of doc.cookie.split(";")) {
      const name = pair.split("=")[0].trim();
      if (shouldClear(name)) {
        doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        cleared.push(name);
      }
    }
    return cleared;
  }
  function resetMeter(doc, win) {
    const cleared = [];
    if (win) {
      cleared.push(...clearStorage(win.localStorage));
      cleared.push(...clearStorage(win.sessionStorage));
    }
    cleared.push(...clearCookies(doc));
    return cleared;
  }

  // src/lib/freeze.js
  var PREFIX = "pzFreeze:";
  var MIN_TEXT = 400;
  var CONTENT_SELECTORS = [
    "article",
    "main",
    "[role=main]",
    ".article-body",
    ".article__body",
    ".post-content",
    ".entry-content",
    "#content",
    "#main"
  ];
  function keyFor(doc) {
    return PREFIX + (doc.location && doc.location.pathname || "/");
  }
  function pickContent(doc) {
    for (const sel of CONTENT_SELECTORS) {
      let best = null, bestLen = 0;
      for (const el of doc.querySelectorAll(sel)) {
        const len = (el.textContent || "").trim().length;
        if (len > bestLen) {
          bestLen = len;
          best = el;
        }
      }
      if (best && bestLen >= MIN_TEXT) return { el: best, sel };
    }
    if (doc.body) return { el: doc.body, sel: "body" };
    return null;
  }
  function captureSnapshot(doc, store, force) {
    const picked = pickContent(doc);
    if (!picked) return false;
    const text = (picked.el.textContent || "").trim();
    if (!force && text.length < MIN_TEXT) return false;
    const key = keyFor(doc);
    if (!force) {
      let prev = 0;
      try {
        const p = JSON.parse(store.getItem(key) || "null");
        prev = p ? p.len : 0;
      } catch {
      }
      if (text.length <= prev) return false;
    }
    try {
      store.setItem(key, JSON.stringify({ sel: picked.sel, html: picked.el.innerHTML, len: text.length }));
      return true;
    } catch {
      return false;
    }
  }

  // src/lib/cleanfetch.js
  function extractCleanContent(htmlString) {
    if (!htmlString) return null;
    let doc;
    try {
      doc = new DOMParser().parseFromString(htmlString, "text/html");
    } catch {
      return null;
    }
    if (!doc || !doc.body) return null;
    const picked = pickContent(doc);
    if (!picked) return null;
    const titleEl = doc.querySelector("title");
    return {
      title: titleEl && titleEl.textContent || "",
      sel: picked.sel,
      html: picked.el.innerHTML,
      len: (picked.el.textContent || "").trim().length
    };
  }
  function buildCleanDocument(htmlString, baseUrl) {
    if (!htmlString) return null;
    let doc;
    try {
      doc = new DOMParser().parseFromString(htmlString, "text/html");
    } catch {
      return null;
    }
    if (!doc || !doc.documentElement) return null;
    doc.querySelectorAll("script,noscript").forEach((n) => n.remove());
    doc.querySelectorAll(
      '[class*="paywall" i],[class*="regwall" i],[class*="gate" i],[id*="paywall" i],[id*="regwall" i]'
    ).forEach((n) => n.remove());
    if (baseUrl && doc.head) {
      let base = doc.querySelector("base");
      if (!base) {
        base = doc.createElement("base");
        doc.head.insertBefore(base, doc.head.firstChild);
      }
      base.setAttribute("href", baseUrl);
    }
    if (doc.body) {
      doc.body.style.overflow = "auto";
      doc.body.style.position = "static";
    }
    doc.documentElement.style.overflow = "auto";
    return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
  }

  // src/lib/picker.js
  var MAX_CANDIDATES = 8;
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
  function createPicker(doc) {
    const candidates = rankCandidates(doc);
    let idx = 0;
    let target = candidates[0] || doc.body;
    return {
      current() {
        return target;
      },
      candidateCount() {
        return candidates.length;
      },
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
        if (target && target.parentElement && target.parentElement !== doc.documentElement && target !== doc.body) {
          target = target.parentElement;
        }
        return target;
      },
      shrink() {
        const child = target && target.firstElementChild;
        if (child) target = child;
        return target;
      }
    };
  }

  // src/lib/undo.js
  function createUndoStack() {
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
        } catch {
          return false;
        }
        if (it.ruleRef && it.ruleRef.list) {
          const i = it.ruleRef.list.indexOf(it.ruleRef.rule);
          if (i >= 0) it.ruleRef.list.splice(i, 1);
        }
        return true;
      },
      size() {
        return items.length;
      }
    };
  }

  // src/lib/reveal.js
  var MIN_TEXT2 = 600;
  var MAX_CLAMP = 2e3;
  function clamped(cs) {
    const mh = parseFloat(cs.maxHeight);
    const hidden = /hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY);
    return !Number.isNaN(mh) && cs.maxHeight !== "none" && mh < MAX_CLAMP && hidden;
  }
  function hasResidualGating(doc) {
    const win = doc.defaultView || window;
    for (const el of doc.body.querySelectorAll("*")) {
      if (el.closest && el.closest("[data-pz]")) continue;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      const long = (el.textContent || "").length > MIN_TEXT2;
      if (long && clamped(cs)) return true;
      if (long && parseFloat(cs.opacity || "1") <= 0.05) return true;
    }
    return false;
  }
  function revealDeep(doc, skip2) {
    const win = doc.defaultView || window;
    let changes = 0;
    for (const el of doc.body.querySelectorAll("*")) {
      if (el.closest && el.closest("[data-pz]")) continue;
      if (skip2 && skip2(el)) continue;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      const long = (el.textContent || "").length > MIN_TEXT2;
      if (long && clamped(cs)) {
        el.style.setProperty("max-height", "none", "important");
        el.style.setProperty("overflow", "visible", "important");
        changes++;
      }
      const inline = el.getAttribute && el.getAttribute("style") || "";
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

  // src/lib/updates.js
  function parseVersion(headerText) {
    const m = /@version\s+([0-9][0-9A-Za-z.\-]*)/.exec(headerText || "");
    return m ? m[1] : null;
  }
  function compareVersions(a, b) {
    const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }
  function updatePlan(current, remote) {
    if (!remote) {
      return { action: "error", remote: null, message: "Couldn't check for updates (network blocked)." };
    }
    if (compareVersions(remote, current) > 0) {
      return {
        action: "install",
        remote,
        message: `Popup Zapper v${remote} is available (you have v${current}).

Open the install page now? Your userscript manager will show an Update/Reinstall button \u2014 click it and you're done.`
      };
    }
    return { action: "none", remote, message: "Up to date \u2713" };
  }

  // src/lib/batch/rows.js
  var LOOKS_LIKE_A_FILE = /\b(PDF|DOCX?|XLSX?|XLSM|PPTX?|ZIP|RAR|7Z|DWG|DXF|DWFX?|DGN|RVT|RFA|RTE|IFC|SKP|STP|STEP|IGS|IGES|3DS|3DM|OBJ|FBX|GSM|PLN|VWX|NWD|NWC|JPE?G|PNG|TIFF?|GIF|SVG|EPS|PSD|MP4|MOV|TXT|CSV|KMZ)\b/i;
  var LOOKS_LIKE_A_SIZE = /\b\d+([.,]\d+)?\s?(kB|KB|MB|GB)\b/i;
  var LOOKS_LIKE_A_MIME = /\b(application|image|video|audio|text|model)\/[a-z0-9][a-z0-9.+-]*/i;
  var EVERY_FORMAT = new RegExp(LOOKS_LIKE_A_FILE.source, "gi");
  var EVERY_SIZE = new RegExp(LOOKS_LIKE_A_SIZE.source, "gi");
  var EVERY_MIME = new RegExp(LOOKS_LIKE_A_MIME.source, "gi");
  var A_LETTER = /\p{L}/gu;
  var TITLE_LETTERS = 15;
  var SIGNAL_FORMAT = /(?:^|[^a-z0-9])(pdf|docx?|xlsx?|xlsm|pptx?|zip|rar|7z|dwg|dxf|dwfx?|rvt|rfa|ifc|skp|3dm|gsm|pln)(?:[^a-z0-9]|$)/i;
  var SIGNAL_ATTRIBUTES = ["href", "src", "alt", "title", "class", "aria-label", "data-type", "xlink:href"];
  function collapse(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }
  function normaliseText(text) {
    return collapse(text).toLowerCase();
  }
  function isDocumentRowText(text) {
    const raw = String(text == null ? "" : text);
    if (!LOOKS_LIKE_A_FILE.test(raw)) return false;
    if (LOOKS_LIKE_A_SIZE.test(raw)) return true;
    if (!LOOKS_LIKE_A_MIME.test(raw)) return false;
    const rest = raw.replace(EVERY_MIME, " ").replace(EVERY_FORMAT, " ");
    return (rest.match(A_LETTER) || []).length >= TITLE_LETTERS;
  }
  function titleLetters(text) {
    const rest = String(text == null ? "" : text).replace(EVERY_MIME, " ").replace(EVERY_FORMAT, " ").replace(EVERY_SIZE, " ");
    return (rest.match(A_LETTER) || []).length;
  }
  function rowFacts(node) {
    const facts = {
      tag: String(node && node.nodeName || "").toUpperCase(),
      links: 0,
      downloads: 0,
      signals: []
    };
    const walk = (at, depth) => {
      if (depth > 40 || facts.signals.length > 200) return;
      for (let child = at.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        if (typeof child.getAttribute === "function") {
          if (String(child.nodeName).toUpperCase() === "A" && child.getAttribute("href")) {
            facts.links += 1;
            if (child.getAttribute("download") !== null) facts.downloads += 1;
          }
          for (const name of SIGNAL_ATTRIBUTES) {
            const value = child.getAttribute(name);
            if (value) facts.signals.push(String(value));
          }
        }
        walk(child, depth + 1);
      }
    };
    if (node) walk(node, 0);
    return facts;
  }
  function formatFromSignals(signals) {
    for (const signal of signals || []) {
      const found = SIGNAL_FORMAT.exec(String(signal));
      if (found) return found[1].toUpperCase();
    }
    return "";
  }
  function isDocumentRow(text, facts) {
    if (isDocumentRowText(text)) return true;
    if (titleLetters(text) < TITLE_LETTERS || !facts) return false;
    if (formatFromSignals(facts.signals)) return true;
    if (facts.downloads > 0) return true;
    if (facts.links > 0 && SIGNAL_FORMAT.test(String(text))) return true;
    return facts.tag === "TR" && facts.links > 0;
  }
  function lastMatch(text, every) {
    const all = String(text).match(every);
    return all ? all[all.length - 1] : "";
  }
  function rowIdentity(text) {
    const raw = String(text == null ? "" : text);
    const lines = raw.split(/[\r\n]+/).map(collapse).filter((line) => {
      const rest = line.replace(EVERY_MIME, " ").replace(EVERY_FORMAT, " ").replace(EVERY_SIZE, " ");
      return (rest.match(A_LETTER) || []).length >= 3;
    });
    return {
      id: normaliseText(raw),
      title: (lines.length ? lines.join(" / ") : collapse(raw)).slice(0, 240),
      format: lastMatch(raw, EVERY_FORMAT).toUpperCase(),
      size: collapse(lastMatch(raw, EVERY_SIZE))
    };
  }
  function numberIdentities(identities) {
    const times = /* @__PURE__ */ new Map();
    return identities.map((identity) => {
      const one = Object.assign({}, identity);
      const nth = (times.get(one.id) || 0) + 1;
      times.set(one.id, nth);
      if (nth > 1) one.id = one.id + " #" + nth;
      return one;
    });
  }
  var BLOCKS = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/;
  var SILENT = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/;
  function rowText(row3) {
    const parts = [];
    const walk = (node, depth) => {
      if (depth > 40) return;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          parts.push(child.nodeValue);
        } else if (child.nodeType === 1) {
          const name = String(child.nodeName).toUpperCase();
          if (SILENT.test(name)) continue;
          const block = BLOCKS.test(name);
          if (block) parts.push("\n");
          walk(child, depth + 1);
          if (block) parts.push("\n");
        }
      }
    };
    walk(row3, 0);
    return parts.join("");
  }
  var assumed = /* @__PURE__ */ new WeakMap();
  function attr(node, name) {
    return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
  }
  function boxState(box) {
    if (!box) return null;
    if (typeof box.checked === "boolean") return box.checked;
    for (const name of ["aria-checked", "aria-pressed", "aria-selected"]) {
      const said = attr(box, name);
      if (said !== null) return said === "true" || said === "mixed";
    }
    try {
      const control2 = box.control || (typeof box.querySelector === "function" ? box.querySelector('input[type="checkbox"]') : null);
      if (control2 && typeof control2.checked === "boolean") return control2.checked;
    } catch {
    }
    const cls = String(attr(box, "class") || "");
    if (/(^|[\s_-])(is-)?(checked|selected|ticked)([\s_-]|$)/i.test(cls)) return true;
    return null;
  }
  function isTicked(box) {
    const shown = boxState(box);
    if (shown !== null) return shown;
    return assumed.get(box) === true;
  }
  function clickBox(box) {
    const before = boxState(box);
    box.click();
    if (before === null && boxState(box) === null) assumed.set(box, !assumed.get(box));
  }
  var NATIVE = 'input[type="checkbox"]';
  var AUTO = 'input[type="checkbox"], [role="checkbox"]';
  function nativeSource(doc) {
    return {
      learned: false,
      boxes: () => Array.from(doc.querySelectorAll(NATIVE)),
      within: (node) => {
        try {
          return node.querySelectorAll(NATIVE).length;
        } catch {
          return 1;
        }
      },
      checked: () => {
        try {
          return Array.from(doc.querySelectorAll(NATIVE + ":checked"));
        } catch {
          return [];
        }
      }
    };
  }
  function autoSource(doc, isOurs = () => false) {
    const keep = (el) => {
      if (isOurs(el)) return false;
      if (String(el.nodeName).toUpperCase() !== "INPUT") return true;
      const up = el.parentElement;
      return !(up && typeof up.closest === "function" && up.closest('[role="checkbox"]'));
    };
    return {
      learned: false,
      boxes: () => Array.from(doc.querySelectorAll(AUTO)).filter(keep),
      within: (node, cap = 2) => {
        let n = 0;
        try {
          for (const el of node.querySelectorAll(AUTO)) {
            if (keep(el) && ++n >= cap) break;
          }
        } catch {
          return 1;
        }
        return n;
      },
      checked() {
        return this.boxes().filter(isTicked);
      }
    };
  }
  function learnedSource(doc, record, matches, isOurs = () => false, narrow = (list) => list) {
    const tag2 = record && record.tag ? record.tag : "*";
    const fits = (el) => !isOurs(el) && matches(el, record);
    let found = null;
    const boxes = () => {
      const list = narrow(Array.from(doc.getElementsByTagName(tag2)).filter(fits));
      found = new Set(list);
      return list;
    };
    return {
      learned: true,
      boxes,
      within: (node, cap = 2) => {
        if (!found) boxes();
        let n = 0;
        try {
          for (const el of node.getElementsByTagName(tag2)) {
            if (found.has(el) && ++n >= cap) break;
          }
        } catch {
          return 1;
        }
        return n;
      },
      checked() {
        return boxes().filter(isTicked);
      }
    };
  }
  var ROW_DEPTH = 8;
  var MISS_AGAIN = 5e3;
  function createRowReader(doc, options = {}) {
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const source = options.source || nativeSource(doc);
    const found = /* @__PURE__ */ new WeakMap();
    const known = /* @__PURE__ */ new WeakMap();
    const rowSet = /* @__PURE__ */ new WeakSet();
    let last = [];
    function climbDocument(box) {
      let node = box;
      for (let step = 0; step < ROW_DEPTH && node; step++) {
        node = node.parentElement;
        if (!node || source.within(node) > 1) return null;
        const text = rowText(node);
        if (isDocumentRowText(text)) return { row: node, text, format: "" };
        if (titleLetters(text) >= TITLE_LETTERS) {
          const facts = rowFacts(node);
          if (isDocumentRow(text, facts)) return { row: node, text, format: formatFromSignals(facts.signals) };
        }
      }
      return null;
    }
    function climbLearned(box) {
      let row3 = null;
      let node = box;
      for (let step = 0; step < ROW_DEPTH; step++) {
        const up = node.parentElement;
        if (!up || up === doc.body || up === doc.documentElement || source.within(up) > 1) break;
        row3 = node = up;
      }
      if (!row3) row3 = box.parentElement || box;
      return { row: row3, text: rowText(row3), format: formatFromSignals(rowFacts(row3).signals) };
    }
    function climb(box) {
      return source.learned ? climbLearned(box) : climbDocument(box);
    }
    function rowFor(box) {
      const held = found.get(box);
      if (held && held.row) {
        if (held.row.isConnected !== false && held.row.contains(box)) {
          return { row: held.row, text: null, format: held.format || "" };
        }
      } else if (held && now() - held.at < MISS_AGAIN) {
        return null;
      }
      const fresh = climb(box);
      found.set(box, fresh ? { row: fresh.row, format: fresh.format || "" } : { row: null, at: now() });
      return fresh;
    }
    function identityOf(row3, content, walked) {
      let seen = known.get(row3);
      if (!seen || seen.content !== content) {
        seen = { content, identity: rowIdentity(walked !== null ? walked : rowText(row3)) };
        known.set(row3, seen);
      }
      return seen.identity;
    }
    function read(box) {
      const hit = rowFor(box);
      if (!hit) return null;
      const row3 = hit.row;
      if (box.hidden === true || row3.hidden === true) return null;
      rowSet.add(row3);
      const base = identityOf(row3, row3.textContent || "", hit.text);
      return {
        box,
        row: row3,
        base: !base.format && hit.format ? Object.assign({}, base, { format: hit.format }) : base
      };
    }
    function rows() {
      const out = [];
      for (const box of source.boxes()) {
        const one = read(box);
        if (one) out.push(one);
      }
      const numbered = numberIdentities(out.map((each) => each.base));
      last = out.map((each, at) => ({ box: each.box, row: each.row, identity: numbered[at], base: each.base.id }));
      return last;
    }
    function locate(chosen) {
      const box = chosen && chosen.box;
      if (!box || box.isConnected === false) return null;
      const held = found.get(box);
      if (!held || held.row !== chosen.row || !chosen.row.contains(box)) return null;
      const identity = identityOf(chosen.row, chosen.row.textContent || "", null);
      return identity.id === chosen.base ? chosen : null;
    }
    function checked() {
      const out = [];
      for (const box of source.checked()) {
        const hit = rowFor(box);
        if (hit) out.push({ box, row: hit.row });
      }
      return out;
    }
    function insideRow(node) {
      for (let at = node, step = 0; at && step < 40; at = at.parentElement, step++) {
        if (rowSet.has(at)) return true;
      }
      return false;
    }
    function explain(box) {
      const said = [];
      let node = box;
      for (let step = 0; step < ROW_DEPTH && node; step++) {
        node = node.parentElement;
        if (!node) break;
        const name = String(node.nodeName || "?").toUpperCase();
        const boxes = source.within(node, 99);
        if (boxes > 1) {
          said.push(`${name} holds ${boxes} boxes, so the climb stops`);
          break;
        }
        const text = rowText(node);
        const facts = rowFacts(node);
        said.push(`${name} "${collapse(text).slice(0, 60)}": ${titleLetters(text)} letters, ${facts.links} link(s), ${formatFromSignals(facts.signals) || "no file named"}`);
      }
      return said.join("; ");
    }
    return { rows, locate, checked, insideRow, explain, last: () => last, source };
  }

  // src/lib/batch/ledger.js
  var LEDGER_PREFIX = "qs-intelligence document ledger ";
  var MAX_BATCH_RECORDS = 2e3;
  function ledgerKey(href) {
    const where = new URL(String(href));
    return LEDGER_PREFIX + where.origin + where.pathname;
  }
  function emptyLedger(key) {
    return { version: 1, key, nextBatch: 1, rows: {}, batches: [] };
  }
  function owns(object, name) {
    return Object.prototype.hasOwnProperty.call(object, name);
  }
  function putRow(rows, id, row3) {
    Object.defineProperty(rows, id, { value: row3, enumerable: true, writable: true, configurable: true });
  }
  function isStatus(value) {
    return value === "confirmed" || value === "unconfirmed";
  }
  function heldRow(ledger, id) {
    return ledger && ledger.rows && owns(ledger.rows, id) ? ledger.rows[id] : null;
  }
  function wholeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
  }
  function readLedger(storage, key) {
    const ledger = emptyLedger(key);
    let raw = null;
    try {
      raw = storage ? storage.getItem(key) : null;
    } catch {
      raw = null;
    }
    if (typeof raw !== "string" || !raw) return ledger;
    let held = null;
    try {
      held = JSON.parse(raw);
    } catch {
      held = null;
    }
    if (!held || typeof held !== "object" || Array.isArray(held) || !held.rows || typeof held.rows !== "object" || Array.isArray(held.rows)) {
      return ledger;
    }
    for (const id of Object.keys(held.rows)) {
      const row3 = held.rows[id];
      if (row3 && typeof row3 === "object" && isStatus(row3.status)) putRow(ledger.rows, id, row3);
    }
    ledger.nextBatch = wholeNumber(held.nextBatch, 1);
    if (Array.isArray(held.batches)) {
      ledger.batches = held.batches.filter((record) => record !== null && typeof record === "object");
    }
    return ledger;
  }
  function writeLedger(storage, key, ledger) {
    try {
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(ledger));
      return true;
    } catch {
      return false;
    }
  }
  function betterRow(held, other) {
    if (!held) return other;
    if (!other) return held;
    const rank = (row3) => row3.status === "confirmed" ? 1 : 0;
    if (rank(held) !== rank(other)) return rank(held) > rank(other) ? held : other;
    return String(other.at) > String(held.at) ? other : held;
  }
  function mergeLedgers(one, two) {
    const merged = emptyLedger(one.key || two.key);
    merged.nextBatch = Math.max(wholeNumber(one.nextBatch, 1), wholeNumber(two.nextBatch, 1));
    for (const ledger of [one, two]) {
      for (const id of Object.keys(ledger.rows)) {
        putRow(merged.rows, id, betterRow(heldRow(merged, id), ledger.rows[id]));
      }
    }
    const records = /* @__PURE__ */ new Map();
    for (const ledger of [one, two]) {
      for (const record of ledger.batches) {
        const name = record.batch + " " + record.at;
        const held = records.get(name);
        if (!held) records.set(name, record);
        else if (record.late && !held.late) records.set(name, Object.assign({}, held, { late: record.late }));
      }
    }
    merged.batches = Array.from(records.values()).sort((a, b) => {
      const first = String(a.at);
      const second = String(b.at);
      return Number(a.batch) - Number(b.batch) || (first < second ? -1 : first > second ? 1 : 0);
    });
    if (merged.batches.length > MAX_BATCH_RECORDS) merged.batches = merged.batches.slice(-MAX_BATCH_RECORDS);
    return merged;
  }
  function recordBatch(ledger, identities, batch2, status, at, details) {
    if (!isStatus(status)) throw new Error(`a batch is confirmed or unconfirmed, not "${status}"`);
    const extra = details || {};
    for (const each of identities) {
      const held = heldRow(ledger, each.id);
      if (held && held.status === "confirmed" && status !== "confirmed") continue;
      putRow(ledger.rows, each.id, {
        title: each.title,
        format: each.format,
        size: each.size,
        where: extra.where || "",
        batch: batch2,
        at,
        status,
        tries: (held ? wholeNumber(held.tries, 1) : 0) + 1
      });
    }
    ledger.batches.push({
      batch: batch2,
      at,
      status,
      rows: identities.length,
      mode: extra.mode || "",
      waited: typeof extra.waited === "number" ? extra.waited : null,
      evidence: extra.evidence || "",
      reason: extra.reason || ""
    });
    if (ledger.batches.length > MAX_BATCH_RECORDS) {
      ledger.batches.splice(0, ledger.batches.length - MAX_BATCH_RECORDS);
    }
    if (wholeNumber(ledger.nextBatch, 1) <= batch2) ledger.nextBatch = batch2 + 1;
    return ledger;
  }
  function noteLate(ledger, batch2, description, at) {
    let marked = false;
    for (const record of ledger.batches) {
      if (record.batch === batch2 && record.status === "unconfirmed" && !record.late) {
        record.late = { at, evidence: String(description || "") };
        marked = true;
      }
    }
    return marked;
  }
  function openStore(storage, key) {
    let memory = readLedger(storage, key);
    let saved = true;
    const fresh = () => {
      memory = mergeLedgers(readLedger(storage, key), memory);
      return memory;
    };
    const save = () => {
      saved = writeLedger(storage, key, memory);
      return saved;
    };
    return {
      key,
      read: fresh,
      nextBatch() {
        fresh();
        const batch2 = wholeNumber(memory.nextBatch, 1);
        memory.nextBatch = batch2 + 1;
        save();
        return batch2;
      },
      record(identities, batch2, status, at, details) {
        fresh();
        recordBatch(memory, identities, batch2, status, at, details);
        save();
        return memory;
      },
      noteLate(batch2, description, at) {
        fresh();
        const marked = noteLate(memory, batch2, description, at);
        if (marked) save();
        return marked;
      },
      saved: () => saved,
      // Another tab still holding the ledger would write it back, so Reset is
      // for one tab at a time.
      forget() {
        memory = emptyLedger(key);
        saved = true;
        if (!storage) return true;
        try {
          storage.removeItem(key);
          return true;
        } catch {
          return false;
        }
      }
    };
  }
  function chooseBatch(identities, ledger, size, mode) {
    if (mode !== "fresh" && mode !== "retry") throw new Error(`a run is "fresh" or "retry", not "${mode}"`);
    const asked = Math.floor(Number(size));
    const limit = Number.isFinite(asked) && asked >= 1 ? asked : 1;
    const out = [];
    for (let at = 0; at < identities.length && out.length < limit; at++) {
      const each = identities[at];
      const held = heldRow(ledger, each.id);
      if (held && held.status === "confirmed") continue;
      if (mode === "fresh" && held) continue;
      if (mode === "retry" && !held) continue;
      out.push(each);
    }
    return out;
  }
  function pageCounts(identities, ledger) {
    const counts = { rows: identities.length, todo: 0, confirmed: 0, unconfirmed: 0 };
    for (const each of identities) {
      const held = heldRow(ledger, each.id);
      if (held && isStatus(held.status)) counts[held.status] += 1;
      else counts.todo += 1;
    }
    return counts;
  }
  function ledgerCounts(ledger) {
    const counts = { confirmed: 0, unconfirmed: 0 };
    for (const id of Object.keys(ledger.rows)) {
      const status = ledger.rows[id] && ledger.rows[id].status;
      if (isStatus(status)) counts[status] += 1;
    }
    return counts;
  }
  function listLedgerKeys(storage, prefix) {
    const keys = [];
    try {
      const count = storage ? storage.length : 0;
      for (let at = 0; at < count; at++) {
        const key = storage.key(at);
        if (typeof key === "string" && key.indexOf(prefix) === 0) keys.push(key);
      }
    } catch {
      return keys.sort();
    }
    return keys.sort();
  }
  function buildExport(ledgers, about) {
    const meta = about || {};
    const confirmed = [];
    const unconfirmed = [];
    for (const ledger of ledgers) {
      const address = String(ledger.key || "").slice(LEDGER_PREFIX.length);
      for (const id of Object.keys(ledger.rows)) {
        const row3 = ledger.rows[id];
        const line = {
          title: String(row3.title || ""),
          format: row3.format || "",
          size: row3.size || "",
          status: row3.status,
          batch: row3.batch,
          at: row3.at,
          tries: row3.tries,
          where: row3.where || "",
          address,
          id
        };
        if (row3.status === "confirmed") confirmed.push(line);
        if (row3.status === "unconfirmed") unconfirmed.push(line);
      }
    }
    const byTitle = (a, b) => {
      if (a.title !== b.title) return a.title < b.title ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    };
    confirmed.sort(byTitle);
    unconfirmed.sort(byTitle);
    return {
      exported: meta.at || "",
      script: meta.script || "",
      origin: meta.origin || "",
      reading: 'Every document row the batch clicker has handled on this site. CONFIRMED means a file was seen handed over for its batch. UNCONFIRMED means its batch was pressed and no file was seen within the time allowed: fetch those again or look for them among the zips. "where" is the page of results it was on, and batch numbers match the ledgers below. "traces" holds, for each batch pressed since the page was opened, what the page and the browser did after the press, in milliseconds from it.',
      totals: { confirmed: confirmed.length, unconfirmed: unconfirmed.length },
      unconfirmed,
      confirmed,
      traces: meta.traces || {},
      ledgers
    };
  }
  function siteLedgers(storage, stores, prefix) {
    const keys = listLedgerKeys(storage, prefix);
    if (stores) stores.forEach((store, key) => {
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    return keys.map((key) => stores && stores.has(key) ? stores.get(key).read() : readLedger(storage, key));
  }
  function siteTotals(storage, stores, prefix) {
    const ledgers = siteLedgers(storage, stores, prefix);
    let documents = 0;
    for (const ledger of ledgers) {
      const counts = ledgerCounts(ledger);
      documents += counts.confirmed + counts.unconfirmed;
    }
    return { ledgers: ledgers.length, documents };
  }
  function forgetSite(storage, stores, prefix) {
    let cleared = true;
    for (const key of listLedgerKeys(storage, prefix)) {
      try {
        storage.removeItem(key);
      } catch {
        cleared = false;
      }
    }
    if (stores) stores.forEach((store) => {
      if (!store.forget()) cleared = false;
    });
    return cleared;
  }

  // src/lib/batch/evidence.js
  var FILE_TYPES = [
    "application/zip",
    "application/x-zip",
    "application/x-zip-compressed",
    "application/octet-stream",
    "binary/octet-stream",
    "application/pdf",
    "application/x-pdf",
    "application/force-download",
    "application/x-download"
  ];
  function headersFromRaw(raw) {
    const out = { contentType: "", disposition: "" };
    for (const line of String(raw == null ? "" : raw).split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (name === "content-type" && !out.contentType) out.contentType = value;
      if (name === "content-disposition" && !out.disposition) out.disposition = value;
    }
    return out;
  }
  function isFileResponse(response) {
    const head = response || {};
    const status = typeof head.status === "number" ? head.status : Number(head.status);
    if (!(Number.isInteger(status) && status >= 200 && status <= 299)) return false;
    if (/^attachment\b/i.test(collapse(head.disposition))) return true;
    const type = collapse(String(head.contentType == null ? "" : head.contentType).split(";")[0]).toLowerCase();
    return FILE_TYPES.indexOf(type) >= 0;
  }
  function isFileEvidence(event) {
    return !!event && (event.kind === "response" || event.kind === "incoming") && event.failed !== true && event.method !== "HEAD" && isFileResponse(event);
  }
  function countFromButtonText(text) {
    const words = collapse(text);
    const bracketed = words.match(/\(\s*(\d+)\s*\)/);
    if (bracketed) return Number(bracketed[1]);
    const bare = words.match(/\b(\d+)\b/);
    return bare ? Number(bare[1]) : null;
  }
  function readSetting(text, fallback, least, most, whole) {
    const value = parseFloat(String(text == null ? "" : text).trim());
    if (!Number.isFinite(value)) return fallback;
    const kept = whole ? Math.floor(value) : value;
    return Math.min(most, Math.max(least, kept));
  }
  function shortUrl(url, base) {
    const text = String(url == null ? "" : url);
    if (/^blob:/i.test(text)) {
      const inner = text.slice(5);
      return "blob " + inner.slice(inner.lastIndexOf("/") + 1);
    }
    if (/^data:/i.test(text)) return "data";
    let home = "";
    try {
      home = base ? new URL(String(base)).origin : "";
    } catch {
      home = "";
    }
    try {
      const where = base ? new URL(text, String(base)) : new URL(text);
      return ((where.origin === home ? "" : where.host) + where.pathname).slice(0, 120);
    } catch {
      return text.split(/[?#]/)[0].slice(0, 120);
    }
  }
  function sinceLast(timing) {
    if (!timing || typeof timing.gapSeconds !== "number") return "";
    return timing.gapSeconds.toFixed(2) + "s after batch " + timing.after + (timing.handedOver ? " was handed over" : " ended");
  }
  function describeEvent(event, base) {
    if (!event) return "";
    if (event.kind === "response" || event.kind === "incoming") {
      const said = [
        event.kind === "incoming" ? "arriving:" : "done:",
        event.via || "request",
        event.method || "GET",
        shortUrl(event.url, base),
        String(event.status),
        collapse(String(event.contentType || "").split(";")[0]) || "no type"
      ];
      if (/^attachment\b/i.test(collapse(event.disposition))) said.push("attachment");
      if (event.failed) said.push("FAILED");
      return said.join(" ");
    }
    if (event.kind === "blob") {
      return "blob made, " + (event.type || "no type") + (typeof event.size === "number" ? ", " + event.size + " bytes" : "");
    }
    if (event.kind === "anchor") {
      return "link clicked" + (event.via === "event" ? " (a click event)" : "") + ", " + shortUrl(event.href, base) + (event.download ? ", saving as " + event.download : "");
    }
    if (event.kind === "resource") {
      const size = Math.max(Number(event.encodedBodySize) || 0, Number(event.transferSize) || 0);
      return "resource: " + (event.initiatorType || "other") + " " + shortUrl(event.name, base) + ", " + (size ? size + " bytes" : "size unknown") + (event.contentType ? ", " + event.contentType : "") + (event.responseStatus ? ", status " + event.responseStatus : "");
    }
    if (event.kind === "blur") {
      return "blur, the window lost focus" + (event.visible === false ? " (page hidden)" : "");
    }
    if (event.kind === "focus") {
      return "focus, the window has it back" + (event.hasFocus === true ? "" : " (but document.hasFocus() says no)");
    }
    if (event.kind === "visibility") return "the page was " + (event.visible === false ? "hidden" : "shown again");
    if (event.kind === "open") return "window.open " + shortUrl(event.url, base);
    if (event.kind === "submit") {
      return "form submitted, " + (event.method || "GET") + " " + shortUrl(event.url, base) + (event.via ? " (" + event.via + ")" : "");
    }
    if (event.kind === "iframe") return "frame given the address " + shortUrl(event.url, base);
    if (event.kind === "unload") return "the page is about to unload";
    if (event.kind === "button") {
      return "button " + (event.disabled ? "disabled" : "enabled") + ', reads "' + collapse(event.text).slice(0, 40) + '"' + (event.attached === false ? ", no longer on the page" : "");
    }
    if (event.kind === "stop") return "Stop pressed";
    if (event.kind === "timing") {
      const parts = [];
      const since = sinceLast(event);
      if (since) parts.push("pressed " + since);
      for (const [key, label] of [
        ["settleMs", "settled for"],
        ["untickMs", "unticked in"],
        ["refreshMs", "counts redrawn in"],
        ["readMs", "rows read in"],
        ["takeMs", "ticked and checked in"],
        ["quietMs", "page went quiet in"]
      ]) {
        if (typeof event[key] === "number") parts.push(label + " " + Math.round(event[key]) + " ms");
      }
      return "timing: " + parts.join(", ");
    }
    return "";
  }
  var RESOURCE_KINDS = ["fetch", "xmlhttprequest"];
  var BIG_BODY = 1e5;
  var SMALLEST_FILE = 1e4;
  var NAMES_A_FILE = /download|archive|zip|pdf/i;
  var NOT_A_FILE_TYPE = /json|html|xml|javascript|text\//i;
  function isFileResource(event, pressedAt) {
    if (!event || RESOURCE_KINDS.indexOf(String(event.initiatorType)) < 0) return false;
    if (typeof event.started !== "number" || !(event.started >= pressedAt)) return false;
    const status = Number(event.responseStatus) || 0;
    if (status && !(status >= 200 && status <= 299)) return false;
    if (NOT_A_FILE_TYPE.test(String(event.contentType || ""))) return false;
    const body = Math.max(Number(event.encodedBodySize) || 0, Number(event.transferSize) || 0);
    if (body > BIG_BODY) return true;
    if (body > 0 && body < SMALLEST_FILE) return false;
    return NAMES_A_FILE.test(String(event.name || ""));
  }
  function resourceEvent(entry, pressPerf, pressedAt) {
    const place = (time) => {
      const number = Number(time);
      return Number.isFinite(number) ? pressedAt + (number - pressPerf) : NaN;
    };
    const end = Number(entry.responseEnd) > 0 ? entry.responseEnd : Number(entry.startTime) + Number(entry.duration);
    return {
      kind: "resource",
      name: String(entry.name || ""),
      initiatorType: String(entry.initiatorType || ""),
      started: place(entry.startTime),
      at: place(end),
      encodedBodySize: Number(entry.encodedBodySize) || 0,
      transferSize: Number(entry.transferSize) || 0,
      contentType: String(entry.contentType || ""),
      responseStatus: Number(entry.responseStatus) || 0
    };
  }
  function traceLine(event, start) {
    const text = describeEvent(event);
    if (!text) return "";
    if (!Number.isFinite(event.at) || !Number.isFinite(start)) return "+?ms " + text;
    const ms = Math.round(event.at - start);
    return (ms >= 0 ? "+" : "") + ms + "ms " + text;
  }
  function createTracer(limit) {
    const asked = Math.floor(Number(limit));
    const cap = Number.isFinite(asked) && asked >= 1 ? asked : 300;
    const traces = {};
    let batch2 = null;
    let start = NaN;
    return {
      start(number, at) {
        batch2 = String(number);
        start = at;
        traces[batch2] = [];
      },
      note(event) {
        if (batch2 === null || !event || event.kind === "clock") return;
        const list = traces[batch2];
        if (list.length >= cap) return;
        const line = traceLine(event, start);
        if (line) list.push(line);
      },
      all() {
        const copy = {};
        for (const key of Object.keys(traces)) copy[key] = traces[key].slice();
        return copy;
      }
    };
  }
  function isLoadMoreText(text) {
    const words = collapse(text);
    return words.length > 0 && words.length <= 40 && /^(load|show|view|see)\s+more\b/i.test(words);
  }
  async function waitForGrowth(count, before, sleep2, now, ceilingMs, halted) {
    const until = now() + ceilingMs;
    for (; ; ) {
      const seen = count();
      if (seen > before) return { grew: true, after: seen };
      if (now() >= until || typeof halted === "function" && halted()) return { grew: false, after: seen };
      await sleep2(0.25);
    }
  }
  var QUIET_MS = 1e3;
  var QUIET_CAP_MS = 6e3;
  var QUIET_POLL = 0.05;
  async function waitForQuiet(lastChange, since, now, sleep2, quietMs, capMs, halted) {
    const start = now();
    for (; ; ) {
      const at = now();
      if (typeof halted === "function" && halted()) return { quiet: false, halted: true, waitedMs: at - start };
      const last = Math.max(Number(lastChange()) || 0, since);
      if (at - last >= quietMs) return { quiet: true, halted: false, waitedMs: at - start };
      if (at - start >= capMs) return { quiet: false, halted: false, waitedMs: at - start };
      await sleep2(QUIET_POLL);
    }
  }
  function newWatch(batch2, pressedAt, timeoutMs) {
    return {
      batch: batch2,
      pressedAt,
      deadline: pressedAt + timeoutMs,
      status: "waiting",
      blobs: [],
      ambiguous: false,
      away: false,
      evidence: "",
      reason: "",
      decidedAt: null
    };
  }
  function decide(watch, status, reason, evidence, at) {
    return Object.assign({}, watch, { status, reason, evidence, decidedAt: at });
  }
  function observe(watch, event) {
    if (!watch || watch.status !== "waiting" || !event) return watch;
    if (event.kind === "stop") return decide(watch, "unconfirmed", "stopped", "", event.at);
    const at = event.at;
    if (typeof at !== "number" || !Number.isFinite(at)) return watch;
    if (at >= watch.deadline) return decide(watch, "unconfirmed", "timeout", "", watch.deadline);
    if (at < watch.pressedAt) return watch;
    if (event.kind === "response" || event.kind === "incoming") {
      if (!isFileEvidence(event)) return watch;
      if (event.batch === watch.batch) {
        return event.kind === "response" ? decide(watch, "confirmed", "", describeEvent(event), at) : watch;
      }
      if (event.batch !== null && event.batch !== void 0) return Object.assign({}, watch, { ambiguous: true });
      return watch;
    }
    if (event.kind === "blob") {
      if (watch.ambiguous || typeof event.url !== "string") return watch;
      return Object.assign({}, watch, { blobs: watch.blobs.concat([event.url]) });
    }
    if (event.kind === "blur") return event.visible === false ? watch : Object.assign({}, watch, { away: true });
    if (event.kind === "visibility") return event.visible === false ? Object.assign({}, watch, { away: false }) : watch;
    if (event.kind === "focus") {
      if (watch.away && event.hasFocus === true) {
        return decide(watch, "confirmed", "", "the browser window lost focus and got it back after the press: a Save window opened and closed", at);
      }
      return watch;
    }
    if (event.kind === "resource") {
      return isFileResource(event, watch.pressedAt) ? decide(watch, "confirmed", "", describeEvent(event), at) : watch;
    }
    if (event.kind === "anchor") {
      if (!watch.ambiguous && watch.blobs.indexOf(String(event.href)) >= 0) {
        return decide(watch, "confirmed", "", "a blob was made and a link to it clicked" + (event.download ? ", saving as " + event.download : ""), at);
      }
      return watch;
    }
    return watch;
  }

  // src/lib/batch/wrappers.js
  function methodOf(input, init) {
    const named2 = init && init.method || input && typeof input === "object" && input.method || "GET";
    return String(named2).toUpperCase();
  }
  function urlOf(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return String(input);
  }
  function headerOf(response, name) {
    try {
      const headers = response && response.headers;
      const value = headers && typeof headers.get === "function" ? headers.get(name) : null;
      return value == null ? "" : String(value);
    } catch {
      return "";
    }
  }
  function drainCopy(response, finished) {
    let reader = null;
    try {
      const copy = response.clone();
      const body = copy && copy.body;
      if (!body || typeof body.getReader !== "function") {
        finished(null);
        return;
      }
      reader = body.getReader();
    } catch (error) {
      finished(error);
      return;
    }
    const pump = () => {
      try {
        reader.read().then(
          (step) => {
            if (step && step.done) finished(null);
            else pump();
          },
          (error) => finished(error || new Error("the download broke off"))
        );
      } catch (error) {
        finished(error);
      }
    };
    pump();
  }
  function sameShape(wrapper, original) {
    try {
      Object.defineProperty(wrapper, "length", { value: original.length });
    } catch {
    }
    return wrapper;
  }
  function installWrappers(scope, sink) {
    const done = { fetch: false, xhr: false, blob: false, anchor: false };
    if (!scope || !sink) return done;
    const tagNow = () => {
      try {
        const tag2 = sink.tag();
        return typeof tag2 === "number" && Number.isFinite(tag2) ? tag2 : null;
      } catch {
        return null;
      }
    };
    const timeNow = () => {
      try {
        return sink.now();
      } catch {
        return NaN;
      }
    };
    const baseNow = () => {
      try {
        return String(sink.base() || "");
      } catch {
        return "";
      }
    };
    const tell = (event) => {
      try {
        sink.note(event);
      } catch {
      }
    };
    function followFetch(result, request) {
      if (!result || typeof result.then !== "function") return;
      const after = result.then((response) => {
        try {
          const event = {
            kind: "response",
            via: "fetch",
            batch: request.tag,
            method: request.method,
            url: request.url,
            status: response && typeof response.status === "number" ? response.status : 0,
            contentType: headerOf(response, "content-type"),
            disposition: headerOf(response, "content-disposition"),
            at: NaN,
            failed: false
          };
          if (!isFileResponse(event)) {
            event.at = timeNow();
            tell(event);
            return;
          }
          tell(Object.assign({}, event, { kind: "incoming", at: timeNow() }));
          drainCopy(response, (error) => {
            event.at = timeNow();
            event.failed = !!error;
            tell(event);
          });
        } catch {
        }
      }, () => {
        tell({
          kind: "response",
          via: "fetch",
          batch: request.tag,
          method: request.method,
          url: request.url,
          status: 0,
          contentType: "",
          disposition: "",
          at: timeNow(),
          failed: true
        });
      });
      if (after && typeof after.catch === "function") after.catch(() => {
      });
    }
    try {
      const originalFetch = scope.fetch;
      if (typeof originalFetch === "function") {
        scope.fetch = sameShape(function fetch(input, init) {
          let request = null;
          try {
            const tag2 = tagNow();
            if (tag2 !== null) request = { tag: tag2, method: methodOf(input, init), url: shortUrl(urlOf(input), baseNow()) };
          } catch {
            request = null;
          }
          const result = originalFetch.apply(this, arguments);
          if (request) {
            try {
              followFetch(result, request);
            } catch {
            }
          }
          return result;
        }, originalFetch);
        done.fetch = true;
      }
    } catch {
      done.fetch = false;
    }
    function xhrEvent(xhr, request, kind) {
      let raw = "";
      try {
        raw = xhr.getAllResponseHeaders() || "";
      } catch {
        raw = "";
      }
      const head = headersFromRaw(raw);
      const status = typeof xhr.status === "number" ? xhr.status : 0;
      let address = request.url;
      try {
        if (xhr.responseURL) address = String(xhr.responseURL);
      } catch {
        address = request.url;
      }
      return {
        kind,
        via: "xhr",
        batch: request.tag,
        method: request.method,
        url: shortUrl(address, baseNow()),
        status,
        contentType: head.contentType,
        disposition: head.disposition,
        at: timeNow(),
        failed: kind === "response" && status === 0
      };
    }
    function xhrStep(xhr, request) {
      if (request.tag === null || request.finished) return;
      const state = xhr.readyState;
      if (state >= 2 && !request.announced) {
        request.announced = true;
        const arriving = xhrEvent(xhr, request, "incoming");
        if (isFileResponse(arriving)) tell(arriving);
      }
      if (state === 4) {
        request.finished = true;
        tell(xhrEvent(xhr, request, "response"));
      }
    }
    function listen(xhr, request) {
      if (request.listening || typeof xhr.addEventListener !== "function") return;
      request.listening = true;
      xhr.addEventListener("readystatechange", () => {
        try {
          xhrStep(xhr, request);
        } catch {
        }
      });
    }
    try {
      const XHR = scope.XMLHttpRequest;
      const proto = XHR && XHR.prototype;
      const originalOpen = proto && proto.open;
      const originalSend = proto && proto.send;
      if (typeof originalOpen === "function" && typeof originalSend === "function") {
        const requests = /* @__PURE__ */ new WeakMap();
        proto.open = sameShape(function open(method, url) {
          try {
            const request = {
              method: String(method || "GET").toUpperCase(),
              url: String(url),
              tag: null,
              announced: false,
              finished: false,
              listening: false
            };
            requests.set(this, request);
            if (tagNow() !== null) listen(this, request);
          } catch {
          }
          return originalOpen.apply(this, arguments);
        }, originalOpen);
        proto.send = sameShape(function send() {
          try {
            const tag2 = tagNow();
            const request = requests.get(this);
            if (tag2 !== null && request) {
              request.tag = tag2;
              listen(this, request);
            }
          } catch {
          }
          return originalSend.apply(this, arguments);
        }, originalSend);
        done.xhr = true;
      }
    } catch {
      done.xhr = false;
    }
    try {
      const Addresses = scope.URL;
      const originalCreate = Addresses && Addresses.createObjectURL;
      if (typeof originalCreate === "function") {
        Addresses.createObjectURL = sameShape(function createObjectURL(object) {
          const made = originalCreate.apply(this, arguments);
          try {
            const tag2 = tagNow();
            if (tag2 !== null) {
              tell({
                kind: "blob",
                at: timeNow(),
                batch: tag2,
                url: String(made),
                type: object && typeof object.type === "string" ? object.type : "",
                size: object && typeof object.size === "number" ? object.size : null
              });
            }
          } catch {
          }
          return made;
        }, originalCreate);
        done.blob = true;
      }
    } catch {
      done.blob = false;
    }
    try {
      const Anchor = scope.HTMLAnchorElement;
      const proto = Anchor && Anchor.prototype;
      const originalClick = proto && proto.click;
      if (typeof originalClick === "function") {
        proto.click = sameShape(function click() {
          try {
            const tag2 = tagNow();
            if (tag2 !== null) {
              tell({
                kind: "anchor",
                at: timeNow(),
                batch: tag2,
                href: String(this.href || ""),
                download: typeof this.getAttribute === "function" ? String(this.getAttribute("download") || "") : ""
              });
            }
          } catch {
          }
          return originalClick.apply(this, arguments);
        }, originalClick);
        done.anchor = true;
      }
    } catch {
      done.anchor = false;
    }
    return done;
  }
  function installStartWrappers(scope, sink) {
    const done = { open: false, submit: false, frame: false };
    if (!scope || !sink) return done;
    const report = (kind, details) => {
      try {
        const waiting = sink.tag();
        if (typeof waiting !== "number" || !Number.isFinite(waiting)) return;
        let when = NaN;
        try {
          when = sink.now();
        } catch {
          when = NaN;
        }
        sink.note(Object.assign({ kind, at: when, batch: waiting }, details));
      } catch {
      }
    };
    try {
      const originalOpen = scope.open;
      if (typeof originalOpen === "function") {
        scope.open = sameShape(function open(url) {
          report("open", { url: String(url == null ? "" : url) });
          return originalOpen.apply(this, arguments);
        }, originalOpen);
        done.open = true;
      }
    } catch {
      done.open = false;
    }
    try {
      const Form = scope.HTMLFormElement;
      const formProto = Form && Form.prototype;
      for (const name of ["submit", "requestSubmit"]) {
        const original = formProto && formProto[name];
        if (typeof original !== "function") continue;
        formProto[name] = sameShape(function() {
          report("submit", { url: String(this.action || ""), method: String(this.method || "get").toUpperCase(), via: name });
          return original.apply(this, arguments);
        }, original);
        done.submit = true;
      }
    } catch {
    }
    try {
      const Frame = scope.HTMLIFrameElement;
      const frameProto = Frame && Frame.prototype;
      const held = frameProto && Object.getOwnPropertyDescriptor(frameProto, "src");
      if (held && typeof held.set === "function" && held.configurable) {
        Object.defineProperty(frameProto, "src", {
          get: held.get,
          set(value) {
            report("iframe", { url: String(value) });
            return held.set.call(this, value);
          },
          configurable: true,
          enumerable: held.enumerable
        });
        done.frame = true;
      }
      const originalSet = frameProto && frameProto.setAttribute;
      if (typeof originalSet === "function") {
        frameProto.setAttribute = sameShape(function setAttribute(name, value) {
          if (String(name).toLowerCase() === "src") report("iframe", { url: String(value) });
          return originalSet.apply(this, arguments);
        }, originalSet);
        done.frame = true;
      }
    } catch {
    }
    return done;
  }

  // src/lib/batch/settings.js
  function origin(href) {
    return new URL(String(href)).origin;
  }
  function readRaw(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  function writeRaw(storage, key, value) {
    try {
      if (!storage) return false;
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  function readJson(storage, key) {
    const raw = readRaw(storage, key);
    try {
      return typeof raw === "string" && raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  var START_PREFIX = "qs-intelligence start row ";
  var startKey = (href) => START_PREFIX + origin(href);
  function readStart(storage, key) {
    const raw = readRaw(storage, key);
    return wholeNumber(raw === null || raw === "" ? NaN : raw, 1);
  }
  function writeStart(storage, key, value) {
    return writeRaw(storage, key, String(wholeNumber(value, 1)));
  }
  var FORMATS_PREFIX = "qs-intelligence file types ";
  var ONE_FORMAT = new RegExp("^" + LOOKS_LIKE_A_FILE.source + "$", "i");
  var formatsKey = (href) => FORMATS_PREFIX + origin(href);
  function wantsFormat(chosen, format) {
    if (!Array.isArray(chosen)) return true;
    return chosen.indexOf(String(format == null ? "" : format).toUpperCase()) >= 0;
  }
  function formatCounts(identities) {
    const counts = /* @__PURE__ */ new Map();
    for (const each of identities || []) {
      const format = String(each && each.format || "").toUpperCase();
      if (format) counts.set(format, (counts.get(format) || 0) + 1);
    }
    return Array.from(counts, ([format, rows]) => ({ format, rows })).sort((a, b) => b.rows - a.rows || (a.format < b.format ? -1 : a.format > b.format ? 1 : 0));
  }
  function toggleFormat(chosen, format, shown) {
    const name = String(format == null ? "" : format).toUpperCase();
    const types = (shown || []).map((each) => String(each).toUpperCase());
    const next = Array.isArray(chosen) ? chosen.slice() : types.slice();
    const at = next.indexOf(name);
    if (at >= 0) next.splice(at, 1);
    else next.push(name);
    const every = types.length > 0 && types.every((each) => next.indexOf(each) >= 0);
    return every ? null : next;
  }
  function andList(list) {
    if (list.length <= 1) return list.join("");
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }
  function describeFormats(chosen) {
    if (!Array.isArray(chosen)) return "Every file type.";
    if (!chosen.length) return "No file type switched on.";
    return "Only " + andList(chosen) + ".";
  }
  function readFormats(storage, key) {
    const held = readJson(storage, key);
    if (!Array.isArray(held)) return null;
    const out = [];
    for (const each of held) {
      if (typeof each !== "string" || !ONE_FORMAT.test(each)) continue;
      const name = each.toUpperCase();
      if (out.indexOf(name) < 0) out.push(name);
    }
    return out;
  }
  function writeFormats(storage, key, chosen) {
    return writeRaw(storage, key, Array.isArray(chosen) ? JSON.stringify(chosen) : null);
  }
  var ZIP_AUTO_PREFIX = "qs-intelligence zip auto ";
  var ZIP_AUTO_HOURS = 2;
  var zipAutoKey = (href) => ZIP_AUTO_PREFIX + origin(href);
  function readZipAuto(storage, key, now) {
    const raw = readRaw(storage, key);
    const since = Number(raw);
    return raw !== null && Number.isFinite(since) && since > 0 && now >= since && now - since < ZIP_AUTO_HOURS * 36e5;
  }
  function writeZipAuto(storage, key, on, now) {
    return writeRaw(storage, key, on ? String(now) : null);
  }
  var ZIP_LIMIT_PREFIX = "qs-intelligence zip limit ";
  var DEFAULT_ZIP_LIMIT = 50;
  var zipLimitKey = (href) => ZIP_LIMIT_PREFIX + origin(href);
  function readZipLimit(storage, key) {
    const raw = readRaw(storage, key);
    return wholeNumber(raw === null || raw === "" ? NaN : raw, DEFAULT_ZIP_LIMIT);
  }
  function writeZipLimit(storage, key, value) {
    return writeRaw(storage, key, String(wholeNumber(value, DEFAULT_ZIP_LIMIT)));
  }
  var BUTTON_PREFIX = "qs-intelligence download button ";
  var buttonKey = (href) => BUTTON_PREFIX + origin(href);
  var wholeChain = (chain) => Array.isArray(chain) && chain.length > 0 && chain.every((segment) => segment && typeof segment.tag === "string" && segment.tag && Array.isArray(segment.classes));
  function readButtonRecord(storage, key) {
    const held = readJson(storage, key);
    if (!held || typeof held !== "object" || Array.isArray(held) || typeof held.words !== "string" || !held.words || !wholeChain(held.chain)) {
      return null;
    }
    return held;
  }
  function writeButtonRecord(storage, key, record) {
    return writeRaw(storage, key, record ? JSON.stringify(record) : null);
  }
  var TARGET_PREFIX = "pz-batch item ";
  var targetKey = (href) => TARGET_PREFIX + origin(href);
  function readTargetRecord(storage, key) {
    const held = readJson(storage, key);
    if (!held || typeof held !== "object" || Array.isArray(held) || held.kind !== "box" && held.kind !== "button" || typeof held.tag !== "string" || !held.tag || !wholeChain(held.chain)) {
      return null;
    }
    return held;
  }
  function writeTargetRecord(storage, key, record) {
    return writeRaw(storage, key, record ? JSON.stringify(record) : null);
  }

  // src/lib/batch/target.js
  var SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  var STATE_CLASS = /(^|[-_])(is|has)[-_]|active|checked|selected|disabled|hover|focus|open|added|current|loading|ticked|visited/i;
  function labelOf(node) {
    if (!node) return "";
    const named2 = typeof node.getAttribute === "function" ? node.getAttribute("aria-label") || node.getAttribute("title") : "";
    const shown = typeof node.innerText === "string" ? node.innerText : node.textContent;
    return collapse(shown || node.value || named2 || "");
  }
  function buttonWords(text) {
    return collapse(String(text == null ? "" : text).replace(/[\d()[\]{}:]+/g, " ")).toLowerCase();
  }
  function classesOf(node) {
    const raw = typeof node.className === "string" ? node.className : typeof node.getAttribute === "function" ? node.getAttribute("class") || "" : "";
    return raw.split(/\s+/).filter((name) => SAFE_NAME.test(name) && !/\d/.test(name));
  }
  function segmentOf(node, dropState = false) {
    const tag2 = String(node.tagName || "").toLowerCase();
    const id = typeof node.id === "string" && SAFE_NAME.test(node.id) && !/\d/.test(node.id) ? node.id : "";
    let classes2 = classesOf(node);
    if (dropState) classes2 = classes2.filter((name) => !STATE_CLASS.test(name));
    return { tag: tag2, id, classes: classes2.slice(0, 3) };
  }
  function chainOf(node, dropState = false) {
    const chain = [];
    for (let at = node; at && chain.length < 4; at = at.parentElement) {
      const segment = segmentOf(at, dropState);
      if (!segment.tag || segment.tag === "body" || segment.tag === "html") break;
      chain.push(segment);
      if (segment.id) break;
    }
    return chain;
  }
  function pathOf(chain) {
    return chain.slice().reverse().map(
      (segment) => segment.tag + (segment.id ? "#" + segment.id : "") + segment.classes.map((name) => "." + name).join("")
    ).join(" > ");
  }
  function describeButton(node) {
    const text = labelOf(node);
    const chain = chainOf(node);
    return { words: buttonWords(text), text: text.slice(0, 60), path: pathOf(chain), chain };
  }
  function chainScore(node, chain) {
    let score = 0;
    let at = node;
    for (let level = 0; level < chain.length && at; level++) {
      const want = chain[level];
      const have = segmentOf(at);
      if (have.tag !== want.tag || want.id && have.id !== want.id) return level === 0 ? -1 : score;
      score += 1 + have.classes.filter((name) => want.classes.indexOf(name) >= 0).length;
      at = at.parentElement;
    }
    return score;
  }
  function locateButton(record, candidates, usable) {
    if (!record || !record.words || !Array.isArray(record.chain) || !record.chain.length) return null;
    let best = null;
    let bestScore = -1;
    for (const node of candidates || []) {
      if (!node || typeof usable === "function" && !usable(node)) continue;
      if (buttonWords(labelOf(node)) !== record.words) continue;
      const score = chainScore(node, record.chain);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }
  function pickButton(record, locate, automatic) {
    if (record) {
      const found = locate(record);
      if (found) return { button: found, source: "selected", lost: false };
    }
    const fallback = automatic() || null;
    return { button: fallback, source: fallback ? "automatic" : "none", lost: !!record };
  }
  function describeUse(use, text) {
    const named2 = text ? ' "' + collapse(text).slice(0, 30) + '"' : "";
    if (use && use.source === "selected") return "Download button: yours" + named2 + ".";
    if (use && use.source === "automatic") {
      return (use.lost ? "Your download button isn't here; using" : "Download button: found") + named2 + ".";
    }
    return (use && use.lost ? "Your download button isn't here." : "No download button found.") + " Pick it with \u2B07.";
  }
  var BOX_LIKE = 'input[type="checkbox"], [role="checkbox"], [role="switch"], [aria-checked]';
  var BUTTON_LIKE = 'button, a[href], [role="button"], input[type="button"], input[type="submit"]';
  var LOOSE_CLICKABLE = '[onclick], [class*="btn"], [class*="button"]';
  var BOX_CLASS = '[class*="check"], [class*="tick"], [class*="toggle"], [class*="switch"]';
  function resolveTarget(el) {
    if (!el || el.nodeType !== 1 || typeof el.closest !== "function") return null;
    const label = el.closest("label");
    const control2 = label && label.control;
    if (control2 && String(control2.type).toLowerCase() === "checkbox") return { node: control2, kind: "box" };
    const box = el.closest(BOX_LIKE);
    if (box) return { node: box, kind: "box" };
    const button3 = el.closest(BUTTON_LIKE);
    if (button3) return { node: button3, kind: "button" };
    for (let at = el, step = 0; at && step < 3; at = at.parentElement, step++) {
      const inside = typeof at.querySelectorAll === "function" ? at.querySelectorAll('input[type="checkbox"]') : [];
      if (inside.length === 1) return { node: inside[0], kind: "box" };
      if (inside.length > 1) break;
    }
    const drawn = el.closest(BOX_CLASS);
    if (drawn && collapse(drawn.textContent).length <= 40) return { node: drawn, kind: "box" };
    return { node: el.closest(LOOSE_CLICKABLE) || el, kind: "button" };
  }
  function describeTarget(node, kind) {
    const tag2 = String(node.tagName || "").toLowerCase();
    const type = tag2 === "input" ? String(node.type || "").toLowerCase() : "";
    const role = typeof node.getAttribute === "function" ? node.getAttribute("role") || "" : "";
    const href = tag2 === "a" && typeof node.getAttribute === "function" ? node.getAttribute("href") || "" : "";
    return {
      kind,
      tag: tag2,
      type,
      role,
      chain: chainOf(node, true),
      words: kind === "button" ? buttonWords(labelOf(node)) : "",
      // A plain link with no download attribute may take the page away.
      link: kind === "button" && !!href && !/^(#|javascript:)/i.test(href) && node.getAttribute("download") === null && node.getAttribute("target") !== "_blank"
    };
  }
  var NOT_A_KIND = /(^|-)(id|key|index|idx|row|pos|position|track|tracking|gtm|ga|analytics|event|testid|test)(-|$)/i;
  var INSIDE_DEPTH = 4;
  var INSIDE_MOST = 40;
  function attr2(node, name) {
    try {
      return typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
    } catch {
      return null;
    }
  }
  function classes(node) {
    return classesOf(node).filter((name) => !STATE_CLASS.test(name));
  }
  function basename(url) {
    const clean = String(url || "").split(/[?#]/)[0].split(/\s/)[0];
    return clean.slice(clean.lastIndexOf("/") + 1).toLowerCase();
  }
  function shape(svg) {
    let text = "";
    try {
      for (const part of svg.querySelectorAll("path, polygon, polyline, circle, rect, line")) {
        text += (attr2(part, "d") || attr2(part, "points") || part.nodeName) + "|";
        if (text.length > 400) break;
      }
    } catch {
      return "";
    }
    let hash = 0;
    for (let at = 0; at < text.length; at++) hash = hash * 31 + text.charCodeAt(at) | 0;
    return text ? (hash >>> 0).toString(36) : "";
  }
  function labelTrait(value) {
    const words = buttonWords(value);
    return words && words.length <= 40 ? words : "";
  }
  function traitsOf(node) {
    const out = /* @__PURE__ */ new Set();
    if (!node || node.nodeType !== 1) return out;
    for (const name of classes(node)) out.add("c:" + name);
    const words = buttonWords(labelOf(node));
    if (words && words.length <= 40) out.add("w:" + words);
    const seen = [node];
    const walk = (at, depth) => {
      if (depth > INSIDE_DEPTH) return;
      for (let child = at.firstElementChild; child && seen.length < INSIDE_MOST; child = child.nextElementSibling) {
        seen.push(child);
        for (const name of classes(child)) out.add("i:" + name);
        walk(child, depth + 1);
      }
    };
    walk(node, 1);
    for (const each of seen) {
      const tag2 = String(each.nodeName || "").toLowerCase();
      for (const name of ["aria-label", "title", "alt"]) {
        const said = labelTrait(attr2(each, name));
        if (said) out.add("l:" + said);
      }
      for (const item of Array.from(each.attributes || [])) {
        const name = String(item.name || "");
        if (!/^data-/.test(name) || /\d/.test(name) || NOT_A_KIND.test(name.slice(5))) continue;
        const value = collapse(item.value).toLowerCase();
        if (value.length > 30 || /\d{3,}/.test(value)) continue;
        out.add("d:" + name + "=" + value);
      }
      if (tag2 === "img" || tag2 === "source") {
        const file2 = basename(attr2(each, "src") || attr2(each, "srcset"));
        if (file2) out.add("img:" + file2);
      }
      if (tag2 === "use") {
        const ref = attr2(each, "href") || attr2(each, "xlink:href");
        if (ref) out.add("use:" + ref.slice(ref.indexOf("#")));
      }
      if (tag2 === "svg") {
        const drawn = shape(each);
        if (drawn) out.add("svg:" + drawn);
      }
    }
    let link = null;
    try {
      link = node.closest ? node.closest("a[href]") || (node.querySelector ? node.querySelector("a[href]") : null) : null;
    } catch {
      link = null;
    }
    const file = link ? basename(attr2(link, "href")) : "";
    const ext = /\.([a-z0-9]{2,5})$/i.exec(file);
    if (ext && !/^(html?|php|aspx?|jsp)$/i.test(ext[1])) out.add("ext:" + ext[1].toLowerCase());
    return out;
  }
  function hasTraits(node, variant, traits = traitsOf(node)) {
    if (!variant) return true;
    for (const trait of variant.none || []) if (traits.has(trait)) return false;
    const kinds = variant.kinds || [];
    return !kinds.length || kinds.some((kind) => (kind.all || []).every((trait) => traits.has(trait)));
  }
  function matchesTarget(node, record) {
    if (!node || !record || node.nodeType !== 1) return false;
    if (String(node.tagName || "").toLowerCase() !== record.tag) return false;
    if (record.type && String(node.type || "").toLowerCase() !== record.type) return false;
    if (record.role && (node.getAttribute("role") || "") !== record.role) return false;
    let at = node;
    for (const want of record.chain) {
      if (!at) return false;
      const tag2 = String(at.tagName || "").toLowerCase();
      if (tag2 !== want.tag) return false;
      if (want.id && at.id !== want.id) return false;
      if (want.classes.length) {
        const have = classesOf(at);
        if (!want.classes.some((name) => have.indexOf(name) >= 0)) return false;
      }
      at = at.parentElement;
    }
    if (record.variant && record.variantOn !== false && !hasTraits(node, record.variant)) return false;
    return true;
  }
  var SWALLOWED = ["pointerdown", "mousedown", "pointerup", "mouseup"];
  function armCapture(target, isOurs, picked) {
    let armed = true;
    const ours = (event) => {
      try {
        return !!isOurs(event.target);
      } catch {
        return false;
      }
    };
    const hold = (event) => {
      if (!event) return;
      try {
        event.preventDefault();
      } catch {
      }
      try {
        event.stopPropagation();
      } catch {
      }
      try {
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      } catch {
      }
    };
    function swallow(event) {
      if (!armed || !event || event.isTrusted !== true || ours(event)) return;
      hold(event);
    }
    function listener(event) {
      if (!armed || !event || event.isTrusted !== true || ours(event)) return;
      disarm();
      hold(event);
      picked(event.target);
    }
    function disarm() {
      if (!armed) return;
      armed = false;
      try {
        target.removeEventListener("click", listener, true);
        for (const type of SWALLOWED) target.removeEventListener(type, swallow, true);
      } catch {
      }
    }
    target.addEventListener("click", listener, true);
    for (const type of SWALLOWED) target.addEventListener(type, swallow, true);
    return disarm;
  }

  // src/lib/batch/selection.js
  var SELECTION_WAIT = 5;
  var SELECTION_POLL = 0.05;
  function wordsOf(node) {
    const shown = typeof node.innerText === "string" ? node.innerText : node.textContent;
    return collapse(shown || node.value || "");
  }
  function findRow(chosen, live, sameBoxWillDo) {
    let byText = null;
    for (const each of live) {
      if (each.identity.id !== chosen.identity.id) continue;
      if (each.box === chosen.box) return each;
      if (!byText) byText = each;
    }
    if (byText || !sameBoxWillDo) return byText;
    for (const each of live) if (each.box === chosen.box) return each;
    return null;
  }
  function isReady(button3) {
    if (!button3 || button3.disabled === true) return false;
    const said = typeof button3.getAttribute === "function" ? button3.getAttribute("aria-disabled") : null;
    return said !== "true";
  }
  function setTicked(each, wanted) {
    if (isTicked(each.box) !== wanted) clickBox(each.box);
  }
  function untickChosen(chosen, env) {
    let live = null;
    for (const each of chosen) {
      if (each.box && each.box.isConnected !== false) {
        setTicked(each, false);
        continue;
      }
      if (!live) live = env.rows();
      const found = findRow(each, live, true);
      if (found) setTicked(found, false);
    }
  }
  function selectionProblem(size, button3, count, missing, reclicked, strays) {
    const said = [];
    if (!button3) said.push("no download button (pick one with \u2B07)");
    else if (!isReady(button3)) said.push("the download button stayed disabled");
    if (count !== null && count !== size) {
      said.push(`the button reads "${wordsOf(button3)}" for a batch of ${size}` + (count > size ? "; clear other ticks by hand" : ""));
    }
    if (missing) said.push(`${missing} row(s) gone`);
    if (reclicked) said.push(`${reclicked} box(es) would not stay ticked`);
    if (strays) said.push(`${strays} other box(es) ticked`);
    return `The page did not take the selection: ${said.join("; ")}. Nothing pressed. Play to try again, or lower the batch size.`;
  }
  async function takeSelection(chosen, env) {
    const halted = () => typeof env.halted === "function" && env.halted() === true;
    let everyRow = null;
    const allRows = () => {
      if (!everyRow) everyRow = env.rows();
      return everyRow;
    };
    const resolve = (each) => {
      if (typeof env.locate === "function") {
        const quick = env.locate(each);
        if (quick) return quick;
      }
      return findRow(each, allRows(), false);
    };
    let problem = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      everyRow = null;
      for (const each of chosen) {
        const found = resolve(each);
        if (found) setTicked(found, true);
      }
      const until = env.now() + SELECTION_WAIT * 1e3;
      for (; ; ) {
        if (halted()) return { ok: false, halted: true, problem: "" };
        everyRow = null;
        const found = chosen.map(resolve);
        const missing = found.filter((each) => !each).length;
        let reclicked = 0;
        for (const each of found) {
          if (each && !isTicked(each.box)) {
            clickBox(each.box);
            reclicked++;
          }
        }
        const ours = new Set(found.filter(Boolean).map((each) => each.box));
        let strays = 0;
        const ticked = typeof env.checked === "function" ? env.checked() : allRows().filter((each) => isTicked(each.box));
        for (const each of ticked) {
          if (isTicked(each.box) && !ours.has(each.box)) {
            clickBox(each.box);
            strays++;
          }
        }
        const button3 = env.button(everyRow) || null;
        const count = button3 ? countFromButtonText(wordsOf(button3)) : null;
        if (isReady(button3) && !missing && !reclicked && !strays && (count === null || count === chosen.length)) {
          return { ok: true, halted: false, button: button3, count };
        }
        problem = selectionProblem(chosen.length, button3, count, missing, reclicked, strays);
        if (env.now() >= until) break;
        await env.sleep(SELECTION_POLL);
      }
      untickChosen(chosen, { rows: allRows });
      await env.sleep(1);
    }
    return { ok: false, halted: false, problem };
  }
  function rowsToSelect(live, types, start) {
    const from = wholeNumber(start, 1);
    const scope = from > 1 ? (live || []).slice(from - 1) : live || [];
    return scope.filter((each) => wantsFormat(types, each.identity.format));
  }
  function allTicked(rows) {
    return rows.length > 0 && rows.every((each) => isTicked(each.box) === true);
  }
  function selectAllLabel(rows) {
    return allTicked(rows) ? "Untick all" : "Select all";
  }
  function tickAll(rows, usable) {
    const untick = allTicked(rows);
    const done = { untick, changed: 0, passed: 0, rows: rows.length };
    for (const each of rows) {
      if (isTicked(each.box) === !untick) continue;
      if (!untick && typeof usable === "function" && usable(each) === false) {
        done.passed += 1;
        continue;
      }
      clickBox(each.box);
      done.changed += 1;
    }
    return done;
  }
  function selectAllReport(done, kept, button3) {
    if (done.untick) return `Unticked ${done.changed}.` + (kept ? ` ${kept} stayed ticked: press again.` : "");
    if (!done.rows) return "No rows to select.";
    const wanted = done.rows - done.passed;
    const passed = done.passed ? ` (${done.passed} hidden, passed over)` : "";
    if (kept < wanted) {
      return `Only ${kept} of ${wanted} stayed ticked${passed}. Press again; if it will not rise, the page caps a selection, so use Play.`;
    }
    const named2 = collapse(button3).slice(0, 30);
    return `Selected ${kept} of ${done.rows}${passed}. Now press the page's download button` + (named2 ? ` ("${named2}")` : "") + ".";
  }

  // src/lib/batch/runner.js
  var DEFAULT_BATCH = 10;
  var DEFAULT_TIMEOUT = 90;
  var DEFAULT_SETTLE = 1;
  var DEFAULT_RETRY_BATCH = 3;
  var MISSES_BEFORE_STOPPING = 3;
  var MAX_LOAD_MORE = 500;
  function quietly(work) {
    try {
      return work();
    } catch {
      return void 0;
    }
  }
  function endOfPage(batches, counts, alone) {
    if (!counts.rows && !alone) return "No rows found.";
    return (batches ? `Done: ${batches} batch(es).` : "Nothing to do here.") + (counts.unconfirmed ? ` ${counts.unconfirmed} unconfirmed: Play retries them.` : " Next page, then Play.") + (alone ? ` ${alone} of other file types left.` : "");
  }
  function leftAlone(scope, types, ledger) {
    const others = scope.filter((each) => !wantsFormat(types, each.identity.format)).map((each) => each.identity);
    const counts = pageCounts(others, ledger);
    return counts.todo + counts.unconfirmed;
  }
  function createRunner(deps) {
    let state = "idle";
    let stopAsked = false;
    let ended = Promise.resolve();
    const show = (next) => {
      state = next;
      quietly(() => deps.showState(next));
    };
    const say = (text) => quietly(() => deps.say(text));
    const refresh = () => quietly(() => deps.refresh());
    const halted = () => stopAsked || state === "pausing";
    function formatsNow() {
      if (typeof deps.formats !== "function") return null;
      const types = quietly(() => deps.formats());
      return Array.isArray(types) ? types : null;
    }
    function saveList() {
      const documents = quietly(() => deps.siteDocuments()) || 0;
      if (!documents) return "Ledger empty, so no list to save.";
      const name = quietly(() => deps.saveExport());
      return name ? `Saved ${name}.` : "The list could not be saved.";
    }
    function usableFirst(eligible, live, size) {
      if (typeof deps.page.usable !== "function") return eligible.slice(0, size);
      const byId = new Map(live.map((each) => [each.identity.id, each]));
      const out = [];
      for (let at = 0; at < eligible.length && out.length < size; at++) {
        const row3 = byId.get(eligible[at].id);
        const fit = row3 ? quietly(() => deps.page.usable(row3)) : false;
        if (fit !== false) out.push(eligible[at]);
      }
      return out;
    }
    async function loop() {
      const retried = /* @__PURE__ */ new Set();
      let allLoaded = false;
      let loadPresses = 0;
      let batches = 0;
      let misses = 0;
      let ending = "";
      let saveAtEnd = false;
      let lastEnd = null;
      let between = {};
      try {
        if (typeof deps.begin === "function") deps.begin();
        const store = deps.store();
        const settings = deps.settings();
        for (; ; ) {
          if (stopAsked) {
            ending = "Stopped.";
            saveAtEnd = true;
            break;
          }
          if (state === "pausing") {
            ending = "Paused. Play carries on.";
            break;
          }
          const types = formatsNow();
          if (Array.isArray(types) && !types.length) {
            ending = describeFormats(types);
            saveAtEnd = batches > 0;
            break;
          }
          const start = wholeNumber(settings.startAt, 1);
          say("Reading rows\u2026");
          const readStart2 = deps.now();
          const live = deps.page.rows();
          const readMs = deps.now() - readStart2;
          const scope = start > 1 ? live.slice(start - 1) : live;
          const identities = scope.filter((each) => wantsFormat(types, each.identity.format)).map((each) => each.identity);
          const ledger = store.read();
          let mode = "fresh";
          let picked = usableFirst(chooseBatch(identities, ledger, identities.length, "fresh"), live, settings.size);
          if (!picked.length && !allLoaded && typeof deps.page.loadMore === "function") {
            const more = await deps.page.loadMore(halted) || {};
            loadPresses += more.pressed ? 1 : 0;
            if (more.pressed && more.grew && loadPresses < MAX_LOAD_MORE) {
              say(`Load more: +${more.after - more.before} rows.`);
            } else {
              allLoaded = true;
              if (more.pressed) say("Load more added nothing.");
            }
            continue;
          }
          if (!picked.length) {
            mode = "retry";
            const remaining = identities.filter((each) => !retried.has(each.id));
            picked = usableFirst(chooseBatch(remaining, ledger, remaining.length, "retry"), live, settings.retrySize);
          }
          if (!picked.length) {
            if (!live.length) {
              const why = typeof deps.page.explainNoRows === "function" ? quietly(() => deps.page.explainNoRows()) : "";
              ending = "No rows found." + (why ? " " + why : "");
            } else if (live.length < start) {
              ending = `No row ${start}: this page has ${live.length}. Lower "start at".`;
            } else {
              ending = endOfPage(batches, pageCounts(identities, ledger), leftAlone(scope, types, ledger));
            }
            saveAtEnd = batches > 0;
            break;
          }
          const wanted = new Set(picked.map((each) => each.id));
          const chosen = live.filter((each) => wanted.has(each.identity.id));
          const next = wholeNumber(ledger.nextBatch, 1);
          say(`Batch ${next}: ticking ${chosen.length}` + (mode === "retry" ? " (retry)" : "") + (Array.isArray(types) ? `, ${andList(types)} only` : "") + "\u2026");
          const takeStart = deps.now();
          let taken = await deps.page.take(chosen, halted);
          const takeMs = deps.now() - takeStart;
          if (!taken.ok) {
            deps.page.untick(chosen);
            if (taken.halted) continue;
            ending = taken.problem;
            break;
          }
          let quietMs = null;
          let stillChanging = false;
          if (typeof deps.page.quiet === "function") {
            say(`Batch ${next}: letting the page settle\u2026`);
            const calm = await deps.page.quiet(halted) || {};
            if (calm.halted) {
              deps.page.untick(chosen);
              continue;
            }
            quietMs = typeof calm.waitedMs === "number" ? calm.waitedMs : null;
            stillChanging = calm.quiet === false;
            taken = await deps.page.take(chosen, halted);
            if (!taken.ok) {
              deps.page.untick(chosen);
              if (taken.halted) continue;
              ending = taken.problem;
              break;
            }
          }
          const batch2 = store.nextBatch();
          const pressedAt = deps.now();
          const timing = Object.assign({
            after: lastEnd ? lastEnd.batch : null,
            handedOver: lastEnd ? lastEnd.confirmed : false,
            gapSeconds: lastEnd ? (pressedAt - lastEnd.at) / 1e3 : null,
            settleMs: null,
            untickMs: null,
            refreshMs: null
          }, between, { readMs, takeMs, quietMs, stillChanging });
          say(`Batch ${batch2}: pressed.`);
          const outcome = await deps.page.press(taken.button, batch2, settings.timeout, timing);
          lastEnd = { batch: batch2, at: deps.now(), confirmed: outcome.status === "confirmed" };
          between = {};
          const waited = Math.round((lastEnd.at - pressedAt) / 1e3);
          store.record(chosen.map((each) => each.identity), batch2, outcome.status, deps.iso(), {
            mode,
            waited,
            evidence: outcome.evidence,
            reason: outcome.reason,
            where: deps.where()
          });
          batches += 1;
          if (mode === "retry") for (const each of chosen) retried.add(each.identity.id);
          if (outcome.status === "confirmed") {
            misses = 0;
            say(`Batch ${batch2} \u2713 ${waited}s`);
            const settleStart = deps.now();
            await deps.sleep(settings.settle);
            between.settleMs = deps.now() - settleStart;
          } else {
            misses += 1;
            say(`Batch ${batch2} \u2717 ` + (outcome.reason === "timeout" ? `no file in ${settings.timeout}s` : outcome.reason) + `: ${chosen.length} unconfirmed`);
          }
          const untickStart = deps.now();
          deps.page.untick(chosen);
          between.untickMs = deps.now() - untickStart;
          const refreshStart = deps.now();
          refresh();
          between.refreshMs = deps.now() - refreshStart;
          if (misses >= MISSES_BEFORE_STOPPING) {
            ending = `Stopped: ${MISSES_BEFORE_STOPPING} batches in a row showed no file. See Details.`;
            saveAtEnd = true;
            break;
          }
        }
      } catch (error) {
        ending = "Stopped on a script fault: " + (error && error.message ? error.message : String(error)) + ".";
      }
      stopAsked = false;
      show("idle");
      quietly(() => {
        if (typeof deps.end === "function") deps.end();
      });
      if (saveAtEnd) ending += " " + saveList();
      refresh();
      say(ending);
    }
    return {
      state: () => state,
      play() {
        if (state === "pausing") {
          show("running");
          say("Carrying on.");
          return ended;
        }
        if (state !== "idle") return ended;
        stopAsked = false;
        show("running");
        ended = loop();
        return ended;
      },
      pause() {
        if (state !== "running") return ended;
        show("pausing");
        say("Pausing after this batch\u2026");
        return ended;
      },
      // Stop ends the wait at once and records the batch in hand unconfirmed.
      stop() {
        if (state === "idle") {
          say(saveList());
          return ended;
        }
        if (state === "stopping") return ended;
        stopAsked = true;
        show("stopping");
        say("Stopping\u2026");
        quietly(() => deps.page.abortWait());
        return ended;
      },
      // Forgets every ledger kept on this site, after deps.confirm says yes.
      reset() {
        if (state !== "idle") {
          say("Stop the run before Reset.");
          return false;
        }
        const documents = quietly(() => deps.siteDocuments()) || 0;
        if (!documents) {
          say("The ledger is already empty.");
          return false;
        }
        const agreed = quietly(() => deps.confirm(`Forget all ${documents} document(s) in this site's ledger? The next Play fetches every one again.`));
        if (agreed !== true) {
          say("Reset cancelled.");
          return false;
        }
        const cleared = quietly(() => deps.forgetSite()) === true;
        refresh();
        say(cleared ? `Forgot ${documents} document(s).` : "Forgotten here, but storage refused; a reload may bring it back.");
        return cleared;
      }
    };
  }
  var PLACES = "(zip|basket|downloads?|download\\s+(list|basket|cart|folder)|selection|cart|list|project|folder|collection|favou?rites|wish\\s*list|briefcase|library|pack|bundle|binder|board|documents?|bag)";
  var ADD_TEXT = new RegExp("^(\\+\\s*)?((add|save)(\\s+(it|this|item|file|document))?\\s+to\\s+(your\\s+|the\\s+|my\\s+)?" + PLACES + "\\b|(select|add)\\s+for\\s+download\\b)", "i");
  var IN_ZIP_TEXT = new RegExp("^(((remove|delete)\\s+from|(added|saved)\\s+to|in)\\s+(your\\s+|the\\s+|my\\s+)?" + PLACES + "\\b|added\\b|(saved|selected)!?$|\u2713)", "i");
  function isAddText(text) {
    const words = collapse(text);
    return words.length <= 30 && ADD_TEXT.test(words);
  }
  function isInZipText(text) {
    const words = collapse(text);
    return words.length <= 30 && IN_ZIP_TEXT.test(words);
  }
  var ZIP_PREFIX = "qs-intelligence zip ledger ";
  var ZIP_STATUSES = ["added", "refused", "silent"];
  function zipLedgerKey(href) {
    const where = new URL(String(href));
    return ZIP_PREFIX + where.origin + where.pathname;
  }
  function readZipLedger(storage, key) {
    const ledger = { version: 1, key, cards: {} };
    let held = null;
    try {
      const raw = storage ? storage.getItem(key) : null;
      held = typeof raw === "string" && raw ? JSON.parse(raw) : null;
    } catch {
      held = null;
    }
    if (!held || typeof held !== "object" || Array.isArray(held) || !held.cards || typeof held.cards !== "object" || Array.isArray(held.cards)) {
      return ledger;
    }
    for (const id of Object.keys(held.cards)) {
      const card = held.cards[id];
      if (card && typeof card === "object" && ZIP_STATUSES.indexOf(card.status) >= 0) putRow(ledger.cards, id, card);
    }
    return ledger;
  }
  function openZipStore(storage, key) {
    let memory = readZipLedger(storage, key);
    let saved = true;
    function read() {
      const stored = readZipLedger(storage, key);
      for (const id of Object.keys(stored.cards)) {
        if (!owns(memory.cards, id)) putRow(memory.cards, id, stored.cards[id]);
      }
      return memory;
    }
    return {
      key,
      read,
      record(card, status, why, at, where) {
        if (ZIP_STATUSES.indexOf(status) < 0) throw new Error(`an item is added, refused or silent, not "${status}"`);
        read();
        putRow(memory.cards, card.id, {
          title: String(card.title || "").slice(0, 240),
          status,
          why: String(why || ""),
          at,
          where: where || ""
        });
        try {
          if (!storage) throw new Error("no storage");
          storage.setItem(key, JSON.stringify(memory));
          saved = true;
        } catch {
          saved = false;
        }
        return memory;
      },
      saved: () => saved,
      forget() {
        memory = { version: 1, key, cards: {} };
        try {
          if (storage) storage.removeItem(key);
          return true;
        } catch {
          return false;
        }
      }
    };
  }
  var MAX_ZIP_PAGES = 500;
  function zipCounts(cards, ledger, inZip) {
    const counts = { cards: cards.length, added: 0, refused: 0, silent: 0, todo: 0 };
    for (const card of cards) {
      const held = ledger && owns(ledger.cards, card.id) ? ledger.cards[card.id] : null;
      if (held) counts[held.status] += 1;
      else if (typeof inZip === "function" && inZip(card) === true) counts.added += 1;
      else counts.todo += 1;
    }
    return counts;
  }
  function zipAddedCount(ledger) {
    return Object.keys(ledger.cards).filter((id) => ledger.cards[id].status === "added").length;
  }
  function zipSummary(counts, added) {
    return `${counts.cards} items \xB7 ${counts.added} done \xB7 ${counts.todo} to do` + (counts.refused ? ` \xB7 ${counts.refused} not clickable` : "") + (counts.silent ? ` \xB7 ${counts.silent} no change` : "") + ` \xB7 ${added} on site`;
  }
  function createClickRunner(deps) {
    let state = "idle";
    let sweeping = null;
    let again = false;
    let addedSincePlay = 0;
    let full = null;
    const say = (text) => quietly(() => deps.say(text));
    const show = (next) => {
      state = next;
      quietly(() => deps.showState(next));
    };
    function record(card, status, why) {
      deps.store.record(card, status, why, deps.iso(), deps.where());
      quietly(() => deps.page.paint(card, status));
    }
    function stateOf(card) {
      if (typeof deps.page.state === "function") return quietly(() => deps.page.state(card)) || "other";
      const words = quietly(() => card.words()) || "";
      if (isInZipText(words)) return "in";
      return isAddText(words) ? "ready" : "other";
    }
    function limitNow() {
      if (typeof deps.limit !== "function") return Infinity;
      return wholeNumber(quietly(() => deps.limit()), DEFAULT_ZIP_LIMIT);
    }
    function fullNow() {
      const limit = limitNow();
      if (!Number.isFinite(limit)) return null;
      let holds = null;
      if (typeof deps.zipHolds === "function") {
        const said = quietly(() => deps.zipHolds());
        holds = typeof said === "number" && Number.isFinite(said) && said >= 0 ? said : null;
      }
      const count = holds !== null ? holds : addedSincePlay;
      return count >= limit ? { count, limit, site: holds !== null } : null;
    }
    async function sweepOnce() {
      const cards = deps.page.cards();
      let pressed = 0;
      for (let at = 0; at < cards.length; at++) {
        if (state !== "running") break;
        const card = cards[at];
        const ledger = deps.store.read();
        const held = owns(ledger.cards, card.id) ? ledger.cards[card.id] : null;
        if (held && held.status === "added") {
          quietly(() => deps.page.paint(card, "added"));
          continue;
        }
        const now = stateOf(card);
        if (now === "in") {
          record(card, "added", "already done");
          continue;
        }
        if (now !== "ready") continue;
        if (held && held.status === "silent") {
          quietly(() => deps.page.paint(card, "silent"));
          continue;
        }
        if (quietly(() => card.clickable()) !== true) {
          record(card, "refused", "could not be clicked");
          continue;
        }
        full = fullNow();
        if (full) break;
        say(`Clicking ${at + 1} of ${cards.length}: ${String(card.title || "").slice(0, 40)}`);
        const outcome = await deps.page.press(card) || {};
        record(card, outcome.added ? "added" : "silent", outcome.why || "");
        if (outcome.added) addedSincePlay += 1;
        pressed += 1;
        await deps.sleep(deps.gap);
      }
      return pressed;
    }
    function sweep() {
      if (sweeping) {
        again = true;
        return sweeping;
      }
      let finished = null;
      sweeping = new Promise((resolve) => {
        finished = resolve;
      });
      const promise = sweeping;
      (async () => {
        try {
          quietly(() => deps.setAuto(true));
          let pressed = 0;
          let ending = "";
          let lastPage = false;
          let turned = 0;
          full = null;
          do {
            again = false;
            pressed += await sweepOnce();
            if (full && state === "running") {
              ending = `Limit reached (${full.count}). Download the zip, empty it if the site keeps it, then Play to carry on.`;
              break;
            }
            if (again || state !== "running" || typeof deps.page.next !== "function") continue;
            say("Page done; next page\u2026");
            const moved = await deps.page.next() || {};
            if (state !== "running") break;
            if (moved.pressed && moved.changed) {
              turned += 1;
              if (turned >= MAX_ZIP_PAGES) ending = `Stopped after ${MAX_ZIP_PAGES} pages.`;
              else again = true;
              continue;
            }
            lastPage = true;
            ending = "Done: last page.";
          } while (again && state === "running");
          if (ending && state === "running") {
            show("idle");
            quietly(() => deps.setAuto(false));
            say(ending + (lastPage ? ` ${zipAddedCount(deps.store.read())} done on this site.` : ""));
          } else if (state === "running") {
            say((pressed ? "Page done." : "Nothing new here.") + " Open the next page to carry on, or Stop.");
          }
        } catch (error) {
          show("idle");
          quietly(() => deps.setAuto(false));
          say("Stopped on a script fault: " + (error && error.message ? error.message : String(error)) + ".");
        } finally {
          sweeping = null;
          quietly(() => deps.refresh());
          finished();
        }
      })();
      return promise;
    }
    return {
      state: () => state,
      play() {
        if (state === "running") return sweeping || Promise.resolve();
        addedSincePlay = 0;
        show("running");
        return sweep();
      },
      pageChanged() {
        if (state !== "running") return Promise.resolve();
        return sweep();
      },
      stop() {
        show("idle");
        quietly(() => deps.setAuto(false));
        say("Stopped.");
        return sweeping || Promise.resolve();
      },
      reset() {
        if (state !== "idle") {
          say("Stop before Reset.");
          return false;
        }
        const count = Object.keys(deps.store.read().cards).length;
        if (!count) {
          say("The click ledger is already empty.");
          return false;
        }
        const agreed = quietly(() => deps.confirm(`Forget all ${count} item(s) in this site's click ledger? The next Play clicks them again. It does not empty anything on the site.`));
        if (agreed !== true) {
          say("Reset cancelled.");
          return false;
        }
        const cleared = deps.store.forget();
        quietly(() => deps.refresh());
        say(cleared ? `Forgot ${count} item(s).` : "Forgotten here, but storage refused.");
        return cleared;
      }
    };
  }

  // src/lib/ui.js
  var PREFIX2 = "pz-";
  function tag(name, props = {}, children = []) {
    const el = document.createElement(name);
    Object.assign(el, props);
    for (const c of children) el.appendChild(c);
    return el;
  }
  function own(el, kind) {
    el.setAttribute("data-pz", kind);
    return el;
  }
  function prefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {
      return false;
    }
  }
  var themeMode = "auto";
  function setTheme(mode) {
    themeMode = mode === "light" || mode === "dark" ? mode : "auto";
    return themeMode;
  }
  function getTheme() {
    return themeMode;
  }
  function isDark() {
    if (themeMode === "dark") return true;
    if (themeMode === "light") return false;
    return prefersDark();
  }
  var touchMode = false;
  function setTouch(v) {
    touchMode = !!v;
    return touchMode;
  }
  function getTouch() {
    return touchMode;
  }
  function detectTouch() {
    try {
      return !!(navigator && navigator.maxTouchPoints > 0 || window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    } catch {
      return false;
    }
  }
  function palette() {
    return isDark() ? {
      bg: "#1f1f22",
      fg: "#e8e8ea",
      sub: "#a2a2a8",
      border: "#3a3a40",
      hover: "#2c2c31",
      head: "#26262b",
      accent: "#4caf50",
      danger: "#ff5c5c",
      chip: "#2a2a30",
      chipBorder: "#5a5a62",
      field: "#2a2a30",
      shadow: "0 2px 14px rgba(0,0,0,.6)"
    } : {
      bg: "#ffffff",
      fg: "#141414",
      sub: "#5f5f5f",
      border: "#e2e2e2",
      hover: "#f0f0f0",
      head: "#f6f6f6",
      accent: "#2e7d32",
      danger: "#c62828",
      chip: "#ffffff",
      chipBorder: "#bcbcbc",
      field: "#ffffff",
      shadow: "0 2px 12px rgba(0,0,0,.28)"
    };
  }
  function formatStatus(action, detail) {
    switch (action) {
      case "popup":
        return "Blocked a popup";
      case "autozap":
        return "Removed an overlay";
      case "paywall":
        return "Removed a paywall veil";
      case "deblur":
        return "Un-blurred the page";
      case "consent":
        return "Dismissed a cookie banner";
      case "reload":
        return "Blocked an auto-reload";
      case "meter":
        return "Reset the paywall meter";
      case "unlock":
        return "Unlocked gated content";
      case "keep":
        return "Restored saved content";
      case "freeze":
        return "Found a paywall vendor to block";
      default:
        return detail || action;
    }
  }
  function createControlMenu({
    enabled,
    hostname: hostname2,
    open,
    status,
    showReveal,
    blocked,
    onToggleMenu,
    onToggleSite,
    onBlock,
    onRemovePaywall,
    onRevert,
    onReveal,
    onSettings,
    onBatch,
    batchOpen
  }) {
    const t = palette();
    const wrap = own(tag("div", { className: PREFIX2 + "control" }), "control");
    wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;" + (touchMode ? "bottom:calc(12px + env(safe-area-inset-bottom));right:calc(12px + env(safe-area-inset-right));" : "");
    const badge = tag("button");
    badge.setAttribute("data-act", "menu");
    badge.title = enabled ? "Popup Zapper: on \u2014 click for menu" : "Popup Zapper: off \u2014 click for menu";
    badge.style.cssText = `position:relative;display:flex;align-items:center;gap:6px;cursor:pointer;padding:5px 10px;border-radius:16px;font:bold 13px sans-serif;line-height:1;background:${t.chip};color:${t.fg};border:1.5px solid ${t.chipBorder};box-shadow:${t.shadow};`;
    const icon = tag("span");
    icon.style.cssText = `display:flex;flex:0 0 auto;color:${enabled ? t.fg : t.sub};`;
    const strike = enabled ? "" : '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5"/>';
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 2v11h3v9l7-12h-4l4-8z"/>' + strike + "</svg>";
    const name = tag("span", { textContent: "Popup Zapper" });
    const nameOpen = open || touchMode;
    name.style.cssText = "overflow:hidden;white-space:nowrap;transition:max-width .25s ease,opacity .25s ease;" + (nameOpen ? "max-width:140px;opacity:1;" : "max-width:0;opacity:0;");
    const dot = tag("span");
    dot.setAttribute("data-pz-dot", "");
    dot.style.cssText = `position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:${t.danger};border:1.5px solid ${t.chip};display:${blocked ? "block" : "none"};`;
    badge.appendChild(icon);
    badge.appendChild(name);
    badge.appendChild(dot);
    if (!open && !touchMode) {
      badge.addEventListener("mouseenter", () => {
        name.style.maxWidth = "140px";
        name.style.opacity = "1";
      });
      badge.addEventListener("mouseleave", () => {
        name.style.maxWidth = "0";
        name.style.opacity = "0";
      });
    }
    if (onToggleMenu) badge.addEventListener("click", onToggleMenu);
    const menu = tag("div");
    menu.style.cssText = `display:${open ? "block" : "none"};position:absolute;bottom:42px;right:0;background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:8px;box-shadow:${t.shadow};overflow:hidden;min-width:240px;`;
    const header = tag("div");
    header.style.cssText = `padding:8px 12px;background:${t.head};border-bottom:1px solid ${t.border};`;
    const hRow = tag("div");
    hRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";
    hRow.appendChild(tag("span", {
      textContent: hostname2 || "this site",
      style: `font-weight:bold;color:${t.fg};word-break:break-all;`
    }));
    const toggle = tag("button", { textContent: enabled ? "On" : "Off" });
    toggle.setAttribute("data-act", "site");
    toggle.title = enabled ? "Turn off for this site" : "Turn on for this site";
    toggle.style.cssText = "border:0;border-radius:12px;padding:3px 10px;cursor:pointer;font-weight:bold;color:#fff;background:" + (enabled ? t.accent : t.danger);
    toggle.addEventListener("click", onToggleSite);
    hRow.appendChild(toggle);
    header.appendChild(hRow);
    menu.appendChild(header);
    const item = (act, label, handler, accent) => {
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", act);
      b.style.cssText = `display:block;width:100%;text-align:left;padding:9px 12px;border:0;background:${t.bg};color:${accent || t.fg};cursor:pointer;font:12px sans-serif;` + (touchMode ? "min-height:44px;" : "");
      b.addEventListener("mouseenter", () => {
        b.style.background = t.hover;
      });
      b.addEventListener("mouseleave", () => {
        b.style.background = t.bg;
      });
      if (handler) b.addEventListener("click", handler);
      menu.appendChild(b);
      return b;
    };
    item("block", "\u{1F6AB}  Block a popup", onBlock);
    item("paywall", "\u{1F513}  Remove paywall", onRemovePaywall);
    item("revert", "\u21A9\uFE0F  Revert last block", onRevert);
    if (onBatch) item("batch", batchOpen ? "\u2611\uFE0F  Close batch clicker" : "\u2611\uFE0F  Batch clicker", onBatch);
    const strip = tag("div");
    strip.setAttribute("data-pz-status", "");
    strip.style.cssText = `padding:7px 12px;border-top:1px solid ${t.border};border-bottom:1px solid ${t.border};color:${t.sub};font:11px sans-serif;min-height:16px;background:${t.head};`;
    strip.textContent = status || "Ready.";
    menu.appendChild(strip);
    if (showReveal) {
      item("reveal", "\u{1F50D}  Reveal hidden content", onReveal, isDark() ? "#e0a44a" : "#8a5a00");
    }
    item("settings", "\u2699\uFE0F  Settings", onSettings);
    wrap.appendChild(badge);
    wrap.appendChild(menu);
    return wrap;
  }
  function createSettingsPanel({
    library: library2,
    hostname: hostname2,
    version,
    theme,
    update,
    onToggleRule,
    onEditRule,
    onDeleteRule,
    onPromoteRule,
    onToggleCleanup,
    onSetTheme,
    onCheckUpdates,
    onInstallUpdate,
    onReloadPage,
    onCopyUpdate,
    onShowLog,
    onDiagnostics,
    onClose
  }) {
    const t = palette();
    const panel = own(tag("div", { className: PREFIX2 + "settings" }), "settings");
    panel.style.cssText = `position:fixed;top:40px;right:12px;z-index:2147483647;background:${t.bg};color:${t.fg};padding:12px;border:1px solid ${t.border};border-radius:8px;font:13px sans-serif;max-height:74vh;overflow:auto;box-shadow:${t.shadow};min-width:300px;max-width:92vw;`;
    const btn = (label, act, handler) => {
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", act);
      b.style.cssText = `border:1px solid ${t.border};background:${t.head};color:${t.fg};border-radius:5px;padding:3px 8px;cursor:pointer;font:12px sans-serif;`;
      if (handler) b.addEventListener("click", handler);
      return b;
    };
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
    head.appendChild(tag("strong", { textContent: "\u2699 Settings" }));
    const cls = tag("button", { textContent: "\u2715" });
    cls.setAttribute("data-act", "close");
    cls.title = "Close";
    cls.style.cssText = `border:0;background:none;color:${t.fg};font-size:16px;line-height:1;cursor:pointer;`;
    cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel.appendChild(head);
    panel.appendChild(tag("div", {
      textContent: "What's blocked on this site",
      style: `font-weight:bold;color:${t.fg};margin:6px 0 4px;`
    }));
    const addRule = (rule, scope) => {
      const row3 = tag("div");
      row3.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";
      const cb = tag("input", { type: "checkbox", checked: rule.enabled !== false });
      cb.setAttribute("data-act", "toggle-rule");
      cb.addEventListener("change", () => onToggleRule({ rule, scope, enabled: cb.checked }));
      row3.appendChild(cb);
      row3.appendChild(tag("span", {
        textContent: `${rule.type} \u201C${rule.value}\u201D \xB7 ${scope === "global" ? "all sites" : "this site"}`,
        style: "flex:1;word-break:break-all;color:" + (rule.enabled === false ? t.sub : t.fg)
      }));
      row3.appendChild(btn("Edit", "edit-rule", () => onEditRule({ rule, scope })));
      row3.appendChild(btn("Delete", "delete-rule", () => onDeleteRule({ rule, scope })));
      if (scope === "site") row3.appendChild(btn("Make global", "promote-rule", () => onPromoteRule({ rule })));
      panel.appendChild(row3);
    };
    const globals = library2.global || [];
    const dom = (library2.domains || {})[hostname2] || {};
    const siteRules = dom.rules || [];
    if (!globals.length && !siteRules.length) {
      panel.appendChild(tag("div", {
        textContent: "No rules yet. Use \u201CBlock a popup\u201D to add one.",
        style: `color:${t.sub};margin:2px 0 6px;`
      }));
    }
    for (const r of globals) addRule(r, "global");
    for (const r of siteRules) addRule(r, "site");
    const cleanupRow = tag("label");
    cleanupRow.style.cssText = `display:flex;gap:6px;align-items:center;margin:10px 0 4px;border-top:1px solid ${t.border};padding-top:8px;`;
    const cleanupCb = tag("input", { type: "checkbox", checked: dom.cleanup === true });
    cleanupCb.setAttribute("data-act", "toggle-cleanup");
    cleanupCb.addEventListener("change", () => onToggleCleanup(cleanupCb.checked));
    cleanupRow.appendChild(cleanupCb);
    cleanupRow.appendChild(tag("span", { textContent: "Delete tracking cookies/storage on this site (can log you out)" }));
    panel.appendChild(cleanupRow);
    if (onSetTheme) {
      const themeRow = tag("div");
      themeRow.style.cssText = `display:flex;gap:8px;align-items:center;margin:10px 0 4px;border-top:1px solid ${t.border};padding-top:8px;`;
      themeRow.appendChild(tag("span", { textContent: "Appearance", style: `flex:1;color:${t.sub};` }));
      const seg = tag("div");
      seg.style.cssText = `display:flex;border:1px solid ${t.border};border-radius:6px;overflow:hidden;`;
      const cur = theme || "auto";
      [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].forEach(([mode, label], i) => {
        const on = cur === mode;
        const b = tag("button", { textContent: label });
        b.setAttribute("data-act", "theme-" + mode);
        b.style.cssText = "border:0;padding:3px 10px;cursor:pointer;font:12px sans-serif;" + (i ? `border-left:1px solid ${t.border};` : "") + (on ? `background:${t.accent};color:#fff;font-weight:bold;` : `background:${t.head};color:${t.fg};`);
        if (!on) b.addEventListener("click", () => onSetTheme(mode));
        seg.appendChild(b);
      });
      themeRow.appendChild(seg);
      panel.appendChild(themeRow);
    }
    const u = update || { state: "idle" };
    const verRow = tag("div");
    verRow.style.cssText = `display:flex;gap:8px;align-items:center;margin:10px 0 4px;border-top:1px solid ${t.border};padding-top:8px;`;
    verRow.appendChild(tag("span", { textContent: `Popup Zapper v${version}`, style: `flex:1;color:${t.sub};` }));
    if (u.state === "available") {
      if (getTouch()) {
        verRow.appendChild(btn("Copy update link", "copy-update", onCopyUpdate));
      } else {
        verRow.appendChild(btn(`Update to v${u.remote}`, "install-update", onInstallUpdate));
      }
    } else if (u.state === "opened") {
      verRow.appendChild(btn("\u21BB Reload to apply", "reload-page", onReloadPage));
    } else {
      verRow.appendChild(btn(
        u.state === "checking" ? "Checking\u2026" : "Check for updates",
        "check-updates",
        u.state === "checking" ? null : onCheckUpdates
      ));
    }
    panel.appendChild(verRow);
    const noteText = {
      checking: "Checking for a new version\u2026",
      current: "You're on the latest version \u2713",
      error: "Couldn't check \u2014 network blocked.",
      available: `Version ${u.remote} is ready to install.`,
      opened: "Install page opened. Click Update/Reinstall there, then reload here.",
      copied: "Link copied. Open it in your userscript app (Userscripts) to reinstall the new version."
    }[u.state];
    if (noteText) {
      panel.appendChild(tag("div", { textContent: noteText, style: `color:${t.sub};font-size:12px;margin:2px 0 4px;` }));
    }
    const dbg = tag("div");
    dbg.style.cssText = "display:flex;gap:8px;margin-top:8px;";
    dbg.appendChild(btn("\u{1F4DC} Activity log", "log", onShowLog));
    if (onDiagnostics) dbg.appendChild(btn("\u{1F527} Copy diagnostics", "diag", onDiagnostics));
    panel.appendChild(dbg);
    return panel;
  }
  function createPickerToolbar({ onPrev, onNext, onGrow, onShrink, onBlock, onCancel }) {
    const t = palette();
    const mk = (act, label, handler, title, primary) => {
      const b = tag("button", { textContent: label, title: title || label });
      b.setAttribute("data-act", act);
      b.style.cssText = "margin:0 3px;padding:4px 9px;font:13px sans-serif;cursor:pointer;border-radius:4px;border:0;" + (touchMode ? "min-height:44px;min-width:44px;" : "") + (primary ? "background:#2e7d32;color:#fff;font-weight:bold;" : "background:#f0f0f0;color:#111;");
      b.addEventListener("click", handler);
      return b;
    };
    const bar = own(tag("div", { className: PREFIX2 + "picker" }), "picker");
    bar.style.cssText = `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:${t.bg};color:${t.fg};padding:8px 12px;border:1px solid ${t.border};border-radius:8px;font:13px sans-serif;box-shadow:${t.shadow};display:flex;align-items:center;`;
    if (touchMode) bar.style.paddingTop = "calc(8px + env(safe-area-inset-top))";
    bar.appendChild(tag("span", { textContent: "Pick the popup: ", style: "margin-right:6px" }));
    bar.appendChild(mk("prev", "\u25C0", onPrev, "Previous candidate"));
    bar.appendChild(mk("next", "\u25B6", onNext, "Next candidate"));
    bar.appendChild(mk("grow", "\u25B2", onGrow, "Select parent ( [ )"));
    bar.appendChild(mk("shrink", "\u25BC", onShrink, "Select child ( ] )"));
    const applyAll = tag("label", { style: "margin:0 8px;font:12px sans-serif;display:flex;align-items:center;gap:4px;" });
    const allCb = tag("input", { type: "checkbox" });
    allCb.setAttribute("data-act", "all-sites");
    applyAll.appendChild(allCb);
    applyAll.appendChild(tag("span", { textContent: "all sites" }));
    bar.appendChild(applyAll);
    bar.appendChild(mk("block", "\u2713 Block", () => onBlock(allCb.checked), "Block this element", true));
    bar.appendChild(mk("cancel", "Cancel", onCancel));
    return bar;
  }
  function createFilterPanel({ filters, hosts, copied, onClose }) {
    const t = palette();
    const panel = own(tag("div", { className: PREFIX2 + "filters" }), "filters");
    panel.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:${t.bg};color:${t.fg};padding:16px;border:1px solid ${t.border};border-radius:10px;width:440px;max-width:92vw;font:13px sans-serif;box-shadow:${t.shadow};`;
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
    head.appendChild(tag("strong", { textContent: "\u{1F9CA} Block this paywall permanently" }));
    const cls = tag("button", { textContent: "\u2715" });
    cls.setAttribute("data-act", "close");
    cls.title = "Close";
    cls.style.cssText = `border:0;background:none;color:${t.fg};font-size:16px;line-height:1;cursor:pointer;`;
    cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel.appendChild(head);
    panel.appendChild(tag("div", {
      textContent: `Found ${hosts.length} paywall/metering host(s) on this page${copied ? " \u2014 copied to your clipboard." : "."}`,
      style: `margin-bottom:8px;color:${t.sub};`
    }));
    const area = tag("textarea");
    area.value = filters;
    area.readOnly = true;
    area.style.cssText = `width:100%;height:96px;font:12px monospace;box-sizing:border-box;border:1px solid ${t.border};border-radius:6px;padding:8px;resize:vertical;background:${t.field};color:${t.fg};`;
    area.addEventListener("focus", () => area.select());
    panel.appendChild(area);
    const steps = tag("ol");
    steps.style.cssText = `margin:10px 0 0 0;padding-left:20px;color:${t.sub};line-height:1.6;`;
    for (const s of [
      "Open uBlock Origin \u2192 Dashboard (the gears icon).",
      'Go to the "My filters" tab.',
      "Paste the lines above (already copied) at the end.",
      'Click "Apply changes", then reload this page.'
    ]) steps.appendChild(tag("li", { textContent: s }));
    panel.appendChild(steps);
    return panel;
  }
  function createActivityPanel({ entries, onClear, onClose }) {
    const t = palette();
    const panel = own(tag("div", { className: PREFIX2 + "log" }), "log");
    panel.style.cssText = `position:fixed;bottom:54px;right:12px;z-index:2147483647;background:${t.bg};color:${t.fg};padding:10px;border:1px solid ${t.border};border-radius:8px;font:11px/1.5 monospace;max-height:50vh;width:340px;overflow:auto;box-shadow:${t.shadow};`;
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;";
    head.appendChild(tag("strong", { textContent: "Activity", style: `color:${t.fg}` }));
    const btns = tag("div");
    const mkBtn = (label, act, handler) => {
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", act);
      b.style.cssText = `margin-left:6px;cursor:pointer;font:11px monospace;background:${t.head};color:${t.fg};border:1px solid ${t.border};border-radius:4px;padding:2px 6px;`;
      b.addEventListener("click", handler);
      return b;
    };
    btns.appendChild(mkBtn("Clear", "clear", onClear));
    btns.appendChild(mkBtn("\u2715", "close", onClose));
    head.appendChild(btns);
    panel.appendChild(head);
    if (!entries || entries.length === 0) {
      panel.appendChild(tag("div", {
        textContent: "Nothing yet on this page. If a popup is here, use Block a popup.",
        style: `color:${t.sub}`
      }));
    } else {
      for (const e of entries) {
        const time = new Date(e.t).toLocaleTimeString();
        const times = e.count > 1 ? ` (x${e.count})` : "";
        panel.appendChild(tag("div", { textContent: `${time}  [${e.action}] ${e.detail}${times}` }));
      }
    }
    return panel;
  }

  // src/lib/batch/panel.js
  function numberStyle(width, t = palette()) {
    return [
      `width:${width}px`,
      "min-width:0",
      "max-width:none",
      "height:auto",
      "box-sizing:border-box",
      "padding:2px 4px",
      "margin:0",
      "font:12px/1.3 sans-serif",
      `color:${t.fg}`,
      `background:${t.field}`,
      `border:1px solid ${t.border}`,
      "border-radius:4px",
      "text-align:left"
    ].map((rule) => rule + " !important").join(";");
  }
  var RESET = "text-transform:none;letter-spacing:normal;line-height:1.3;margin:0;width:auto;height:auto;box-shadow:none;text-shadow:none;float:none;text-align:center;vertical-align:middle;";
  function button(t, act, label, handler, title) {
    const b = tag("button", { textContent: label, type: "button" });
    b.setAttribute("data-act", act);
    if (title) b.title = title;
    b.style.cssText = `border:1px solid ${t.border};background:${t.head};color:${t.fg};border-radius:5px;` + RESET + "padding:3px 8px;cursor:pointer;font:12px sans-serif;box-sizing:border-box;" + (getTouch() ? "min-height:40px;" : "");
    if (handler) b.addEventListener("click", handler);
    return b;
  }
  function row(gap = 6) {
    const r = tag("div");
    r.style.cssText = `display:flex;flex-wrap:wrap;gap:${gap}px;align-items:center;`;
    return r;
  }
  function numberField(t, act, label, value, width, handler) {
    const wrap = tag("label");
    wrap.style.cssText = `display:flex;align-items:center;gap:4px;color:${t.sub};`;
    wrap.appendChild(tag("span", { textContent: label }));
    const input = tag("input", { type: "number", min: "1", value: String(value) });
    input.setAttribute("data-act", act);
    input.style.cssText = numberStyle(width, t);
    if (handler) input.addEventListener("change", () => handler(input.value));
    wrap.appendChild(input);
    return { wrap, input };
  }
  function segmented(t, act, options, current, onPick) {
    const seg = tag("div");
    seg.style.cssText = `display:flex;align-self:flex-start;border:1px solid ${t.border};border-radius:6px;overflow:hidden;`;
    options.forEach(([value, label, title], i) => {
      const on = current === value;
      const b = tag("button", { textContent: label, type: "button" });
      b.setAttribute("data-act", act + "-" + value);
      if (title) b.title = title;
      b.style.cssText = RESET + "border:0;padding:3px 10px;cursor:pointer;font:11px sans-serif;" + (i ? `border-left:1px solid ${t.border};` : "") + (on ? `background:${t.accent};color:#fff;font-weight:bold;` : `background:${t.head};color:${t.fg};`);
      if (!on && onPick) b.addEventListener("click", () => onPick(value));
      seg.appendChild(b);
    });
    return seg;
  }
  function chipStyle(on, t = palette()) {
    return RESET + "padding:1px 8px;border-radius:10px;cursor:pointer;font:11px/1.6 sans-serif;" + (on ? `background:${t.accent};color:#fff;border:1px solid ${t.accent};` : `background:${t.chip};color:${t.sub};border:1px solid ${t.chipBorder};text-decoration:line-through;`);
  }
  function createBatchPanel({
    mode = "tick",
    kind = null,
    variant = null,
    batchSize = 10,
    startAt = 1,
    limit = 50,
    position = null,
    onClose,
    onPlay,
    onStop,
    onReset,
    onPickItem,
    onForgetItem,
    onPickButton,
    onSelectAll,
    onSize,
    onStart,
    onLimit,
    onType,
    onKind,
    onSteps,
    onVariant,
    onRefine
  }) {
    const t = palette();
    const panel = own(tag("div", { className: "pz-batch" }), "batch");
    panel.style.cssText = `position:fixed;z-index:2147483647;width:300px;max-width:calc(100vw - 24px);box-sizing:border-box;background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:8px;font:12px sans-serif;box-shadow:${t.shadow};overflow:hidden;text-align:left;` + (position ? `left:${position.left}px;top:${position.top}px;` : "right:12px;bottom:54px;");
    const head = tag("div");
    head.setAttribute("data-pz-drag", "");
    head.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;background:${t.head};border-bottom:1px solid ${t.border};cursor:move;user-select:none;`;
    head.appendChild(tag("strong", { textContent: "\u2611 Batch clicker", style: `color:${t.fg};` }));
    const modeLabel = tag("span", {
      textContent: mode === "click" ? "click each" : "tick & download",
      style: `flex:1;color:${t.sub};font-size:11px;`
    });
    modeLabel.setAttribute("data-pz-mode", "");
    head.appendChild(modeLabel);
    const cls = tag("button", { textContent: "\u2715", type: "button", title: "Close" });
    cls.setAttribute("data-act", "batch-close");
    cls.style.cssText = RESET + `border:0;background:none;color:${t.fg};font-size:15px;line-height:1;cursor:pointer;padding:0 2px;`;
    if (onClose) cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel.appendChild(head);
    const body = tag("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;";
    panel.appendChild(body);
    const controls = row();
    const play = tag("button", { textContent: "\u25B6 Play", type: "button" });
    play.setAttribute("data-act", "batch-play");
    play.style.cssText = RESET + `border:0;border-radius:12px;padding:4px 14px;cursor:pointer;font:bold 12px sans-serif;color:#fff;background:${t.accent};min-width:76px;` + (getTouch() ? "min-height:40px;" : "");
    if (onPlay) play.addEventListener("click", onPlay);
    controls.appendChild(play);
    controls.appendChild(button(t, "batch-stop", "\u25A0 Stop", onStop, "Stop, and save the list"));
    const reset = button(t, "batch-reset", "\u21BA Reset", onReset, "Forget what this site's ledger holds");
    controls.appendChild(reset);
    body.appendChild(controls);
    const numbers = row(10);
    let size = null;
    let start = null;
    let cap = null;
    if (mode === "click") {
      cap = numberField(t, "batch-limit", "Stop after", limit, 64, onLimit);
      cap.wrap.title = "Stop once this many are added (or the site's own zip count reaches it)";
      numbers.appendChild(cap.wrap);
    } else {
      size = numberField(t, "batch-size", "Batch", batchSize, 52, onSize);
      start = numberField(t, "batch-start", "Start at row", startAt, 64, onStart);
      numbers.appendChild(size.wrap);
      numbers.appendChild(start.wrap);
    }
    body.appendChild(numbers);
    const types = row(4);
    types.setAttribute("data-pz-types", "");
    types.style.display = "none";
    if (onType) {
      types.addEventListener("click", (event) => {
        const chip = event.target && event.target.closest ? event.target.closest("[data-type]") : null;
        if (chip) onType(chip.getAttribute("data-type"));
      });
    }
    body.appendChild(types);
    const teach = row();
    const pickItem = button(
      t,
      "batch-pick-item",
      "\u2610 Pick item",
      onPickItem,
      "Click one of the things you want clicked many times: a checkbox or a button"
    );
    teach.appendChild(pickItem);
    const forget = button(t, "batch-forget-item", "\u2715", onForgetItem, "Forget the picked item; find items automatically");
    forget.style.padding = "3px 6px";
    forget.style.display = "none";
    teach.appendChild(forget);
    let pickButton2 = null;
    let selectAll = null;
    if (mode !== "click") {
      pickButton2 = button(
        t,
        "batch-pick-button",
        "\u2B07 Download button",
        onPickButton,
        "Click the page's own download button, so Play presses that one"
      );
      teach.appendChild(pickButton2);
      selectAll = button(
        t,
        "batch-select-all",
        "Select all",
        onSelectAll,
        "Tick every row a run would take, and leave the download to you"
      );
      teach.appendChild(selectAll);
    }
    teach.appendChild(button(
      t,
      "batch-steps",
      "\u23FA Steps",
      onSteps,
      "Open the step recorder: do one item by hand, then repeat it for every item"
    ));
    body.appendChild(teach);
    if (kind) {
      body.appendChild(segmented(t, "batch-kind", [
        ["box", "Tick in batches", "Tick these in batches and press the page's download button"],
        ["button", "Click each", "Press each of these once, page by page"]
      ], kind, onKind));
    }
    let refine = null;
    if (variant) {
      const line = row();
      if (variant.all > variant.kind || !variant.on) {
        line.appendChild(segmented(t, "batch-variant", [
          ["kind", `This kind ${variant.kind}`, "Only those like the one you picked (outlined green)"],
          ["all", `All alike ${variant.all}`, "Every look-alike, whatever its icon or label"]
        ], variant.on ? "kind" : "all", (value) => onVariant && onVariant(value === "kind")));
      }
      refine = button(
        t,
        "batch-refine",
        "\u270E Refine",
        onRefine,
        "Then click a green one to leave its kind out, or an unmarked look-alike to take its kind in"
      );
      line.appendChild(refine);
      body.appendChild(line);
    }
    const strip = tag("div");
    strip.style.cssText = `padding:7px 12px;border-top:1px solid ${t.border};background:${t.head};display:flex;flex-direction:column;gap:3px;`;
    const counts = tag("div", { style: `color:${t.fg};font:11px sans-serif;min-height:14px;` });
    counts.setAttribute("data-pz-counts", "");
    const status = tag("div", { textContent: "Ready.", style: `color:${t.sub};font:11px sans-serif;min-height:14px;` });
    status.setAttribute("data-pz-status", "");
    const more = tag("button", { textContent: "Details \u25B8", type: "button" });
    more.setAttribute("data-act", "batch-details");
    more.style.cssText = RESET + `display:none;align-self:flex-start;border:0;background:none;padding:0;cursor:pointer;color:${t.sub};font:11px sans-serif;text-decoration:underline;`;
    const box = tag("pre");
    box.setAttribute("data-pz-details", "");
    box.style.cssText = `display:none;margin:2px 0 0;max-height:160px;overflow:auto;padding:5px 6px;white-space:pre-wrap;background:${t.field};color:${t.fg};border:1px solid ${t.border};border-radius:4px;font:10.5px/1.4 ui-monospace,Consolas,monospace;`;
    more.addEventListener("click", () => {
      const open = box.style.display === "none";
      box.style.display = open ? "block" : "none";
      more.textContent = open ? "Details \u25BE" : "Details \u25B8";
    });
    strip.appendChild(counts);
    strip.appendChild(status);
    strip.appendChild(more);
    strip.appendChild(box);
    panel.appendChild(strip);
    const view = {
      el: panel,
      mode,
      head,
      inputs: { size: size && size.input, start: start && start.input, limit: cap && cap.input },
      // The button names what pressing it does next.
      setPlay(state) {
        if (mode === "click") {
          play.textContent = state === "running" ? "\u23F3 Clicking\u2026" : "\u25B6 Play";
          return;
        }
        play.textContent = state === "running" ? "\u23F8 Pause" : state === "pausing" ? "\u25B6 Resume" : state === "stopping" ? "Stopping\u2026" : "\u25B6 Play";
      },
      setStatus(text) {
        status.textContent = text || "";
      },
      setCounts(text) {
        counts.textContent = text || "";
      },
      // Folded away unless there is something to show; a report the person
      // should see opens itself.
      setDetails(text, openIt = false) {
        box.textContent = text || "";
        more.style.display = text ? "block" : "none";
        if (!text || openIt) {
          box.style.display = text && openIt ? "block" : "none";
          more.textContent = text && openIt ? "Details \u25BE" : "Details \u25B8";
        }
      },
      setTypes(list) {
        types.textContent = "";
        types.style.display = list.length ? "flex" : "none";
        if (!list.length) return;
        types.appendChild(tag("span", { textContent: "Types", style: `color:${t.sub};margin-right:2px;` }));
        for (const each of list) {
          const chip = tag("button", { textContent: `${each.format} ${each.rows}`, type: "button" });
          chip.setAttribute("data-type", each.format);
          chip.setAttribute("aria-pressed", each.on ? "true" : "false");
          chip.title = (each.on ? "Fetched" : "Left alone") + ". Click to switch " + (each.on ? "off." : "on.");
          chip.style.cssText = chipStyle(each.on, t);
          types.appendChild(chip);
        }
      },
      setSelectAll(label) {
        if (selectAll) selectAll.textContent = label;
      },
      setPickItem(label, learned) {
        pickItem.textContent = label;
        forget.style.display = learned ? "inline-block" : "none";
      },
      setPickButton(label) {
        if (pickButton2) pickButton2.textContent = label;
      },
      setReset(label) {
        reset.textContent = label;
      },
      setRefine(label) {
        if (refine) refine.textContent = label;
      }
    };
    return view;
  }
  function makeDraggable(panel, handle, onMoved) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target && event.target.closest && event.target.closest("button")) return;
      const box = panel.getBoundingClientRect();
      const dx = event.clientX - box.left;
      const dy = event.clientY - box.top;
      const move = (e) => {
        const left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dx));
        const top = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dy));
        panel.style.left = left + "px";
        panel.style.top = top + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        const now = panel.getBoundingClientRect();
        if (onMoved) onMoved({ left: Math.round(now.left), top: Math.round(now.top) });
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      event.preventDefault();
    });
  }

  // src/lib/batch/variant.js
  function slotOf(node, alike, depth = 8) {
    let at = node;
    for (let step = 0; step < depth && at; step++) {
      at = at.parentElement;
      if (!at) break;
      const inside = alike.filter((each) => at.contains(each));
      if (inside.length > 1) return { box: at, index: inside.indexOf(node), size: inside.length };
    }
    return null;
  }
  function cardSlot(node, alike) {
    const at = slotOf(node, alike);
    return at && at.size < alike.length ? at : null;
  }
  function countTraits(alike) {
    const count = /* @__PURE__ */ new Map();
    for (const node of alike) for (const trait of traitsOf(node)) count.set(trait, (count.get(trait) || 0) + 1);
    return count;
  }
  var hasAll = (traits, all) => all.every((trait) => traits.has(trait));
  function kindOf(node, alike, count = countTraits(alike)) {
    const own2 = traitsOf(node);
    const all = [...own2].filter((trait) => (count.get(trait) || 0) >= 2 && count.get(trait) < alike.length).sort();
    const card = cardSlot(node, alike);
    let slot = null;
    if (card) {
      const inCard = alike.filter((each) => card.box.contains(each) && hasAll(traitsOf(each), all));
      if (inCard.length > 1) slot = card.index;
    }
    return { all, slot, place: card ? card.index : null };
  }
  var hasSlot = (variant) => !!variant && (variant.kinds || []).some((kind) => kind.slot !== null && kind.slot !== void 0);
  function bySlot(matched, variant, alike = matched) {
    if (!hasSlot(variant)) return matched;
    return matched.filter((node) => {
      const traits = traitsOf(node);
      return variant.kinds.some((kind) => {
        if (!hasAll(traits, kind.all)) return false;
        if (kind.slot === null || kind.slot === void 0) return true;
        const card = cardSlot(node, alike);
        return !!card && card.index === kind.slot;
      });
    });
  }
  function matchesKind(node, kind, alike) {
    if (!hasAll(traitsOf(node), kind.all)) return false;
    if (kind.slot === null || kind.slot === void 0) return true;
    const card = cardSlot(node, alike);
    return !!card && card.index === kind.slot;
  }
  function isNarrowing(variant) {
    return !!variant && ((variant.none || []).length > 0 || (variant.kinds || []).some((kind) => kind.all.length > 0 || kind.slot !== null && kind.slot !== void 0));
  }
  function narrowRecord(record, picked, alike) {
    const kind = kindOf(picked, alike);
    const variant = { kinds: [kind], none: [] };
    return Object.assign({}, record, {
      variant: isNarrowing(variant) ? variant : null,
      variantOn: true,
      examples: { yes: [[...traitsOf(picked)]], no: [] }
    });
  }
  function refineRecord(record, node, wanted, alike) {
    const examples = record.examples || { yes: [], no: [] };
    const count = countTraits(alike);
    const own2 = traitsOf(node);
    let variant = record.variant ? { kinds: record.variant.kinds.map((kind) => Object.assign({}, kind)), none: record.variant.none.slice() } : { kinds: [{ all: [], slot: null, place: null }], none: [] };
    let yes = examples.yes.slice();
    let no2 = examples.no.slice();
    if (wanted) {
      variant.kinds.push(kindOf(node, alike, count));
      variant.none = variant.none.filter((trait) => !own2.has(trait));
      yes = yes.concat([[...own2]]);
    } else {
      const matching = variant.kinds.map((kind, at) => matchesKind(node, kind, alike) ? at : -1).filter((at) => at >= 0);
      if (matching.length && matching.length < variant.kinds.length) {
        variant.kinds = variant.kinds.filter((kind, at) => matching.indexOf(at) < 0);
        yes = yes.filter((list, at) => matching.indexOf(at) < 0);
        return Object.assign({}, record, { variant, variantOn: true, examples: { yes, no: no2 } });
      }
      const wantedTraits = new Set(yes.flat());
      const add = [...own2].filter((trait) => !wantedTraits.has(trait) && variant.none.indexOf(trait) < 0);
      if (add.length) {
        variant.none = variant.none.concat(add).sort();
      } else {
        const card = cardSlot(node, alike);
        for (const kind of variant.kinds) {
          if ((kind.slot === null || kind.slot === void 0) && kind.place !== null && kind.place !== void 0 && (!card || card.index !== kind.place)) {
            kind.slot = kind.place;
          }
        }
      }
      no2 = no2.concat([[...own2]]);
    }
    return Object.assign({}, record, { variant, variantOn: true, examples: { yes, no: no2 } });
  }

  // src/lib/batch/pager.js
  var NEXT_TEXT = /^(next(\s+page)?|>|›|»|→|❯|〉|〉)$/i;
  var NOT_NEXT = /prev|previous|back|first|last/i;
  var PAGE_NUMBER = /^\d{1,3}$/;
  function hintsOf(node) {
    if (!node || typeof node.getAttribute !== "function") return "";
    return ["aria-label", "title", "rel", "class", "id"].map((name) => node.getAttribute(name) || "").join(" ");
  }
  function markedCurrent(node) {
    for (let at = node, step = 0; at && step < 3; at = at.parentElement, step++) {
      if (typeof at.getAttribute !== "function") break;
      const said = at.getAttribute("aria-current");
      if (said && said !== "false") return true;
      if (/(^|[-_\s])(active|current|selected|is-active|is-current)([-_\s]|$)/i.test(at.getAttribute("class") || "")) return true;
    }
    return false;
  }
  function findNextControls(doc, lastNode, { isOurs = () => false, onScreen: onScreen3 = () => true, win = window } = {}) {
    const after = (node) => {
      if (!lastNode) return true;
      const where = lastNode.compareDocumentPosition(node);
      return (where & 4) !== 0 && (where & 16) === 0;
    };
    const clickables = Array.prototype.filter.call(
      doc.querySelectorAll('a, button, [role="button"]'),
      (node) => !isOurs(node) && after(node) && onScreen3(node) && collapse(node.textContent || "").length <= 12
    );
    let best = null;
    let bestScore = 0;
    for (const control2 of clickables) {
      const words = collapse(control2.textContent || "");
      if (NOT_NEXT.test(hintsOf(control2)) || NOT_NEXT.test(words)) continue;
      const label = (control2.getAttribute("aria-label") || "") + " " + (control2.getAttribute("title") || "");
      let score = 0;
      if (/(^|\s)next(\s|$)/i.test(control2.getAttribute("rel") || "")) score = 5;
      else if (/\bnext\b/i.test(label)) score = 4;
      else if (/next/i.test((control2.getAttribute("class") || "") + " " + (control2.id || "")) || NEXT_TEXT.test(words)) score = 3;
      if (score > bestScore) {
        best = control2;
        bestScore = score;
      }
    }
    if (best) return [{ control: best, how: "the next page button" }];
    let numbers = [];
    for (const node of doc.querySelectorAll('a, button, [role="button"], li, span')) {
      if (isOurs(node) || !after(node)) continue;
      const words = collapse(node.textContent || "");
      if (!PAGE_NUMBER.test(words)) continue;
      numbers.push({ control: node.closest('a, button, [role="button"]') || node, value: Number(words) });
    }
    numbers = numbers.filter((each, at) => numbers.findIndex((other) => other.control === each.control) === at && !numbers.some((other) => other.control !== each.control && other.value === each.value && each.control.contains(other.control)));
    if (!numbers.length) return [];
    let currentPage = numbers.filter((each) => markedCurrent(each.control));
    if (currentPage.length !== 1 && numbers.length >= 3) {
      const looks = numbers.map((each) => {
        try {
          const style = win.getComputedStyle(each.control);
          return [style.color, style.fontWeight, style.backgroundColor, style.textDecorationLine].join("|");
        } catch {
          return "";
        }
      });
      const odd = numbers.filter((each, at) => looks.filter((look) => look === looks[at]).length === 1);
      if (odd.length === 1) currentPage = odd;
    }
    const highest = Math.max(...numbers.map((each) => each.value));
    if (currentPage.length === 1 && currentPage[0].value >= highest) return [];
    const out = [];
    const lastNumber = numbers[numbers.length - 1].control;
    const arrow = clickables.filter((control2) => !collapse(control2.textContent || "") && (lastNumber.compareDocumentPosition(control2) & 4) !== 0 && !NOT_NEXT.test(hintsOf(control2)))[0];
    if (arrow) out.push({ control: arrow, how: "the arrow after the page numbers" });
    if (currentPage.length === 1) {
      const target = numbers.filter((each) => each.value === currentPage[0].value + 1)[0];
      if (target) out.push({ control: target.control, how: "page " + target.value });
    }
    return out;
  }

  // src/lib/batch/tool.js
  var MARK = "data-qs-ledger";
  var ZIP_MARK = "data-qs-zip";
  var POSITION_KEY = "pz-batch position";
  var CLICKABLE2 = 'button, a, input[type="submit"], [role="button"], [class*="button"], [class*="btn"]';
  var LOAD_MORE_WAIT = 15;
  var ZIP_GAP = 0.3;
  var PICKED_GAP = 0.8;
  var ZIP_RESPONSE_MS = 1500;
  var ZIP_LOOKS = 'button, a, [role="button"], input[type="button"], input[type="submit"], span, div, label, li';
  var NEXT_WAIT_MS = 12e3;
  var HOLDS_TEXT = /zip[^()\d]{0,30}\(\s*(\d+)\s*\)|(\d+)\s*(items?|documents?|files?)?\s*in\s+(your\s+|the\s+)?zip/i;
  var ZIP_LOOK = {
    added: ["3px solid #2e7d32", "Done"],
    refused: ["3px dashed #c62828", "Not clickable: do it by hand"],
    silent: ["3px dashed #e08a00", "Pressed, but nothing on the page changed"]
  };
  var TIMED_KINDS = ["fetch", "xmlhttprequest", "iframe", "frame", "other", "beacon", "navigation", ""];
  function sleep(seconds) {
    return new Promise((done) => setTimeout(done, Math.round(seconds * 1e3)));
  }
  function fileStamp(date) {
    const two = (number) => (number < 10 ? "0" : "") + number;
    return date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + "-" + two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds());
  }
  function onScreen(node) {
    if (!node) return false;
    if (typeof node.checkVisibility === "function") {
      try {
        return node.checkVisibility() === true;
      } catch {
      }
    }
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }
  function createBatchTool({ version = "0.0.0", pageWindow: pageWindow2 = window, onSteps = null } = {}) {
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const keyFor2 = (make, fallback) => {
      try {
        return make(location.href);
      } catch {
        return fallback;
      }
    };
    const isOurs = (node) => {
      const el = node && node.nodeType === 1 ? node : node && node.parentElement;
      return !!(el && typeof el.closest === "function" && el.closest("[data-pz]"));
    };
    let opened = false;
    let view = null;
    let mode = "tick";
    let statusText = "Ready.";
    let detailsText = "";
    let batchSize = DEFAULT_BATCH;
    let resetArmed = 0;
    let targetRecord = readTargetRecord(storage, keyFor2(targetKey, TARGET_PREFIX + "this site"));
    let learnedHere = false;
    let reader = null;
    function makeReader() {
      learnedHere = !!targetRecord && learnedMatches().length > 0;
      const source = learnedHere && targetRecord.kind === "box" ? learnedSource(document, targetRecord, matchesTarget, isOurs, (list) => keepPlaces(list)) : autoSource(document, isOurs);
      reader = createRowReader(document, { now: () => Date.now(), source });
    }
    const liveRows = () => reader.rows();
    const insideRows = (node) => reader.insideRow(node);
    function kindNow() {
      return targetRecord && targetRecord.variantOn !== false ? targetRecord.variant || null : null;
    }
    function keepPlaces(matched, variant = kindNow()) {
      return hasSlot(variant) ? bySlot(matched, variant, lookAlikes()) : matched;
    }
    function lookAlikes(record = targetRecord) {
      if (!record) return [];
      const loose = Object.assign({}, record, { variant: null });
      return Array.from(document.getElementsByTagName(record.tag)).filter((el) => !isOurs(el) && matchesTarget(el, loose));
    }
    function learnedMatches() {
      if (!targetRecord) return [];
      const matched = Array.from(document.getElementsByTagName(targetRecord.tag)).filter((el) => !isOurs(el) && matchesTarget(el, targetRecord));
      return keepPlaces(matched);
    }
    makeReader();
    const stores = /* @__PURE__ */ new Map();
    function storeHere() {
      const key = keyFor2(ledgerKey, LEDGER_PREFIX + "this page");
      if (!stores.has(key)) stores.set(key, openStore(storage, key));
      return stores.get(key);
    }
    let runStore = null;
    function downloadCandidates() {
      return Array.from(document.querySelectorAll(CLICKABLE2)).filter((each) => {
        if (!/download/i.test(each.textContent || each.value || "")) return false;
        if (isOurs(each) || insideRows(each) || !onScreen(each)) return false;
        const words = wordsOf(each);
        if (!/^download\b/i.test(words) || words.length > 24) return false;
        return !/centre|center/i.test(words);
      });
    }
    function downloadButton() {
      const all = downloadCandidates();
      const innermost = all.filter((each) => !all.some((other) => other !== each && each.contains(other)));
      return innermost[0] || all[0] || null;
    }
    function loadMoreControl(live) {
      const last = live.length ? live[live.length - 1].row : null;
      if (!last || typeof last.compareDocumentPosition !== "function") return null;
      const all = Array.from(document.querySelectorAll(CLICKABLE2)).filter((each) => /more/i.test(each.textContent || each.value || "") && (last.compareDocumentPosition(each) & 4) !== 0 && !isOurs(each) && !insideRows(each) && onScreen(each) && isLoadMoreText(wordsOf(each)));
      const innermost = all.filter((each) => !all.some((other) => other !== each && each.contains(other)));
      return innermost[0] || null;
    }
    let buttonRecord = readButtonRecord(storage, keyFor2(buttonKey, BUTTON_PREFIX + "this site"));
    let buttonCache = null;
    function stillUsable(use) {
      const node = use && use.button;
      try {
        if (!node || node.isConnected === false || insideRows(node)) return false;
        if (use.source === "selected") return !!buttonRecord && buttonWords(labelOf(node)) === buttonRecord.words;
        return /^download\b/i.test(wordsOf(node));
      } catch {
        return false;
      }
    }
    function buttonInUse() {
      if (buttonCache && Date.now() - buttonCache.at < 3e4 && stillUsable(buttonCache.use)) return buttonCache.use;
      const use = pickButton(buttonRecord, (record) => {
        const first2 = record.words.split(" ")[0];
        let candidates = [];
        try {
          candidates = Array.from(document.getElementsByTagName(record.chain[0].tag)).filter((node) => {
            const named2 = typeof node.getAttribute === "function" ? (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "") : "";
            return normaliseText(String(node.textContent || node.value || "") + " " + named2).indexOf(first2) >= 0;
          });
        } catch {
          candidates = [];
        }
        return locateButton(record, candidates, (node) => !isOurs(node) && !insideRows(node) && onScreen(node));
      }, downloadButton);
      buttonCache = { use, at: Date.now() };
      return use;
    }
    function sayButtonInUse(lead = "") {
      const use = buttonInUse();
      say(lead + describeUse(use, use.button ? labelOf(use.button) : ""));
    }
    function say(words) {
      statusText = words;
      if (view) view.setStatus(words);
    }
    function setDetails(text, openIt = false) {
      detailsText = text || "";
      if (view) view.setDetails(detailsText, openIt);
    }
    function startAtNow() {
      return view && view.inputs.start ? readSetting(view.inputs.start.value, 1, 1, 1e6, true) : readStart(storage, keyFor2(startKey, START_PREFIX + "this site"));
    }
    let formatChoice = readFormats(storage, keyFor2(formatsKey, FORMATS_PREFIX + "this site"));
    function paintRows(rows, ledger) {
      for (const each of rows) {
        const held = heldRow(ledger, each.identity.id);
        const status = held ? held.status : "";
        if (each.row.getAttribute(MARK) === (status || null)) continue;
        if (!status) {
          each.row.style.opacity = "";
          each.row.style.outline = "";
          each.row.removeAttribute(MARK);
          continue;
        }
        each.row.style.opacity = status === "confirmed" ? "0.45" : "";
        each.row.style.outline = status === "confirmed" ? "" : "2px dashed #c40";
        each.row.setAttribute(MARK, status);
      }
    }
    function clearRowPaint() {
      for (const node of document.querySelectorAll("[" + MARK + "]")) {
        node.style.opacity = "";
        node.style.outline = "";
        node.removeAttribute(MARK);
      }
    }
    let countsAt = 0;
    let countsTimer = null;
    function countsSoon() {
      if (countsTimer || !opened) return;
      const wait = Math.max(0, countsAt + 1e3 - Date.now());
      countsTimer = setTimeout(() => {
        countsTimer = null;
        try {
          showCounts();
        } catch {
        }
      }, wait);
    }
    function showCounts(rows) {
      if (!opened || !view) return;
      if (mode === "click") {
        zipShowCounts();
        return;
      }
      countsAt = Date.now();
      const live = rows || liveRows();
      const store = runStore || storeHere();
      const ledger = store.read();
      const start = startAtNow();
      const scope = start > 1 ? live.slice(start - 1) : live;
      const ofType = scope.filter((each) => wantsFormat(formatChoice, each.identity.format));
      const counts = pageCounts(ofType.map((each) => each.identity), ledger);
      const all = ledgerCounts(ledger);
      const alone = scope.length - ofType.length;
      view.setCounts(`${live.length} rows \xB7 ${counts.todo} to do \xB7 ${all.confirmed} confirmed` + (all.unconfirmed ? ` \xB7 ${all.unconfirmed} unconfirmed` : "") + (alone ? ` \xB7 ${alone} other types` : "") + (storage && store.saved() ? "" : " \xB7 \u26A0 not saving (storage blocked)"));
      paintRows(live, ledger);
      const shown = formatCounts(live.map((each) => each.identity));
      view.setTypes(shown.length > 1 || Array.isArray(formatChoice) ? shown.map((each) => ({ format: each.format, rows: each.rows, on: wantsFormat(formatChoice, each.format) })) : []);
      view.setSelectAll(selectAllLabel(rowsToSelect(live, formatChoice, start)));
    }
    let countWatch = null;
    function touchesBoxes(records) {
      const selector = learnedHere && targetRecord.kind === "box" ? targetRecord.tag : 'input[type="checkbox"], [role="checkbox"]';
      return records.some((record) => {
        if (isOurs(record.target)) return false;
        return [record.addedNodes, record.removedNodes].some((nodes) => Array.prototype.some.call(nodes || [], (node) => {
          if (!node || node.nodeType !== 1) return false;
          try {
            return typeof node.matches === "function" && node.matches(selector) || typeof node.querySelector === "function" && node.querySelector(selector) !== null;
          } catch {
            return false;
          }
        }));
      });
    }
    function watchCounts() {
      if (countWatch || typeof MutationObserver !== "function") return;
      try {
        countWatch = new MutationObserver((records) => {
          try {
            noticeFrames(records);
            if (mode === "tick" && touchesBoxes(records)) countsSoon();
          } catch {
          }
        });
        countWatch.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch {
        countWatch = null;
      }
    }
    let activeTag = null;
    let lastPress = null;
    let lastUse = null;
    let pressTiming = null;
    let ownSave = false;
    let current = null;
    let wrapped = null;
    const seen = [];
    const tracer = createTracer(300);
    const sink = {
      tag: () => ownSave ? null : activeTag,
      now: () => Date.now(),
      base: () => location.href,
      note: (event) => feed(event)
    };
    function noticeFrames(records) {
      if (activeTag === null) return;
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node && node.nodeName === "IFRAME") {
            feed({ kind: "iframe", at: Date.now(), batch: activeTag, url: String(node.src || ""), via: "added" });
          }
        }
      }
    }
    function remember(event) {
      const line = describeEvent(event, location.href);
      if (!line) return;
      let stamp = "";
      if (lastPress && Number.isFinite(event.at)) stamp = "+" + Math.max(0, Math.round((event.at - lastPress.at) / 1e3)) + "s ";
      const other = event.batch !== null && event.batch !== void 0 && lastPress && event.batch !== lastPress.batch ? "(batch " + event.batch + ") " : "";
      seen.push(stamp + other + line);
      if (seen.length > 40) seen.splice(0, seen.length - 40);
    }
    function feed(event) {
      if (!event) return;
      if (event.kind !== "clock") remember(event);
      if (activeTag !== null) tracer.note(event);
      if (event.kind === "response" && isFileEvidence(event) && event.batch !== null && event.batch !== void 0 && !(current && current.watch.batch === event.batch)) {
        (runStore || storeHere()).noteLate(event.batch, describeEvent(event, location.href), (/* @__PURE__ */ new Date()).toISOString());
      }
      if (current && current.watch.status === "waiting") {
        current.watch = observe(current.watch, event);
        if (current.watch.status !== "waiting") endWait();
      }
    }
    function endWait() {
      const finished = current;
      current = null;
      clearInterval(finished.timer);
      clearTimeout(finished.backstop);
      finished.resolve(finished.watch);
    }
    function showWaiting(watch) {
      const gone = Math.round((Date.now() - watch.pressedAt) / 1e3);
      const allowed = Math.round((watch.deadline - watch.pressedAt) / 1e3);
      say(`Batch ${watch.batch}: waiting for the file \xB7 ${gone}s of ${allowed}s` + (document.hidden ? " \xB7 tab in background, bring it to the front" : ""));
    }
    let resourceWatch = null;
    function watchResources(pressedAt) {
      stopResourceWatch();
      if (typeof PerformanceObserver !== "function" || typeof performance === "undefined") return;
      try {
        const pressPerf = performance.now();
        resourceWatch = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            try {
              if (TIMED_KINDS.indexOf(String(entry.initiatorType || "")) < 0) continue;
              feed(resourceEvent(entry, pressPerf, pressedAt));
            } catch {
            }
          }
        });
        resourceWatch.observe({ type: "resource", buffered: false });
      } catch {
        resourceWatch = null;
      }
    }
    function stopResourceWatch() {
      if (!resourceWatch) return;
      try {
        resourceWatch.disconnect();
      } catch {
      }
      resourceWatch = null;
    }
    function buttonState(node) {
      const state = { disabled: false, text: "", attached: true };
      try {
        state.disabled = !isReady(node);
        state.text = labelOf(node);
        state.attached = document.documentElement.contains(node);
      } catch {
      }
      return state;
    }
    function pressAndWatch(node, batch2, timeoutSeconds, timing) {
      return new Promise((resolve) => {
        seen.length = 0;
        activeTag = batch2;
        lastPress = { batch: batch2, at: Date.now() };
        pressTiming = timing || null;
        tracer.start(batch2, lastPress.at);
        if (timing) feed(Object.assign({ kind: "timing", at: lastPress.at, batch: batch2 }, timing));
        watchResources(lastPress.at);
        let lastState = buttonState(node);
        feed(Object.assign({ kind: "button", at: lastPress.at, batch: batch2 }, lastState));
        const limit = timeoutSeconds * 1e3;
        const mine = {
          watch: newWatch(batch2, lastPress.at, limit),
          // What the page did is shown only once a batch ends unconfirmed,
          // which is when it is worth reading.
          resolve(watch) {
            if (watch.status === "unconfirmed" && seen.length) {
              setDetails(`What the page did after batch ${batch2} was pressed` + (pressTiming && sinceLast(pressTiming) ? ` (${sinceLast(pressTiming)})` : "") + ":\n" + seen.slice(-12).join("\n"));
            }
            resolve(watch);
          },
          timer: null,
          backstop: null
        };
        current = mine;
        mine.timer = setInterval(() => {
          try {
            const state = buttonState(node);
            if (state.disabled !== lastState.disabled || state.text !== lastState.text || state.attached !== lastState.attached) {
              lastState = state;
              feed(Object.assign({ kind: "button", at: Date.now(), batch: batch2 }, state));
            }
            feed({ kind: "clock", at: Date.now() });
            if (current === mine) showWaiting(mine.watch);
          } catch {
          }
        }, 500);
        mine.backstop = setTimeout(() => {
          if (current === mine) {
            mine.watch = Object.assign({}, mine.watch, { status: "unconfirmed", reason: "timeout" });
            endWait();
          }
        }, limit + 5e3);
        try {
          node.click();
        } catch (error) {
          if (current === mine) {
            mine.watch = Object.assign({}, mine.watch, { status: "unconfirmed", reason: "the press failed: " + (error && error.message) });
            endWait();
          }
        }
      });
    }
    let listening = false;
    function listenForHandOver() {
      if (listening) return;
      listening = true;
      const shown = () => document.visibilityState !== "hidden";
      const quietly2 = (work) => (event) => {
        try {
          work(event);
        } catch {
        }
      };
      window.addEventListener("blur", quietly2((event) => {
        if (event && event.target !== window) return;
        feed({ kind: "blur", at: Date.now(), visible: shown() });
      }));
      window.addEventListener("focus", quietly2((event) => {
        if (event && event.target !== window) return;
        let has = false;
        try {
          has = document.hasFocus() === true;
        } catch {
          has = false;
        }
        feed({ kind: "focus", at: Date.now(), hasFocus: has, visible: shown() });
      }));
      document.addEventListener("visibilitychange", quietly2(() => feed({ kind: "visibility", at: Date.now(), visible: shown() })));
      window.addEventListener("beforeunload", quietly2(() => feed({ kind: "unload", at: Date.now() })));
      document.addEventListener("click", quietly2((event) => {
        if (activeTag === null || ownSave || !event || !event.target || typeof event.target.closest !== "function") return;
        const link = event.target.closest("a[href]");
        if (!link || isOurs(link)) return;
        feed({
          kind: "anchor",
          at: Date.now(),
          batch: activeTag,
          href: String(link.href || ""),
          download: String(link.getAttribute("download") || ""),
          via: "event"
        });
      }), true);
      document.addEventListener("submit", quietly2((event) => {
        if (activeTag === null || !event) return;
        const form = event.target || {};
        feed({
          kind: "submit",
          at: Date.now(),
          batch: activeTag,
          url: String(form.action || ""),
          method: String(form.method || "get").toUpperCase(),
          via: "submit event"
        });
      }), true);
    }
    let pageChangedAt = 0;
    let quietWatch = null;
    function watchQuiet() {
      if (quietWatch || typeof MutationObserver !== "function") return;
      try {
        quietWatch = new MutationObserver((records) => {
          for (const record of records) {
            const target = record.target;
            if (!target || isOurs(target)) continue;
            if (record.type === "attributes" && (record.attributeName === MARK || record.attributeName === "style" && typeof target.hasAttribute === "function" && target.hasAttribute(MARK))) {
              continue;
            }
            pageChangedAt = Date.now();
            return;
          }
        });
        quietWatch.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch {
        quietWatch = null;
      }
    }
    function stopQuietWatch() {
      if (!quietWatch) return;
      try {
        quietWatch.disconnect();
      } catch {
      }
      quietWatch = null;
    }
    function explainNoRows() {
      const boxes = Array.prototype.filter.call(document.querySelectorAll('input[type="checkbox"]'), (box) => !isOurs(box));
      const acting = Array.prototype.filter.call(
        document.querySelectorAll('[role="checkbox"], [aria-checked]'),
        (node) => !isOurs(node) && node.nodeName !== "INPUT"
      );
      const lines = [`The page has ${boxes.length} checkbox(es)` + (acting.length ? ` and ${acting.length} other element(s) acting as checkboxes` : "") + "."];
      const picked = [0, 1, Math.floor(boxes.length / 2), boxes.length - 1].filter((at, index, all) => at >= 0 && at < boxes.length && all.indexOf(at) === index);
      for (const at of picked) lines.push(`Box ${at + 1}: ${reader.explain(boxes[at])}`);
      if (acting.length) {
        lines.push(`First acting checkbox: <${String(acting[0].nodeName).toLowerCase()} class="` + String(acting[0].getAttribute("class") || "").slice(0, 60) + '">');
      }
      lines.push("If the rows are there, use Pick item and click one of their checkboxes.");
      setDetails(lines.join("\n"));
      return "Use Pick item, or see Details.";
    }
    const page = {
      rows: liveRows,
      take: (chosen, halted) => takeSelection(chosen, {
        rows: liveRows,
        locate: reader.locate,
        checked: reader.checked,
        button: () => {
          lastUse = buttonInUse();
          return lastUse.button;
        },
        sleep,
        now: () => Date.now(),
        halted
      }),
      press: pressAndWatch,
      abortWait: () => {
        if (current) feed({ kind: "stop", at: Date.now() });
      },
      untick: (chosen) => untickChosen(chosen, { rows: liveRows }),
      // A styled checkbox may be hidden behind its label: the row showing is enough.
      usable: (row3) => row3.box.disabled !== true && (onScreen(row3.box) || onScreen(row3.row)),
      quiet: (halted) => waitForQuiet(() => pageChangedAt, Date.now(), () => Date.now(), sleep, QUIET_MS, QUIET_CAP_MS, halted),
      explainNoRows,
      async loadMore(halted) {
        const live = reader.last().length ? reader.last() : liveRows();
        const control2 = loadMoreControl(live);
        if (!control2 || !isReady(control2)) return { pressed: false, grew: false, before: live.length, after: live.length };
        const boxCount = () => reader.source.boxes().length;
        const before = boxCount();
        say(`Pressing "${wordsOf(control2).slice(0, 30)}"\u2026`);
        control2.click();
        const grown = await waitForGrowth(boxCount, before, sleep, () => Date.now(), LOAD_MORE_WAIT * 1e3, halted);
        countsSoon();
        return { pressed: true, grew: grown.grew, before, after: grown.after };
      }
    };
    function saveText(text, name) {
      ownSave = true;
      try {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        link.download = name;
        link.style.display = "none";
        (document.body || document.documentElement).appendChild(link);
        link.click();
        link.remove();
        const made = link.href;
        setTimeout(() => {
          try {
            URL.revokeObjectURL(made);
          } catch {
          }
        }, 3e4);
      } finally {
        ownSave = false;
      }
    }
    function saveExport() {
      storeHere();
      const ledgers = siteLedgers(storage, stores, LEDGER_PREFIX);
      const now = /* @__PURE__ */ new Date();
      const out = buildExport(ledgers, {
        at: now.toISOString(),
        origin: location.origin,
        script: `popup-zapper ${version} batch clicker`,
        traces: tracer.all()
      });
      if (!out.totals.confirmed && !out.totals.unconfirmed) return "";
      const name = `document-ledger-${location.hostname || "page"}-${fileStamp(now)}.json`;
      saveText(JSON.stringify(out, null, 2), name);
      return name;
    }
    const runner = createRunner({
      store: () => {
        runStore = storeHere();
        return runStore;
      },
      page,
      settings: () => ({
        size: view && view.inputs.size ? readSetting(view.inputs.size.value, DEFAULT_BATCH, 1, 50, true) : batchSize,
        startAt: startAtNow(),
        retrySize: DEFAULT_RETRY_BATCH,
        timeout: DEFAULT_TIMEOUT,
        settle: DEFAULT_SETTLE
      }),
      sleep,
      now: () => Date.now(),
      iso: () => (/* @__PURE__ */ new Date()).toISOString(),
      where: () => (location.search + location.hash).slice(0, 200),
      say,
      showState: (state) => {
        if (view) view.setPlay(state);
      },
      refresh: countsSoon,
      siteDocuments: () => {
        storeHere();
        return siteTotals(storage, stores, LEDGER_PREFIX).documents;
      },
      saveExport,
      forgetSite: () => {
        storeHere();
        return forgetSite(storage, stores, LEDGER_PREFIX);
      },
      confirm: () => true,
      formats: () => formatChoice,
      // The wrappers go on at the first Play, never at load: until a run
      // begins, the tool changes nothing on any site.
      begin() {
        setDetails("");
        if (!wrapped) {
          wrapped = installWrappers(pageWindow2, sink);
          installStartWrappers(pageWindow2, sink);
        }
        listenForHandOver();
        watchCounts();
        watchQuiet();
      },
      end() {
        activeTag = null;
        runStore = null;
        stopResourceWatch();
        stopQuietWatch();
        if (current) {
          clearInterval(current.timer);
          clearTimeout(current.backstop);
          current = null;
        }
      }
    });
    function clickControls() {
      if (learnedHere && targetRecord.kind === "button") return learnedMatches();
      let nodes = [];
      try {
        nodes = document.querySelectorAll(ZIP_LOOKS);
      } catch {
        nodes = [];
      }
      const found = [];
      for (const node of nodes) {
        const raw = String(node.textContent || node.value || "");
        if (raw.length > 60 || isOurs(node)) continue;
        if (!isAddText(raw) && !isInZipText(raw)) continue;
        const control2 = typeof node.closest === "function" ? node.closest('button, a, [role="button"], input') || node : node;
        if (found.indexOf(control2) < 0 && !isOurs(control2)) found.push(control2);
      }
      return found.filter((each) => !found.some((other) => other !== each && each.contains(other)));
    }
    function zipCards() {
      const controls = clickControls();
      const raw = controls.map((control2) => {
        let node = control2;
        for (let step = 0; step < ROW_DEPTH; step++) {
          const up = node.parentElement;
          if (!up || up === document.body || up === document.documentElement) break;
          if (controls.filter((each) => up.contains(each)).length > 1) break;
          node = up;
        }
        const title = collapse(String(node.textContent || "").replace(String(control2.textContent || ""), " ")) || "(no title)";
        let href = "";
        try {
          const link = node.querySelector("a[href]");
          href = link && link !== control2 && !/^javascript:/i.test(link.href) ? shortUrl(link.href, location.href) : "";
        } catch {
          href = "";
        }
        return { node, control: control2, title: title.slice(0, 200), id: normaliseText(title) + (href ? " | " + href : "") };
      });
      const ids = numberIdentities(raw.map((each) => ({ id: each.id })));
      return raw.map((each, at) => {
        const card = { id: ids[at].id, title: each.title, node: each.node, control: each.control };
        card.words = () => {
          const live = liveControl(card);
          return live ? labelOf(live) || String(live.textContent || "") : "";
        };
        card.clickable = () => zipClickable(liveControl(card));
        return card;
      });
    }
    function liveControl(card) {
      if (card.control && card.control.isConnected !== false) return card.control;
      if (card.node && card.node.isConnected !== false) {
        const inside = clickControls().filter((each) => card.node.contains(each));
        if (inside.length) {
          card.control = inside[0];
          return card.control;
        }
      }
      const again = zipCards().filter((each) => each.id === card.id)[0];
      if (again) {
        card.node = again.node;
        card.control = again.control;
        return card.control;
      }
      return null;
    }
    function zipClickable(control2) {
      if (!control2 || control2.isConnected === false || !isReady(control2)) return false;
      if (/(^|\s)(is-)?disabled(\s|$)/i.test(String(control2.getAttribute ? control2.getAttribute("class") || "" : ""))) return false;
      try {
        const style = window.getComputedStyle(control2);
        if (style.pointerEvents === "none" || style.visibility === "hidden") return false;
      } catch {
      }
      return onScreen(control2);
    }
    function itemState(card) {
      const live = liveControl(card);
      if (!live) return "other";
      const words = labelOf(live) || String(live.textContent || "");
      if (isInZipText(words)) return "in";
      if (!learnedHere || targetRecord.kind !== "button") return isAddText(words) ? "ready" : "other";
      const said = live.getAttribute && (live.getAttribute("aria-pressed") || live.getAttribute("aria-checked"));
      if (said === "true") return "in";
      return !targetRecord.words || buttonWords(words) === targetRecord.words ? "ready" : "other";
    }
    function zipCounter() {
      let nodes = [];
      try {
        nodes = document.querySelectorAll('[class*="zip"], [class*="basket"], [class*="count"], [class*="badge"], [id*="zip"], [id*="basket"]');
      } catch {
        nodes = [];
      }
      return Array.prototype.filter.call(nodes, (node) => {
        const text = String(node.textContent || "");
        return !isOurs(node) && text.length <= 40 && /\d/.test(text);
      }).map((node) => collapse(node.textContent)).join(" | ");
    }
    function pressZip(card) {
      return new Promise((resolve) => {
        const control2 = liveControl(card);
        const before = { inner: card.node.innerHTML, cls: String(card.node.className), counter: zipCounter() };
        try {
          control2.click();
        } catch (error) {
          resolve({ added: false, why: "the press failed: " + (error && error.message) });
          return;
        }
        const start = Date.now();
        const look = () => {
          try {
            if (itemState(card) === "in") {
              resolve({ added: true, why: `now reads "${collapse(card.words())}"` });
              return;
            }
            if (card.node.isConnected !== false && (card.node.innerHTML !== before.inner || String(card.node.className) !== before.cls)) {
              resolve({ added: true, why: "the item changed when pressed" });
              return;
            }
            const counter = zipCounter();
            if (counter !== before.counter) {
              resolve({ added: true, why: "the count changed: " + counter.slice(0, 60) });
              return;
            }
          } catch {
          }
          if (Date.now() - start >= ZIP_RESPONSE_MS) {
            resolve({ added: false, why: "nothing on the page changed" });
            return;
          }
          setTimeout(look, 50);
        };
        setTimeout(look, 50);
      });
    }
    function paintZip(card, status) {
      const node = card && card.node;
      const look = ZIP_LOOK[status];
      if (!node || !node.style || !look || node.getAttribute(ZIP_MARK) === status) return;
      node.style.outline = look[0];
      node.style.outlineOffset = "-3px";
      node.setAttribute(ZIP_MARK, status);
      node.setAttribute("title", look[1]);
    }
    function clearZipPaint() {
      for (const node of document.querySelectorAll("[" + ZIP_MARK + "]")) {
        node.style.outline = "";
        node.style.outlineOffset = "";
        node.removeAttribute(ZIP_MARK);
        node.removeAttribute("title");
      }
    }
    const zipStores = /* @__PURE__ */ new Map();
    function zipStoreHere() {
      const key = keyFor2(zipLedgerKey, "qs-intelligence zip ledger this page");
      if (!zipStores.has(key)) zipStores.set(key, openZipStore(storage, key));
      return zipStores.get(key);
    }
    function zipShowCounts() {
      if (!opened || !view || mode !== "click") return;
      const cards = zipCards();
      const store = zipStoreHere();
      const ledger = store.read();
      for (const card of cards) {
        const held = owns(ledger.cards, card.id) ? ledger.cards[card.id] : null;
        if (held) paintZip(card, held.status);
        else if (itemState(card) === "in") paintZip(card, "added");
      }
      view.setCounts(zipSummary(zipCounts(cards, ledger, (card) => itemState(card) === "in"), zipAddedCount(ledger)) + (storage && store.saved() ? "" : " \xB7 \u26A0 not saving (storage blocked)"));
      const odd = Object.keys(ledger.cards).filter((id) => ledger.cards[id].status !== "added").map((id) => {
        const held = ledger.cards[id];
        return (held.status === "refused" ? "not clickable   " : "no change       ") + String(held.title || id).slice(0, 80);
      });
      if (!odd.length && detailsText.startsWith("Do these by hand")) setDetails("");
      else if (odd.length) setDetails("Do these by hand:\n" + odd.join("\n"));
    }
    function nextControls() {
      const cards = zipCards();
      const lastCard = cards.length ? cards[cards.length - 1].node : null;
      return findNextControls(document, lastCard, { isOurs, onScreen, win: window });
    }
    const cardSignature = () => zipCards().map((card) => card.id).join("\n");
    function turnPage() {
      const found = nextControls().filter((each) => zipClickable(each.control));
      if (!found.length) {
        return Promise.resolve({ pressed: false, why: nextControls().length ? "the next page button is disabled" : "nothing leads further" });
      }
      const before = cardSignature();
      const tryOne = (at) => new Promise((resolve) => {
        const one = found[at];
        say(`Page done; next page (${one.how})\u2026`);
        try {
          one.control.click();
        } catch {
          resolve(false);
          return;
        }
        const start = Date.now();
        const look = () => {
          let now = "";
          try {
            now = cardSignature();
          } catch {
            now = "";
          }
          if (now && now !== before) {
            setTimeout(() => resolve(true), 600);
            return;
          }
          if (Date.now() - start >= NEXT_WAIT_MS) {
            resolve(false);
            return;
          }
          setTimeout(look, 250);
        };
        setTimeout(look, 250);
      });
      return (async () => {
        for (let at = 0; at < found.length && at < 2; at++) {
          if (await tryOne(at)) return { pressed: true, changed: true, how: found[at].how };
        }
        return { pressed: true, changed: false };
      })();
    }
    function zipHolds() {
      let nodes = [];
      try {
        nodes = document.querySelectorAll('button, a, [role="button"], span, div');
      } catch {
        nodes = [];
      }
      for (const node of nodes) {
        const text = String(node.textContent || "");
        if (text.length > 40 || isOurs(node)) continue;
        const found = HOLDS_TEXT.exec(collapse(text));
        if (found) return Number(found[1] || found[2]);
      }
      return null;
    }
    const zipLimitNow = () => view && view.inputs.limit ? readSetting(view.inputs.limit.value, DEFAULT_ZIP_LIMIT, 1, 1e5, true) : readZipLimit(storage, keyFor2(zipLimitKey, ZIP_LIMIT_PREFIX + "this site"));
    const autoKey = () => keyFor2(zipAutoKey, ZIP_AUTO_PREFIX + "this site");
    const zipRunner = createClickRunner({
      page: { cards: zipCards, press: pressZip, paint: paintZip, next: turnPage, state: itemState },
      get store() {
        return zipStoreHere();
      },
      sleep,
      get gap() {
        return learnedHere ? PICKED_GAP : ZIP_GAP;
      },
      iso: () => (/* @__PURE__ */ new Date()).toISOString(),
      where: () => (location.search + location.hash).slice(0, 200),
      say,
      showState: (state) => {
        if (view) view.setPlay(state);
      },
      setAuto: (on) => writeZipAuto(storage, autoKey(), on, Date.now()),
      refresh: zipShowCounts,
      confirm: () => true,
      limit: zipLimitNow,
      zipHolds
    });
    let zipWatch = null;
    let zipSoon = null;
    let zipIds = "";
    function watchZip() {
      if (zipWatch || typeof MutationObserver !== "function") return;
      try {
        zipWatch = new MutationObserver((records) => {
          if (records.every((record) => isOurs(record.target)) || zipSoon) return;
          zipSoon = setTimeout(() => {
            zipSoon = null;
            try {
              if (mode !== "click") return;
              const ids = cardSignature();
              const changed = ids !== zipIds;
              zipIds = ids;
              zipShowCounts();
              if (changed) zipRunner.pageChanged();
            } catch {
            }
          }, 400);
        });
        zipWatch.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch {
        zipWatch = null;
      }
    }
    let picking = null;
    let disarmPick = null;
    let hovered = null;
    function unhover() {
      if (hovered) {
        hovered.el.style.outline = hovered.was;
        hovered = null;
      }
    }
    function onHover(event) {
      if (!event || isOurs(event.target)) {
        unhover();
        return;
      }
      const found = picking === "item" || picking === "refine" ? resolveTarget(event.target) : null;
      const el = found ? found.node : event.target && event.target.closest ? event.target.closest(CLICKABLE2) || event.target : null;
      if (!el || hovered && hovered.el === el) return;
      unhover();
      hovered = { el, was: el.style.outline };
      el.style.outline = "2px dashed #ff3b30";
    }
    function stopPicking() {
      if (disarmPick) {
        disarmPick();
        disarmPick = null;
      }
      if (picking) document.removeEventListener("mouseover", onHover, true);
      unhover();
      const refining = picking === "refine";
      picking = null;
      labelPickers();
      if (refining) showPreview();
    }
    const previewed = /* @__PURE__ */ new Map();
    function clearPreview() {
      for (const [node, was] of previewed) {
        try {
          node.style.outline = was;
        } catch {
        }
      }
      previewed.clear();
    }
    function mark(node, outline) {
      if (!previewed.has(node)) previewed.set(node, node.style.outline);
      node.style.outline = outline;
    }
    function showPreview() {
      clearPreview();
      if (!opened || !learnedHere || busy()) return;
      const taken = learnedMatches();
      for (const node of taken.slice(0, 1e3)) mark(node, "2px solid #2e7d32");
      if (picking === "refine") {
        const kept = new Set(taken);
        for (const node of lookAlikes().slice(0, 1e3)) if (!kept.has(node)) mark(node, "2px dashed #9e9e9e");
      }
    }
    function labelPickers() {
      if (!view) return;
      view.setRefine(picking === "refine" ? "\u2713 Done" : "\u270E Refine");
      view.setPickItem(
        picking === "item" ? "Cancel picking" : !targetRecord ? "\u2610 Pick item" : learnedHere ? `\u2611 Item: ${targetRecord.kind === "box" ? "checkbox" : "button"}` : "\u2611 Item (not on this page)",
        !!targetRecord && picking !== "item"
      );
      view.setPickButton(picking === "button" ? "Cancel picking" : buttonRecord ? "\u2B07 Download button \u2713" : "\u2B07 Download button");
    }
    function startPicking(kind, picked) {
      picking = kind;
      labelPickers();
      document.addEventListener("mouseover", onHover, true);
      disarmPick = armCapture(window, isOurs, (target) => {
        stopPicking();
        picked(target);
      });
    }
    function busy() {
      return runner.state() !== "idle" || zipRunner.state() !== "idle" || selectingAll;
    }
    function learnItem(target) {
      const found = resolveTarget(target);
      if (!found) {
        say("Nothing there to learn.");
        return;
      }
      let record = describeTarget(found.node, found.kind);
      if (!record.chain.length) {
        say("That can't be found again. Pick something inside the page.");
        return;
      }
      const alike = lookAlikes(record);
      if (record.kind === "button" && record.words) {
        const same = alike.filter((el) => buttonWords(labelOf(el)) === record.words).length;
        if (same < 2) record.words = "";
      }
      record = narrowRecord(record, found.node, alike);
      targetRecord = record;
      const kept = writeTargetRecord(storage, keyFor2(targetKey, TARGET_PREFIX + "this site"), record);
      clearRowPaint();
      clearZipPaint();
      makeReader();
      rebuild();
      const taken = learnedMatches().length;
      say(`Learned: ${taken} ${record.kind === "box" ? "checkbox(es)" : "button(s)"} of this kind` + (alike.length > taken ? ` (${alike.length} look alike).` : ".") + (record.link ? " They are plain links, so clicking each may open pages." : "") + (kept ? "" : " Storage refused, so it lasts until reload."));
    }
    function saveTarget() {
      return writeTargetRecord(storage, keyFor2(targetKey, TARGET_PREFIX + "this site"), targetRecord);
    }
    function setVariantOn(on) {
      if (busy()) {
        say("Stop the run first.");
        return;
      }
      if (!targetRecord) return;
      targetRecord = Object.assign({}, targetRecord, { variantOn: !!on });
      saveTarget();
      clearRowPaint();
      clearZipPaint();
      rebuild();
      say(on ? `Only this kind: ${learnedMatches().length}.` : `Every look-alike: ${learnedMatches().length}.`);
    }
    function refineWith(target) {
      const found = resolveTarget(target);
      const alike = lookAlikes();
      if (!found || alike.indexOf(found.node) < 0) {
        say("That isn't like the picked item. Click a green one, or a grey dashed one.");
        return;
      }
      const wanted = learnedMatches().indexOf(found.node) < 0;
      const before = learnedMatches().length;
      targetRecord = refineRecord(Object.assign({}, targetRecord, { variantOn: true }), found.node, wanted, alike);
      saveTarget();
      clearRowPaint();
      clearZipPaint();
      rebuild();
      const now = learnedMatches();
      if (!wanted && now.indexOf(found.node) >= 0) {
        say("That one can't be told apart from the one you picked, so it stays. Pick item again to start over.");
      } else {
        say(`${wanted ? "Taken in" : "Left out"}: now ${now.length} of ${alike.length} (was ${before}). Click more, or Done.`);
      }
    }
    function refine() {
      if (picking === "refine") {
        stopPicking();
        say(`Refined: ${learnedMatches().length} of this kind.`);
        return;
      }
      if (busy()) {
        say("Stop the run first.");
        return;
      }
      if (!learnedHere) {
        say("Pick an item on this page first.");
        return;
      }
      stopPicking();
      picking = "refine";
      labelPickers();
      document.addEventListener("mouseover", onHover, true);
      const arm = () => {
        disarmPick = armCapture(window, isOurs, (target) => {
          disarmPick = null;
          refineWith(target);
          if (picking === "refine") {
            arm();
            showPreview();
          }
        });
      };
      arm();
      showPreview();
      say("Click a green one to leave its kind out, or a grey dashed one to take its kind in. Done when right.");
    }
    function pickItem() {
      if (picking === "item") {
        stopPicking();
        say("Picking cancelled.");
        return;
      }
      if (busy()) {
        say("Stop the run first.");
        return;
      }
      stopPicking();
      say("Click one of the things to click many of: a checkbox or a button.");
      startPicking("item", learnItem);
    }
    function setKind(kind) {
      if (busy()) {
        say("Stop the run first.");
        return;
      }
      if (!targetRecord || kind !== "box" && kind !== "button") return;
      targetRecord = Object.assign({}, targetRecord, { kind });
      saveTarget();
      clearRowPaint();
      clearZipPaint();
      makeReader();
      rebuild();
      say(kind === "box" ? "Ticking these in batches." : "Clicking each of these once.");
    }
    function forgetItem() {
      if (busy()) {
        say("Stop the run first.");
        return;
      }
      stopPicking();
      targetRecord = null;
      clearPreview();
      writeTargetRecord(storage, keyFor2(targetKey, TARGET_PREFIX + "this site"), null);
      clearRowPaint();
      clearZipPaint();
      makeReader();
      rebuild();
      say("Forgot the picked item; finding items automatically.");
    }
    function chosenAsButton(target) {
      if (!target) return;
      const node = typeof target.closest === "function" ? target.closest(CLICKABLE2) || target : target;
      liveRows();
      if (insideRows(node)) {
        say("That is inside a row. Pick the page's own download button.");
        return;
      }
      const record = describeButton(node);
      if (!record.words) {
        say("That has no words to find it by. Pick the download button itself.");
        return;
      }
      buttonRecord = record;
      buttonCache = null;
      const kept = writeButtonRecord(storage, keyFor2(buttonKey, BUTTON_PREFIX + "this site"), record);
      try {
        node.style.outline = "3px solid #c40";
      } catch {
      }
      labelPickers();
      sayButtonInUse(kept ? "" : "Storage refused, so it lasts until reload. ");
    }
    function pickDownloadButton() {
      if (picking === "button") {
        stopPicking();
        sayButtonInUse("Picking cancelled. ");
        return;
      }
      if (busy()) {
        say("Stop the run first.");
        return;
      }
      stopPicking();
      say("Click the page's own download button. That click is kept from the page.");
      startPicking("button", chosenAsButton);
    }
    let selectingAll = false;
    function selectAll() {
      stopPicking();
      if (selectingAll) return;
      if (runner.state() !== "idle") {
        say("Pause or Stop the run first.");
        return;
      }
      selectingAll = true;
      (async () => {
        try {
          const done = tickAll(rowsToSelect(liveRows(), formatChoice, startAtNow()), page.usable);
          if (done.changed) await sleep(0.5);
          const live = liveRows();
          const kept = rowsToSelect(live, formatChoice, startAtNow()).filter((each) => isTicked(each.box)).length;
          const use = buttonInUse();
          say(selectAllReport(done, kept, use.button ? labelOf(use.button) : ""));
          showCounts(live);
        } catch (error) {
          say("Select all stopped on a script fault: " + (error && error.message ? error.message : String(error)) + ".");
        } finally {
          selectingAll = false;
        }
      })();
    }
    function play() {
      stopPicking();
      clearPreview();
      if (mode === "click") {
        zipRunner.play();
        return;
      }
      if (runner.state() === "running") runner.pause();
      else runner.play();
    }
    function stop() {
      stopPicking();
      if (mode === "click") zipRunner.stop();
      else runner.stop();
    }
    function reset() {
      stopPicking();
      const active = mode === "click" ? zipRunner : runner;
      if (active.state() !== "idle") {
        say("Stop the run before Reset.");
        return;
      }
      const count = mode === "click" ? Object.keys(zipStoreHere().read().cards).length : (storeHere(), siteTotals(storage, stores, LEDGER_PREFIX).documents);
      if (!count) {
        say(mode === "click" ? "The click ledger is already empty." : "The ledger is already empty.");
        return;
      }
      if (Date.now() > resetArmed) {
        resetArmed = Date.now() + 4e3;
        if (view) view.setReset("Confirm reset?");
        say(`Press again to forget ${count} ${mode === "click" ? "item(s)" : "document(s)"} on this site.`);
        setTimeout(() => {
          if (view && Date.now() > resetArmed) view.setReset("\u21BA Reset");
        }, 4100);
        return;
      }
      resetArmed = 0;
      if (view) view.setReset("\u21BA Reset");
      if (active.reset()) {
        if (mode === "click") clearZipPaint();
        else clearRowPaint();
      }
      showCounts();
    }
    function setSize(value) {
      batchSize = readSetting(value, DEFAULT_BATCH, 1, 50, true);
      if (view && view.inputs.size) view.inputs.size.value = String(batchSize);
    }
    function setStart(value) {
      const start = readSetting(value, 1, 1, 1e6, true);
      if (view && view.inputs.start) view.inputs.start.value = String(start);
      const kept = writeStart(storage, keyFor2(startKey, START_PREFIX + "this site"), start);
      showCounts();
      say((start > 1 ? `Runs start at row ${start}.` : "Runs start at the first row.") + (kept ? "" : " Storage refused; lasts until reload."));
    }
    function setLimit(value) {
      const limit = readSetting(value, DEFAULT_ZIP_LIMIT, 1, 1e5, true);
      if (view && view.inputs.limit) view.inputs.limit.value = String(limit);
      const kept = writeZipLimit(storage, keyFor2(zipLimitKey, ZIP_LIMIT_PREFIX + "this site"), limit);
      say(`Stops after ${limit}.` + (kept ? "" : " Storage refused; lasts until reload."));
    }
    function flipType(format) {
      const shown = formatCounts(reader.last().map((each) => each.identity)).map((each) => each.format);
      formatChoice = toggleFormat(formatChoice, format, shown);
      const kept = writeFormats(storage, keyFor2(formatsKey, FORMATS_PREFIX + "this site"), formatChoice);
      showCounts();
      say(describeFormats(formatChoice) + (runner.state() === "idle" ? "" : " From the next batch.") + (kept ? "" : " Storage refused; lasts until reload."));
    }
    function readPosition() {
      try {
        const held = JSON.parse(storage && storage.getItem(POSITION_KEY) || "null");
        if (held && Number.isFinite(held.left) && Number.isFinite(held.top) && held.left < window.innerWidth - 40 && held.top < window.innerHeight - 30) {
          return held;
        }
      } catch {
      }
      return null;
    }
    function savePosition(spot) {
      try {
        if (storage) storage.setItem(POSITION_KEY, JSON.stringify(spot));
      } catch {
      }
    }
    function decideMode() {
      if (learnedHere) return targetRecord.kind === "box" ? "tick" : "click";
      if (liveRows().length) return "tick";
      if (clickControls().length) return "click";
      return "tick";
    }
    function variantCounts() {
      if (!learnedHere) return null;
      const withKind = Object.assign({}, targetRecord, { variantOn: true });
      const kind = keepPlaces(lookAlikes().filter((el) => matchesTarget(el, withKind)), withKind.variant).length;
      return { on: targetRecord.variantOn !== false, kind, all: lookAlikes().length };
    }
    function build() {
      view = createBatchPanel({
        mode,
        kind: learnedHere ? targetRecord.kind : null,
        onKind: setKind,
        variant: variantCounts(),
        onVariant: setVariantOn,
        onRefine: refine,
        batchSize,
        startAt: readStart(storage, keyFor2(startKey, START_PREFIX + "this site")),
        limit: readZipLimit(storage, keyFor2(zipLimitKey, ZIP_LIMIT_PREFIX + "this site")),
        position: readPosition(),
        onClose: close,
        onPlay: play,
        onStop: stop,
        onReset: reset,
        onPickItem: pickItem,
        onForgetItem: forgetItem,
        onPickButton: pickDownloadButton,
        onSelectAll: selectAll,
        onSize: setSize,
        onStart: setStart,
        onLimit: setLimit,
        onType: flipType,
        onSteps
      });
      (document.body || document.documentElement).appendChild(view.el);
      makeDraggable(view.el, view.head, savePosition);
      view.setPlay(mode === "click" ? zipRunner.state() : runner.state());
      view.setStatus(statusText);
      view.setDetails(detailsText);
      labelPickers();
    }
    function rebuild() {
      if (!opened) return;
      makeReader();
      const nextMode = decideMode();
      if (view) view.el.remove();
      mode = nextMode;
      build();
      if (mode === "click") {
        clearRowPaint();
        zipIds = cardSignature();
        watchZip();
      } else {
        clearZipPaint();
        watchCounts();
      }
      showCounts();
      showPreview();
    }
    function first() {
      if (mode === "click") {
        const cards = zipCards().length;
        say(cards ? `${cards} item(s) to click. Play clicks each, page by page.` : "No items found. Use Pick item.");
      } else {
        const rows = reader.last().length;
        if (rows) sayButtonInUse(`${rows} row(s). `);
        else say("No rows found yet. Use Pick item, or wait for the page to draw them.");
      }
    }
    let rescans = [];
    function open() {
      if (opened) return;
      opened = true;
      makeReader();
      mode = decideMode();
      statusText = "Ready.";
      detailsText = "";
      build();
      if (mode === "click") {
        zipIds = cardSignature();
        watchZip();
      } else watchCounts();
      showCounts();
      showPreview();
      first();
      rescans = [1500, 4e3, 8e3].map((wait) => setTimeout(() => {
        try {
          if (!opened || busy() || picking) return;
          const was = { mode, learnedHere };
          makeReader();
          const now = decideMode();
          if (now !== was.mode || learnedHere !== was.learnedHere) {
            rebuild();
            first();
          } else {
            showCounts();
            if (/^No (rows|items) found/.test(statusText)) first();
          }
        } catch {
        }
      }, wait));
    }
    function close() {
      if (!opened) return true;
      if (busy()) {
        say("Stop the run first, then close.");
        return false;
      }
      stopPicking();
      for (const timer of rescans) clearTimeout(timer);
      rescans = [];
      if (countWatch) {
        try {
          countWatch.disconnect();
        } catch {
        }
        countWatch = null;
      }
      if (zipWatch) {
        try {
          zipWatch.disconnect();
        } catch {
        }
        zipWatch = null;
      }
      clearTimeout(countsTimer);
      countsTimer = null;
      clearRowPaint();
      clearZipPaint();
      clearPreview();
      if (view) view.el.remove();
      view = null;
      opened = false;
      return true;
    }
    function repaint2() {
      if (!opened) return;
      if (view) view.el.remove();
      build();
      showCounts();
      showPreview();
    }
    function resume() {
      if (!readZipAuto(storage, autoKey(), Date.now())) return false;
      open();
      const tryPlay = () => {
        if (!opened || zipRunner.state() !== "idle" || !readZipAuto(storage, autoKey(), Date.now())) return;
        if (mode !== "click") {
          mode = decideMode();
          if (mode === "click") rebuild();
        }
        if (mode === "click" && zipCards().length) {
          say("Carrying on from the last page.");
          zipRunner.play();
        }
      };
      tryPlay();
      for (const wait of [1500, 4e3, 8e3]) setTimeout(tryPlay, wait);
      return true;
    }
    return {
      open,
      close,
      toggle: () => opened ? close() : (open(), true),
      isOpen: () => opened,
      repaint: repaint2,
      resume
    };
  }

  // src/lib/recorder/store.js
  var LIVE = "pz-rec live";
  var LEAVING = "pz-rec leaving";
  var BEAT = "pz-rec beat";
  var RECORDING = "pz-rec recording ";
  var LEDGER = "pz-rec ledger ";
  var owns2 = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);
  function parse(raw) {
    if (typeof raw !== "string" || !raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function asLive(value) {
    if (!isObject(value) || typeof value.mode !== "string") return { mode: "idle", closing: [], note: "" };
    return Object.assign({}, value, {
      closing: Array.isArray(value.closing) ? value.closing : [],
      note: typeof value.note === "string" ? value.note : ""
    });
  }
  function asLedger(value) {
    return isObject(value) && isObject(value.rows) ? value : { rows: {} };
  }
  function createRecorderStore(gm2) {
    const read = async (key) => parse(await gm2.get(key, null));
    const write = (key, value) => gm2.set(key, value === null ? "" : JSON.stringify(value));
    return {
      readLive: async () => asLive(await read(LIVE)),
      // Null when the manager cannot read at once.
      readLiveNow() {
        const raw = gm2.getNow(LIVE);
        return raw === void 0 ? null : asLive(parse(raw));
      },
      writeLive: (live) => write(LIVE, live),
      writeLiveNow: (live) => gm2.setNow(LIVE, JSON.stringify(live)),
      readLeaving: async () => {
        const value = await read(LEAVING);
        return isObject(value) && typeof value.token === "string" ? value : null;
      },
      writeLeavingNow: (leaving) => gm2.setNow(LEAVING, JSON.stringify(leaving)),
      readBeat: async () => {
        const value = await read(BEAT);
        return isObject(value) && typeof value.token === "string" && Number.isFinite(value.at) ? value : null;
      },
      writeBeatNow: (beat) => gm2.setNow(BEAT, JSON.stringify(beat)),
      readRecording: async (origin2) => {
        const value = await read(RECORDING + origin2);
        return isObject(value) && Array.isArray(value.steps) ? value : null;
      },
      writeRecording: (origin2, rec) => write(RECORDING + origin2, rec),
      readLedger: async (origin2) => asLedger(await read(LEDGER + origin2)),
      writeLedger: (origin2, ledger) => write(LEDGER + origin2, ledger)
    };
  }
  function markRow(ledger, id, { status, title, note = "", at, page }) {
    const rows = Object.assign({}, ledger.rows, { [id]: { status, title: String(title || "").slice(0, 200), note, at, page } });
    return Object.assign({}, ledger, { rows });
  }
  function ledgerTally(ledger) {
    const tally = { done: 0, skipped: 0, failed: 0 };
    for (const id of Object.keys(ledger.rows)) {
      const status = ledger.rows[id].status;
      if (owns2(tally, status)) tally[status] += 1;
    }
    return tally;
  }
  function forgetFailed(ledger) {
    const rows = {};
    for (const id of Object.keys(ledger.rows)) if (ledger.rows[id].status !== "failed") rows[id] = ledger.rows[id];
    return Object.assign({}, ledger, { rows });
  }
  function undoLast(ledger) {
    let last = null;
    for (const id of Object.keys(ledger.rows)) {
      const held2 = ledger.rows[id];
      if (held2.status !== "done" && held2.status !== "skipped") continue;
      if (!last || String(held2.at || "") >= String(ledger.rows[last].at || "")) last = id;
    }
    if (!last) return { ledger, row: null };
    const rows = Object.assign({}, ledger.rows);
    const held = rows[last];
    delete rows[last];
    return { ledger: Object.assign({}, ledger, { rows }), row: { id: last, title: held.title, status: held.status } };
  }
  function ledgerLines(ledger) {
    return Object.keys(ledger.rows).filter((id) => ledger.rows[id].status !== "done").map((id) => {
      const held = ledger.rows[id];
      return (held.status + "        ").slice(0, 8) + " " + String(held.title || id).slice(0, 80) + (held.note ? ": " + held.note : "");
    });
  }

  // src/lib/recorder/steps.js
  var DEFAULT_LINGER = 5;
  var DEFAULT_TIMEOUT2 = 30;
  function newDraft({ origin: origin2, listUrl, homeTab, visit }) {
    return { origin: origin2, listUrl, homeTab, steps: [], firstRow: null, rowVisit: null, lastTab: homeTab, lastVisit: visit };
  }
  function lastInTab(steps, tab) {
    for (let at = steps.length - 1; at >= 0; at--) if (steps[at].tab === tab) return steps[at];
    return null;
  }
  function addClick(draft, { tab, origin: origin2, path, visit, target, scope, row: row3 }) {
    const before = lastInTab(draft.steps, tab);
    const afterLoad = !!before && (before.kind === "back" || before.visit !== visit);
    const step = { kind: "click", tab, origin: origin2, path, visit, target, scope: scope === "row" ? "row" : "page", afterLoad, opens: false };
    const next = Object.assign({}, draft, { steps: draft.steps.concat([step]), lastTab: tab, lastVisit: visit });
    if (!draft.steps.length && step.scope === "row" && row3) {
      next.firstRow = { id: row3.id, title: row3.title };
      next.rowVisit = visit;
    }
    return next;
  }
  function addBack(draft, { tab, origin: origin2, visit }) {
    if (!draft.steps.length) return draft;
    const step = { kind: "back", tab, origin: origin2, visit };
    return Object.assign({}, draft, { steps: draft.steps.concat([step]), lastTab: tab, lastVisit: visit });
  }
  function finishRecording(draft, previous, { linger = DEFAULT_LINGER, now = Date.now() } = {}) {
    const steps = draft && draft.steps || [];
    if (!steps.length) return { recording: null, problem: "Nothing was recorded." };
    if (steps[0].kind !== "click" || steps[0].scope !== "row") {
      return { recording: null, problem: "Start with a click on an item in the list." };
    }
    const home = draft.homeTab;
    const out = [];
    const seen = /* @__PURE__ */ new Set([home]);
    const opened = [];
    const closed = /* @__PURE__ */ new Set();
    const closeGone = (from) => {
      const gone = opened.filter((tab) => !closed.has(tab) && !steps.slice(from).some((step) => step.tab === tab));
      gone.forEach((tab, at) => {
        if (at === 0) out.push({ kind: "wait", tab, seconds: linger });
        out.push({ kind: "close", tab });
        closed.add(tab);
      });
    };
    steps.forEach((original, at) => {
      if (at > 0 && original.tab !== steps[at - 1].tab) closeGone(at);
      const step = Object.assign({}, original);
      if (step.kind === "click") {
        const next = steps[at + 1];
        step.opens = !!next && !seen.has(next.tab) && !steps.slice(0, at + 1).some((each) => each.tab === next.tab);
      }
      if (!seen.has(step.tab)) {
        seen.add(step.tab);
        opened.push(step.tab);
      }
      out.push(step);
    });
    closeGone(steps.length);
    const kept = previous || {};
    return {
      problem: "",
      recording: {
        version: 1,
        id: draft.origin + " " + new Date(now).toISOString(),
        origin: draft.origin,
        listUrl: draft.listUrl,
        homeTab: home,
        steps: out,
        firstRow: draft.firstRow,
        createdAt: new Date(now).toISOString(),
        skipText: typeof kept.skipText === "string" ? kept.skipText : "",
        onlyText: typeof kept.onlyText === "string" ? kept.onlyText : "",
        highlight: typeof kept.highlight === "string" ? kept.highlight : "",
        pages: Number.isFinite(kept.pages) ? kept.pages : 0,
        timeout: Number.isFinite(kept.timeout) ? kept.timeout : DEFAULT_TIMEOUT2
      }
    };
  }
  function withSteps(rec, steps) {
    return Object.assign({}, rec, { steps });
  }
  function removeStep(rec, index) {
    if (!rec || index <= 0 || index >= rec.steps.length) return rec;
    return withSteps(rec, rec.steps.filter((step, at) => at !== index));
  }
  function insertWait(rec, after, seconds = 3) {
    if (!rec || after < 0 || after >= rec.steps.length) return rec;
    const steps = rec.steps.slice();
    steps.splice(after + 1, 0, { kind: "wait", tab: steps[after].tab, seconds });
    return withSteps(rec, steps);
  }
  function setWait(rec, index, seconds) {
    const step = rec && rec.steps[index];
    const value = parseFloat(String(seconds));
    if (!step || step.kind !== "wait" || !Number.isFinite(value)) return rec;
    const steps = rec.steps.slice();
    steps[index] = Object.assign({}, step, { seconds: Math.min(600, Math.max(0, value)) });
    return withSteps(rec, steps);
  }
  function insertCheck(rec, before, text) {
    const words = String(text == null ? "" : text).trim();
    const step = rec && rec.steps[before];
    if (!words || !step || before <= 0) return rec;
    const steps = rec.steps.slice();
    steps.splice(before, 0, { kind: "check", tab: step.tab, origin: step.origin || "", text: words, afterLoad: !!step.afterLoad });
    return withSteps(rec, steps);
  }
  function tabNumbers(steps) {
    const order = [];
    for (const step of steps) if (order.indexOf(step.tab) < 0) order.push(step.tab);
    return order;
  }
  function named(target) {
    const words = target ? target.text || target.words || "" : "";
    return words ? `"${words}"` : `the ${target && target.tag || "element"}`;
  }
  function describeStep(step, index, steps) {
    const number = tabNumbers(steps).indexOf(step.tab) + 1;
    const lead = number > 1 ? `Tab ${number}: ` : "";
    if (step.kind === "click") {
      if (index === 0) return `Click ${named(step.target)} on each item`;
      return lead + `Click ${named(step.target)}` + (step.scope === "row" ? " in the item" : "") + (step.opens ? " (opens a tab)" : "");
    }
    if (step.kind === "back") return lead + "Go back";
    if (step.kind === "wait") return lead + `Wait ${step.seconds} s`;
    if (step.kind === "close") return lead + "Close the tab";
    if (step.kind === "check") return lead + `Skip the item if the page says "${step.text}"`;
    return lead + step.kind;
  }

  // src/lib/recorder/engine.js
  var LIST_WAIT_MS = 15e3;
  var PAGE_WAIT_MS = 2e4;
  var FRESH_SLACK_MS = 1e3;
  var LEAVING_MS = 5e3;
  var BEAT_STALE_MS = 15e4;
  var FAIL_STREAK_LIMIT = 3;
  var NAVIGATION_LIMIT = 3;
  var no = { mine: false, bind: false, skip: false };
  function startRun(rec, me, now) {
    return {
      origin: rec.origin,
      homeTab: rec.homeTab,
      home: me.token,
      phase: "row",
      at: 0,
      row: null,
      listUrl: me.href,
      page: 1,
      tabs: { [rec.homeTab]: me.token },
      opened: [],
      visits: {},
      since: now,
      turnFrom: null
    };
  }
  function currentTask(run, rec) {
    if (run.phase === "row") return { type: "pick-row" };
    if (run.phase === "turning") return run.turnFrom ? { type: "await-page" } : { type: "turn-page" };
    if (run.phase === "steps") {
      const step = rec.steps[run.at];
      if (step) return { type: "step", step, index: run.at };
    }
    return { type: "unwind" };
  }
  function whoActs(run, rec, me, task) {
    if (me.holdUntil && me.holdUntil > me.now) return no;
    const home = me.token === run.home;
    if (task.type !== "step") return home ? { mine: true, bind: false, skip: false } : no;
    const step = task.step;
    const bound = run.tabs[step.tab];
    if (bound) {
      if (bound !== me.token) return no;
      if (step.afterLoad && run.visits[step.tab] === me.visit) return no;
      if ((step.kind === "click" || step.kind === "check") && step.origin && step.origin !== me.origin) return no;
      return { mine: true, bind: false, skip: false };
    }
    if (step.kind === "click" || step.kind === "check") {
      const taken = Object.keys(run.tabs).some((tab) => run.tabs[tab] === me.token);
      if (!taken && me.origin === step.origin && me.startedAt >= run.since - FRESH_SLACK_MS) {
        return { mine: true, bind: true, skip: false };
      }
      return no;
    }
    return home ? { mine: true, bind: false, skip: true } : no;
  }
  function rowPicked(run, row3, now) {
    return Object.assign({}, run, { phase: "steps", at: 0, row: { id: row3.id, title: row3.title }, since: now, navigations: 0 });
  }
  function bindTab(run, recTab, token) {
    const opened = token !== run.home && run.opened.indexOf(token) < 0 ? run.opened.concat([token]) : run.opened;
    return Object.assign({}, run, { tabs: Object.assign({}, run.tabs, { [recTab]: token }), opened });
  }
  function advance(run, rec, me, now) {
    const step = rec.steps[run.at];
    const next = Object.assign({}, run, { at: run.at + 1, since: now });
    if (step && (step.kind === "click" || step.kind === "back")) {
      next.visits = Object.assign({}, run.visits, { [step.tab]: me.visit });
    }
    if (step && step.kind === "close") {
      const token = run.tabs[step.tab];
      next.tabs = Object.assign({}, run.tabs);
      delete next.tabs[step.tab];
      next.opened = run.opened.filter((each) => each !== token);
    }
    return { run: next, finished: next.at >= rec.steps.length };
  }
  function rowEnded(run, now, status = "done") {
    const streak = run.failStreak || 0;
    return {
      closing: run.opened.slice(),
      run: Object.assign({}, run, {
        phase: "unwind",
        at: 0,
        row: null,
        tabs: { [run.homeTab]: run.home },
        opened: [],
        visits: {},
        since: now,
        failStreak: status === "failed" ? streak + 1 : status === "done" ? 0 : streak
      })
    };
  }
  function tooManyFailures(run) {
    return (run.failStreak || 0) >= FAIL_STREAK_LIMIT;
  }
  function navigated(run, now) {
    return Object.assign({}, run, { navigations: (run.navigations || 0) + 1, since: now });
  }
  function listArrived(run, now) {
    return Object.assign({}, run, { phase: "row", since: now, turnFrom: null, navigations: 0 });
  }
  function startTurning(run, now) {
    return Object.assign({}, run, { phase: "turning", turnFrom: null, since: now });
  }
  function turnStarted(run, me, signature, now) {
    return Object.assign({}, run, { phase: "turning", turnFrom: { visit: me.visit, signature, url: me.href }, since: now });
  }
  function pageTurned(run, href, now) {
    return Object.assign({}, run, { phase: "row", page: run.page + 1, listUrl: href, turnFrom: null, since: now });
  }
  function resumed(run, now) {
    return Object.assign({}, run, { since: now });
  }
  function timedOut(run, rec, now, task) {
    let limit = Infinity;
    if (task.type === "step") limit = (rec.timeout || 30) * 1e3;
    else if (task.type === "pick-row") limit = LIST_WAIT_MS;
    else if (task.type === "await-page") limit = PAGE_WAIT_MS;
    return now - run.since > limit;
  }
  function overdue(run, rec, now, task) {
    if (task.type !== "step") return false;
    const extra = task.step.kind === "wait" ? Number(task.step.seconds) || 0 : 0;
    return now - run.since > (extra + (rec.timeout || 30) + 5) * 1e3;
  }
  var SETTLE_QUIET_MS = 500;
  var SETTLE_CAP_MS = 3e3;
  function pageSettled({ readyState, now, lastChange, completeAt }) {
    if (readyState !== "complete") return false;
    return now - lastChange >= SETTLE_QUIET_MS || now - completeAt >= SETTLE_CAP_MS;
  }
  function stepBack(run, rec, now) {
    const refuse = (refused) => ({ run, closing: [], refused });
    if (run.phase !== "steps") return refuse("No item is under way. Use Item back to do the last one again.");
    let target = run.at - 1;
    while (target > 0 && rec.steps[target].kind === "wait") target--;
    if (target <= 0) return refuse("That is the item's first step. Use Item back to do the whole item again.");
    const step = rec.steps[target];
    if (step.kind === "back" || step.kind === "close") {
      return refuse("A Go back or Close the tab can't be done again. Use Item back to do the whole item again.");
    }
    const firstUse = {};
    rec.steps.forEach((each, at) => {
      if (!(each.tab in firstUse)) firstUse[each.tab] = at;
    });
    const tabs = Object.assign({}, run.tabs);
    const closing = [];
    for (const tab of Object.keys(tabs)) {
      if (firstUse[tab] > target && tabs[tab] !== run.home) {
        closing.push(tabs[tab]);
        delete tabs[tab];
      }
    }
    const visits = Object.assign({}, run.visits);
    delete visits[step.tab];
    return {
      refused: "",
      closing,
      run: Object.assign({}, run, { at: target, since: now, tabs, visits, opened: run.opened.filter((token) => closing.indexOf(token) < 0) })
    };
  }
  function failNote(task, rec) {
    const target = task.step && task.step.target;
    if (!target) return `step ${task.index + 1}: ${task.step.kind} did not finish in ${rec.timeout || 30} s`;
    return `step ${task.index + 1}: "${target.text || target.words || target.tag}" not found in ${rec.timeout || 30} s`;
  }
  function tokenPlan(live, { token, cloned, adopted, historyLength, startedAt, now, beatFresh: alive }) {
    if (token && !cloned) return "keep";
    if (adopted) return "adopt";
    if (live.mode === "running" && live.run) {
      if (alive === false) return "none";
      if (historyLength === 1 || startedAt >= live.run.since - FRESH_SLACK_MS) return "new";
      return "none";
    }
    if (live.mode === "recording" && live.draft) {
      if (historyLength === 1 || now - (live.draft.lastAt || 0) < 15e3) return "new";
      return "none";
    }
    return "none";
  }
  function listKey(href) {
    const url = new URL(String(href));
    return url.origin + url.pathname.replace(/\/+$/, "") + url.search;
  }
  function adoptToken(leaving, { origin: origin2, referrerOrigin, historyLength, now, closing }) {
    if (!leaving || historyLength <= 1 || now - leaving.at > LEAVING_MS) return null;
    if ((closing || []).indexOf(leaving.token) >= 0 || origin2 === leaving.origin) return null;
    return referrerOrigin && referrerOrigin === leaving.origin ? leaving.token : null;
  }
  function beatFresh(beat, now) {
    return !!beat && now - beat.at <= BEAT_STALE_MS;
  }
  function sameList(a, b) {
    try {
      return listKey(a) === listKey(b);
    } catch {
      return false;
    }
  }
  function stopRun(live, note) {
    const closing = (live.closing || []).slice();
    for (const token of live.run && live.run.opened || []) if (closing.indexOf(token) < 0) closing.push(token);
    return { mode: "idle", closing, note: note || "" };
  }

  // src/lib/recorder/targets.js
  var owns3 = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);
  function describeStepTarget(node, kind) {
    const record = describeTarget(node, kind);
    const label = labelOf(node);
    let link = null;
    try {
      link = typeof node.closest === "function" ? node.closest("a[href]") : null;
    } catch {
      link = null;
    }
    return Object.assign(record, {
      words: buttonWords(label),
      text: label.slice(0, 60),
      href: link ? String(link.href || "") : "",
      blank: !!link && String(link.getAttribute("target") || "").toLowerCase() === "_blank"
    });
  }
  function refineWords(target, matches) {
    if (!target || !target.words) return target;
    const same = (matches || []).filter((node) => buttonWords(labelOf(node)) === target.words).length;
    return same < Math.max(2, Math.ceil((matches || []).length / 2)) ? Object.assign({}, target, { words: "" }) : target;
  }
  function sameWords(node, target) {
    return !target.words || buttonWords(labelOf(node)) === target.words;
  }
  function matchesOf(doc, target, isOurs) {
    return Array.from(doc.getElementsByTagName(target.tag)).filter((node) => !isOurs(node) && matchesTarget(node, target) && sameWords(node, target));
  }
  function firstOtherLink(row3, control2) {
    try {
      for (const link of row3.querySelectorAll("a[href]")) {
        if (link !== control2 && !link.contains(control2) && !/^javascript:/i.test(link.href)) return link;
      }
    } catch {
    }
    return null;
  }
  function rowsFor(doc, target, isOurs = () => false) {
    if (!doc || !target || !target.tag) return [];
    const controls = matchesOf(doc, target, isOurs);
    const raw = controls.map((control2) => {
      let node = control2;
      for (let step = 0; step < ROW_DEPTH; step++) {
        const up = node.parentElement;
        if (!up || up === doc.body || up === doc.documentElement) break;
        if (controls.filter((each) => up.contains(each)).length > 1) break;
        node = up;
      }
      const own2 = collapse(control2.textContent || "");
      let title = collapse(rowText(node));
      if (own2) title = collapse(title.replace(own2, " "));
      title = title.slice(0, 200) || "(no title)";
      const link = firstOtherLink(node, control2);
      let href = "";
      try {
        href = link ? shortUrl(link.href, doc.location ? doc.location.href : "") : "";
      } catch {
        href = "";
      }
      let heading = null;
      try {
        heading = node.querySelector("h1, h2, h3, h4, h5, h6");
      } catch {
        heading = null;
      }
      const name = heading && collapse(heading.textContent).slice(0, 120) || title;
      return { node, control: control2, title, name, id: normaliseText(title) + (href ? " | " + href : "") };
    });
    const ids = numberIdentities(raw.map((each) => ({ id: each.id })));
    return raw.map((each, at) => Object.assign(each, { id: ids[at].id }));
  }
  function rowOf(rows, node) {
    if (!node) return null;
    return (rows || []).find((row3) => row3.node === node || row3.node.contains(node)) || null;
  }
  function findInRow(rowNode, target) {
    if (!rowNode || !target) return null;
    const inside = [rowNode].concat(Array.from(rowNode.getElementsByTagName(target.tag)));
    return inside.find((node) => String(node.tagName || "").toLowerCase() === target.tag && matchesTarget(node, target) && sameWords(node, target)) || null;
  }
  function findOnPage(doc, target, { isOurs = () => false, onScreen: onScreen3 = () => true } = {}) {
    if (!doc || !target || !target.tag) return null;
    const all = Array.from(doc.getElementsByTagName(target.tag)).filter((node) => {
      try {
        return !isOurs(node) && onScreen3(node);
      } catch {
        return false;
      }
    });
    if (target.words) {
      let best = null;
      let bestScore = -1;
      for (const node of all) {
        if (buttonWords(labelOf(node)) !== target.words) continue;
        const score = chainScore(node, target.chain || []);
        if (score > bestScore) {
          best = node;
          bestScore = score;
        }
      }
      return best;
    }
    return all.find((node) => matchesTarget(node, target)) || null;
  }
  function pageHasWords(doc, words, { isOurs = () => false, onScreen: onScreen3 = () => true } = {}) {
    const wanted = normaliseText(words);
    if (!wanted || !doc || !doc.body) return false;
    const win = doc.defaultView;
    const filter = win.NodeFilter;
    const seen = /* @__PURE__ */ new Map();
    const shows = (element) => {
      if (!seen.has(element)) {
        let ok = false;
        try {
          ok = !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA)$/.test(element.nodeName) && !isOurs(element) && onScreen3(element);
        } catch {
          ok = false;
        }
        seen.set(element, ok);
      }
      return seen.get(element);
    };
    const walker = doc.createTreeWalker(doc.body, filter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement && shows(node.parentElement) ? filter.FILTER_ACCEPT : filter.FILTER_REJECT
    });
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue);
    return normaliseText(parts.join(" ")).indexOf(wanted) >= 0;
  }
  function parseWords(text) {
    return String(text == null ? "" : text).split(/[,\r\n]+/).map((word) => word.trim().toLowerCase()).filter(Boolean);
  }
  function rowFilter(title, skipText, onlyText) {
    const text = normaliseText(title);
    const hit = parseWords(skipText).find((word) => text.indexOf(word) >= 0);
    if (hit) return { take: false, why: `skipped: has "${hit}"` };
    const only = parseWords(onlyText);
    if (only.length && !only.some((word) => text.indexOf(word) >= 0)) {
      return { take: false, why: "skipped: lacks any of " + only.map((word) => `"${word}"`).join(", ") };
    }
    return { take: true, why: "" };
  }
  function wantedRows(rows, ledger, rec) {
    const held = ledger && ledger.rows;
    const settings = rec || {};
    return (rows || []).filter((row3) => !owns3(held, row3.id) && rowFilter(row3.title, settings.skipText, settings.onlyText).take);
  }

  // src/lib/recorder/highlight.js
  var MARK2 = "pz-rec-mark";
  var SKIP = "pz-rec-skip";
  var STYLE_ID = "pz-rec-highlight-style";
  var MOST = 2e3;
  function findWordRanges(text, words) {
    const lower = String(text == null ? "" : text).toLowerCase();
    const list = (words || []).map((word) => String(word).toLowerCase()).filter(Boolean);
    const out = [];
    let at = 0;
    while (at < lower.length) {
      let best = -1;
      let length = 0;
      for (const word of list) {
        const found = lower.indexOf(word, at);
        if (found >= 0 && (best < 0 || found < best || found === best && word.length > length)) {
          best = found;
          length = word.length;
        }
      }
      if (best < 0) break;
      out.push([best, best + length]);
      at = best + length;
    }
    return out;
  }
  function registry(doc) {
    const win = doc && doc.defaultView;
    const api = win && win.CSS && win.CSS.highlights;
    return api && typeof win.Highlight === "function" ? { api, Make: win.Highlight, win } : null;
  }
  function addStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `::highlight(${MARK2}){background:#ffeb3b;color:#000}::highlight(${SKIP}){background:#ffcdd2;color:#000}`;
    (doc.head || doc.documentElement).appendChild(style);
  }
  function highlightWords(doc, name, words, isOurs = () => false) {
    const found = registry(doc);
    if (!found) return 0;
    const list = (words || []).filter(Boolean);
    if (!list.length || !doc.body) {
      found.api.delete(name);
      return 0;
    }
    addStyle(doc);
    const filter = found.win.NodeFilter;
    const walker = doc.createTreeWalker(doc.body, filter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.nodeName) || isOurs(parent)) return filter.FILTER_REJECT;
        return filter.FILTER_ACCEPT;
      }
    });
    const ranges = [];
    for (let node = walker.nextNode(); node && ranges.length < MOST; node = walker.nextNode()) {
      for (const [start, end] of findWordRanges(node.nodeValue, list)) {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        ranges.push(range);
        if (ranges.length >= MOST) break;
      }
    }
    found.api.set(name, new found.Make(...ranges));
    return ranges.length;
  }
  function clearHighlights(doc) {
    const found = registry(doc);
    if (!found) return;
    found.api.delete(MARK2);
    found.api.delete(SKIP);
  }

  // src/lib/recorder/panel.js
  var RESET2 = "text-transform:none;letter-spacing:normal;line-height:1.3;margin:0;width:auto;height:auto;box-shadow:none;text-shadow:none;float:none;text-align:center;vertical-align:middle;";
  function button2(t, act, label, handler, title) {
    const b = tag("button", { textContent: label, type: "button" });
    b.setAttribute("data-act", act);
    if (title) b.title = title;
    b.style.cssText = `border:1px solid ${t.border};background:${t.head};color:${t.fg};border-radius:5px;` + RESET2 + "padding:3px 8px;cursor:pointer;font:12px sans-serif;box-sizing:border-box;" + (getTouch() ? "min-height:40px;" : "");
    if (handler) b.addEventListener("click", handler);
    return b;
  }
  function row2(gap = 6) {
    const r = tag("div");
    r.style.cssText = `display:flex;flex-wrap:wrap;gap:${gap}px;align-items:center;`;
    return r;
  }
  function field(t, act, label, type, width, title, handler) {
    const wrap = tag("label");
    wrap.style.cssText = `display:flex;align-items:center;gap:4px;color:${t.sub};`;
    if (title) wrap.title = title;
    wrap.appendChild(tag("span", { textContent: label }));
    const input = tag("input", { type });
    if (type === "number") input.min = "0";
    input.setAttribute("data-act", act);
    input.style.cssText = numberStyle(width, t);
    if (handler) input.addEventListener("change", () => handler(input.value));
    wrap.appendChild(input);
    return { wrap, input };
  }
  function createRecorderPanel({
    position = null,
    onClose,
    onRecord,
    onPlay,
    onStop,
    onReset,
    onBack,
    onStepBack,
    onExport,
    onSelectStep,
    onRemoveStep,
    onWaitSeconds,
    onAddWait,
    onAddCheck,
    onSkipText,
    onOnlyText,
    onHighlight,
    onPages,
    onTimeout
  }) {
    const t = palette();
    const panel = own(tag("div", { className: "pz-recorder" }), "recorder");
    panel.style.cssText = `position:fixed;z-index:2147483647;width:320px;max-width:calc(100vw - 24px);box-sizing:border-box;background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:8px;font:12px sans-serif;box-shadow:${t.shadow};overflow:hidden;text-align:left;` + (position ? `left:${position.left}px;top:${position.top}px;` : "left:12px;bottom:54px;");
    const head = tag("div");
    head.setAttribute("data-pz-drag", "");
    head.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;background:${t.head};border-bottom:1px solid ${t.border};cursor:move;user-select:none;`;
    head.appendChild(tag("strong", { textContent: "\u23FA Step recorder", style: `flex:1;color:${t.fg};` }));
    const cls = tag("button", { textContent: "\u2715", type: "button", title: "Close" });
    cls.setAttribute("data-act", "rec-close");
    cls.style.cssText = RESET2 + `border:0;background:none;color:${t.fg};font-size:15px;line-height:1;cursor:pointer;padding:0 2px;`;
    if (onClose) cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel.appendChild(head);
    const body = tag("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;";
    panel.appendChild(body);
    const controls = row2();
    const record = button2(t, "rec-record", "\u23FA Record", onRecord, "Do one item by hand while this watches");
    controls.appendChild(record);
    const play = tag("button", { textContent: "\u25B6 Play", type: "button" });
    play.setAttribute("data-act", "rec-play");
    play.style.cssText = RESET2 + `border:0;border-radius:12px;padding:4px 14px;cursor:pointer;font:bold 12px sans-serif;color:#fff;background:${t.accent};min-width:76px;` + (getTouch() ? "min-height:40px;" : "");
    if (onPlay) play.addEventListener("click", onPlay);
    controls.appendChild(play);
    controls.appendChild(button2(t, "rec-stop", "\u25A0 Stop", onStop, "Stop the run and close the tabs it opened"));
    const reset = button2(t, "rec-reset", "\u21BA Reset", onReset, "Forget which items are done on this site");
    controls.appendChild(reset);
    controls.appendChild(button2(
      t,
      "rec-back",
      "\u21B6 Item back",
      onBack,
      "Have the last item marked done or skipped done again at the next Play; press again for the one before"
    ));
    controls.appendChild(button2(
      t,
      "rec-step-back",
      "\u21B6 Step back",
      onStepBack,
      "Do the step before the current one again, for a click the page missed; press again to go further back"
    ));
    body.appendChild(controls);
    const list = tag("div");
    list.setAttribute("data-pz-steps", "");
    list.style.cssText = `display:flex;flex-direction:column;gap:2px;max-height:180px;overflow:auto;border:1px solid ${t.border};border-radius:5px;padding:4px;background:${t.field};`;
    list.appendChild(tag("div", { textContent: "No steps yet. Press Record, then do one item by hand.", style: `color:${t.sub};padding:2px;` }));
    list.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== "function") return;
      const remove = target.closest('[data-act="rec-remove"]');
      if (remove) {
        if (onRemoveStep) onRemoveStep(Number(remove.getAttribute("data-index")));
        return;
      }
      if (target.closest("input")) return;
      const line = target.closest('[data-act="rec-step"]');
      if (line && onSelectStep) onSelectStep(Number(line.getAttribute("data-index")));
    });
    list.addEventListener("change", (event) => {
      const box2 = event.target && event.target.closest ? event.target.closest('[data-act="rec-wait-seconds"]') : null;
      if (box2 && onWaitSeconds) onWaitSeconds(Number(box2.getAttribute("data-index")), box2.value);
    });
    body.appendChild(list);
    const ops = row2();
    ops.appendChild(button2(t, "rec-add-wait", "\uFF0B Wait", onAddWait, "Add a wait after the chosen step"));
    const check = tag("input", { type: "text", placeholder: "page says\u2026" });
    check.setAttribute("data-act", "rec-check-text");
    check.style.cssText = numberStyle(110, t);
    ops.appendChild(check);
    ops.appendChild(button2(t, "rec-add-check", "\uFF0B Skip if", () => {
      const words = check.value;
      if (onAddCheck) onAddCheck(words);
      check.value = "";
    }, "Before the chosen step, skip the item if its page says these words"));
    body.appendChild(ops);
    const skip2 = field(t, "rec-skip", "Skip items with", "text", 150, "Words, comma between; an item holding any is left out", onSkipText);
    const only = field(t, "rec-only", "Only items with", "text", 150, "Words, comma between; only items holding one are taken", onOnlyText);
    const mark = field(t, "rec-highlight", "Highlight", "text", 150, "Words to mark on every page while this is open", onHighlight);
    for (const each of [skip2, only, mark]) body.appendChild(each.wrap);
    const numbers = row2(10);
    const pages = field(t, "rec-pages", "Pages", "number", 52, "Stop after this many list pages; 0 for all", onPages);
    const timeout = field(t, "rec-timeout", "Step timeout s", "number", 52, "How long a step may wait for its button", onTimeout);
    numbers.appendChild(pages.wrap);
    numbers.appendChild(timeout.wrap);
    body.appendChild(numbers);
    const strip = tag("div");
    strip.style.cssText = `padding:7px 12px;border-top:1px solid ${t.border};background:${t.head};display:flex;flex-direction:column;gap:3px;`;
    const counts = tag("div", { style: `color:${t.fg};font:11px sans-serif;min-height:14px;` });
    const status = tag("div", { textContent: "Ready.", style: `color:${t.sub};font:11px sans-serif;min-height:14px;` });
    const foot = row2();
    const exporter = button2(t, "rec-export", "Export", onExport, "Save the steps and the ledger as JSON");
    exporter.style.padding = "1px 6px";
    const more = tag("button", { textContent: "Details \u25B8", type: "button" });
    more.setAttribute("data-act", "rec-details");
    more.style.cssText = RESET2 + `display:none;border:0;background:none;padding:0;cursor:pointer;color:${t.sub};font:11px sans-serif;text-decoration:underline;`;
    foot.appendChild(exporter);
    foot.appendChild(more);
    const box = tag("pre");
    box.style.cssText = `display:none;margin:2px 0 0;max-height:160px;overflow:auto;padding:5px 6px;white-space:pre-wrap;background:${t.field};color:${t.fg};border:1px solid ${t.border};border-radius:4px;font:10.5px/1.4 ui-monospace,Consolas,monospace;`;
    more.addEventListener("click", () => {
      const open = box.style.display === "none";
      box.style.display = open ? "block" : "none";
      more.textContent = open ? "Details \u25BE" : "Details \u25B8";
    });
    strip.appendChild(counts);
    strip.appendChild(status);
    strip.appendChild(foot);
    strip.appendChild(box);
    panel.appendChild(strip);
    return {
      el: panel,
      head,
      setMode(mode) {
        record.textContent = mode === "recording" ? "\u25A0 Stop recording" : "\u23FA Record";
        play.textContent = mode === "running" ? "\u23F8 Pause" : mode === "paused" ? "\u25B6 Resume" : "\u25B6 Play";
      },
      setSteps(lines, kinds, waits, selected) {
        list.textContent = "";
        if (!lines.length) {
          list.appendChild(tag("div", { textContent: "No steps yet. Press Record, then do one item by hand.", style: `color:${t.sub};padding:2px;` }));
          return;
        }
        lines.forEach((text, index) => {
          const line = tag("div");
          line.setAttribute("data-act", "rec-step");
          line.setAttribute("data-index", String(index));
          line.setAttribute("aria-selected", index === selected ? "true" : "false");
          line.style.cssText = "display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;cursor:pointer;" + (index === selected ? `background:${t.hover};outline:1px solid ${t.accent};` : "");
          line.appendChild(tag("span", { textContent: `${index + 1}. ${text}`, style: "flex:1;min-width:0;overflow-wrap:anywhere;" }));
          if (kinds[index] === "wait") {
            const seconds = tag("input", { type: "number", min: "0", value: String(waits[index]) });
            seconds.setAttribute("data-act", "rec-wait-seconds");
            seconds.setAttribute("data-index", String(index));
            seconds.title = "Seconds";
            seconds.style.cssText = numberStyle(46, t);
            line.appendChild(seconds);
          }
          if (index > 0) {
            const remove = tag("button", { textContent: "\u2715", type: "button", title: "Remove this step" });
            remove.setAttribute("data-act", "rec-remove");
            remove.setAttribute("data-index", String(index));
            remove.style.cssText = RESET2 + `border:0;background:none;color:${t.sub};cursor:pointer;padding:0 3px;font:11px sans-serif;`;
            line.appendChild(remove);
          }
          list.appendChild(line);
        });
      },
      setFields({ skipText = "", onlyText = "", highlight = "", pages: pageCount = 0, timeout: seconds = 30 } = {}) {
        skip2.input.value = skipText;
        only.input.value = onlyText;
        mark.input.value = highlight;
        pages.input.value = String(pageCount);
        timeout.input.value = String(seconds);
      },
      setStatus(text) {
        status.textContent = text || "";
      },
      setCounts(text) {
        counts.textContent = text || "";
      },
      setDetails(text, openIt = false) {
        box.textContent = text || "";
        more.style.display = text ? "inline-block" : "none";
        if (!text || openIt) {
          box.style.display = text && openIt ? "block" : "none";
          more.textContent = text && openIt ? "Details \u25BE" : "Details \u25B8";
        }
      },
      setReset(label) {
        reset.textContent = label;
      }
    };
  }

  // src/lib/recorder/tool.js
  var TAB_KEY = "pz-rec tab";
  var POSITION_KEY2 = "pz-rec position";
  var ROW_MARK = "data-pz-rec";
  var POLL_MS = 300;
  var BEAT_EVERY_MS = 3e3;
  var UNBOUND_GIVE_UP_MS = 6e4;
  var NAV_RETRY_MS = 1e4;
  var NOT_A_LIST = "That isn't one of a list of items. Click the first item's button.";
  var ACTIONABLE = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, label, summary, [onclick], [class*="btn"], [class*="button"], [tabindex]';
  var ROW_LOOK = {
    done: ["", "0.45"],
    skipped: ["2px dashed #c62828", ""],
    failed: ["2px dashed #e08a00", ""],
    current: ["3px solid #1e88e5", ""]
  };
  function newId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  function onScreen2(node) {
    if (!node) return false;
    if (typeof node.checkVisibility === "function") {
      try {
        return node.checkVisibility() === true;
      } catch {
      }
    }
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }
  function fileStamp2(date) {
    const two = (number) => (number < 10 ? "0" : "") + number;
    return date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + "-" + two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds());
  }
  function realHref(link, pageHref) {
    if (!link || typeof link.getAttribute !== "function") return "";
    const raw = String(link.getAttribute("href") || "").trim();
    if (!raw || raw.charAt(0) === "#" || /^javascript:/i.test(raw)) return "";
    const href = String(link.href || "");
    const bare = (url) => String(url).split("#")[0];
    return href && bare(href) !== bare(pageHref) ? href : "";
  }
  function openStand(openTab, base) {
    return function(url) {
      const go = (where) => {
        const text = String(where == null ? "" : where).trim();
        if (!text || /^about:blank$/i.test(text)) return;
        try {
          openTab(new URL(text, base).href);
        } catch {
        }
      };
      go(url);
      const location2 = { assign: go, replace: go, toString: () => "" };
      Object.defineProperty(location2, "href", { get: () => "", set: go });
      const stub = { closed: false, focus() {
      }, close() {
      }, document: { open() {
      }, write() {
      }, close() {
      } } };
      Object.defineProperty(stub, "location", { get: () => location2, set: go });
      return stub;
    };
  }
  function withOpenCaught(pageWindow2, openTab, base, work) {
    const original = pageWindow2.open;
    const stand = openStand(openTab, base);
    try {
      pageWindow2.open = stand;
    } catch {
    }
    try {
      work();
    } finally {
      setTimeout(() => {
        try {
          if (pageWindow2.open === stand) pageWindow2.open = original;
        } catch {
        }
      }, 1e3);
    }
  }
  function stepFromClick(node, me, draft, { doc = document, isOurs = () => false, rowNode = null } = {}) {
    const found = resolveTarget(node);
    if (!found) return { problem: "Nothing there to record." };
    const base = { tab: me.token, origin: me.origin, path: me.path, visit: me.visit };
    const firstClick = !draft.steps.some((step) => step.kind === "click");
    if (!firstClick && found.kind === "button") {
      let acts = false;
      try {
        acts = !!found.node.closest(ACTIONABLE);
      } catch {
        acts = false;
      }
      if (!acts) return { ignored: true };
    }
    let target = describeStepTarget(found.node, found.kind);
    if (!target.chain.length) return { problem: "That can't be found again. Click something inside the page." };
    if (firstClick) {
      const loose = Object.assign({}, target, { words: "" });
      target = refineWords(target, rowsFor(doc, loose, isOurs).map((row4) => row4.control));
      const rows = rowsFor(doc, target, isOurs);
      const row3 = rowOf(rows, found.node);
      if (!row3 || rows.length < 2) return { problem: NOT_A_LIST };
      return { click: Object.assign(base, { target, scope: "row", row: { id: row3.id, title: row3.name || row3.title } }), rowNode: row3.node };
    }
    const inRow = !!rowNode && me.visit === draft.rowVisit && rowNode.contains(found.node);
    return { click: Object.assign(base, { target, scope: inRow ? "row" : "page" }), rowNode };
  }
  function createRecorderTool({ gm: gm2, pageWindow: pageWindow2 = window, version = "0.0.0", win = window, doc = document } = {}) {
    const store = createRecorderStore(gm2);
    const isOurs = (node) => {
      const el = node && node.nodeType === 1 ? node : node && node.parentElement;
      return !!(el && typeof el.closest === "function" && el.closest("[data-pz]"));
    };
    let memToken = null;
    let visit = newId();
    let startedAt = Date.now();
    let holdUntil = 0;
    let navigatedAt = 0;
    let closingAsked = false;
    function readToken() {
      try {
        return win.sessionStorage.getItem(TAB_KEY) || memToken;
      } catch {
        return memToken;
      }
    }
    function keepToken(token) {
      memToken = token;
      try {
        win.sessionStorage.setItem(TAB_KEY, token);
      } catch {
      }
      return token;
    }
    async function adoptable(live) {
      let from = "";
      try {
        from = new URL(doc.referrer).origin;
      } catch {
        from = "";
      }
      return adoptToken(await store.readLeaving(), {
        origin: win.location.origin,
        referrerOrigin: from,
        historyLength: win.history.length,
        now: Date.now(),
        closing: live.closing
      });
    }
    function me(now = Date.now()) {
      return {
        token: readToken(),
        visit,
        origin: win.location.origin,
        href: win.location.href,
        path: win.location.pathname,
        startedAt,
        now,
        holdUntil
      };
    }
    function hold(ms) {
      holdUntil = Date.now() + ms;
    }
    let opened = false;
    let view = null;
    let selected = -1;
    let localNote = null;
    let shown = { steps: "", fields: "" };
    let resetArmed = 0;
    let liveCache = { mode: "idle", closing: [], note: "" };
    let recCache = null;
    let ledgerCache = { rows: {} };
    function say(text) {
      localNote = { text, until: Date.now() + 5e3 };
      if (view) view.setStatus(text);
    }
    let timer = null;
    let ticking = false;
    let busy = false;
    let lastChange = Date.now();
    let completeAt = 0;
    function settledNow(now) {
      if (!completeAt && doc.readyState === "complete") completeAt = now;
      return pageSettled({ readyState: doc.readyState, now, lastChange, completeAt });
    }
    let quietWatch = null;
    let highlightAt = 0;
    let highlightKey = "";
    let lastBeat = 0;
    function beat(token) {
      lastBeat = Date.now();
      try {
        store.writeBeatNow({ token, at: lastBeat });
      } catch {
      }
    }
    const handles = [];
    function keepHandle(handle) {
      if (handle && typeof handle.close === "function") handles.push(handle);
    }
    function closeHandles() {
      for (const handle of handles.splice(0)) {
        try {
          if (!handle.closed) handle.close();
        } catch {
        }
      }
    }
    function startLoop() {
      if (timer) return;
      timer = setInterval(() => {
        tick();
      }, POLL_MS);
      if (!quietWatch && typeof MutationObserver === "function" && doc.body) {
        try {
          quietWatch = new MutationObserver((records) => {
            if (records.some((record2) => !isOurs(record2.target))) lastChange = Date.now();
          });
          quietWatch.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
        } catch {
          quietWatch = null;
        }
      }
    }
    function stopLoop() {
      clearInterval(timer);
      timer = null;
      if (quietWatch) {
        try {
          quietWatch.disconnect();
        } catch {
        }
        quietWatch = null;
      }
    }
    function recOriginOf(live) {
      if (live.run) return live.run.origin;
      if (live.draft) return live.draft.origin;
      return win.location.origin;
    }
    async function tick() {
      if (ticking) return;
      ticking = true;
      try {
        const live = await store.readLive();
        liveCache = live;
        const token = readToken();
        if (token && live.closing.indexOf(token) >= 0) {
          closeSelf();
          return;
        }
        if (live.mode === "recording") listenForClicks();
        else stopListening();
        const origin2 = recOriginOf(live);
        recCache = await store.readRecording(origin2);
        ledgerCache = await store.readLedger(origin2);
        const bound = live.run && token && Object.keys(live.run.tabs).some((tab) => live.run.tabs[tab] === token);
        if (live.mode === "running" && token && live.run.home === token && Date.now() - lastBeat >= BEAT_EVERY_MS) beat(token);
        if (live.mode === "running" && token && !busy) {
          busy = true;
          try {
            await act(live, recCache, ledgerCache);
          } finally {
            busy = false;
          }
        }
        if (!opened && (live.mode === "recording" || bound)) open();
        render(live, recCache, ledgerCache);
        const unboundTooLong = live.mode === "running" && !bound && Date.now() - startedAt > UNBOUND_GIVE_UP_MS;
        if (!opened && (live.mode === "idle" || unboundTooLong)) stopLoop();
      } catch (error) {
        say("Recorder fault: " + (error && error.message ? error.message : String(error)));
      } finally {
        ticking = false;
      }
    }
    async function commit(expected, next) {
      const current = await store.readLive();
      if ((current.rev || 0) !== (expected.rev || 0) || current.mode !== expected.mode) return null;
      const written = Object.assign({}, next, { rev: (expected.rev || 0) + 1 });
      await store.writeLive(written);
      liveCache = written;
      return written;
    }
    async function writeFresh(next) {
      const current = await store.readLive();
      const written = Object.assign({}, next, { rev: (current.rev || 0) + 1 });
      await store.writeLive(written);
      liveCache = written;
      return written;
    }
    function closeSelf() {
      if (closingAsked) return;
      closingAsked = true;
      stopLoop();
      try {
        win.close();
      } catch {
      }
      setTimeout(() => say("Close this tab by hand: the browser kept it open."), 1500);
    }
    function rowsHere(rec) {
      return rec && rec.steps[0] ? rowsFor(doc, rec.steps[0].target, isOurs) : [];
    }
    async function finish(live, note) {
      closeHandles();
      await commit(live, stopRun(live, note));
      say(note);
    }
    async function endRow(live, run2, rec, ledger, status, note) {
      if (run2.row) {
        const kept = markRow(ledger, run2.row.id, { status, title: run2.row.title, note, at: (/* @__PURE__ */ new Date()).toISOString(), page: run2.page });
        await store.writeLedger(rec.origin, kept);
        ledgerCache = kept;
      }
      const ended = rowEnded(run2, Date.now(), status);
      const next = Object.assign({}, live, { run: ended.run, closing: ended.closing });
      closeHandles();
      if (status === "failed" && tooManyFailures(ended.run)) {
        const words = `Stopped: ${FAIL_STREAK_LIMIT} items failed in a row. Last: ${note}`;
        const written = await commit(live, stopRun(next, words));
        say(words);
        return written;
      }
      return commit(live, next);
    }
    async function moveOn(live, run2, rec, ledger, mine) {
      const out = advance(run2, rec, mine, Date.now());
      if (!out.finished) return commit(live, Object.assign({}, live, { run: out.run }));
      return endRow(live, out.run, rec, ledger, "done", "");
    }
    async function goToList(live, run2) {
      if (Date.now() - navigatedAt < NAV_RETRY_MS) return;
      if ((run2.navigations || 0) >= NAVIGATION_LIMIT) {
        await finish(live, "The list page didn't come back at " + run2.listUrl);
        return;
      }
      if (!await commit(live, Object.assign({}, live, { run: navigated(run2, Date.now()) }))) return;
      navigatedAt = Date.now();
      hold(5e3);
      win.location.href = run2.listUrl;
    }
    function locate(step, index, run2, rec) {
      if (step.scope === "row") {
        const row3 = rowsHere(rec).find((each) => run2.row && each.id === run2.row.id);
        if (!row3) return null;
        return index === 0 ? row3.control : findInRow(row3.node, step.target);
      }
      return findOnPage(doc, step.target, { isOurs, onScreen: onScreen2 });
    }
    function fire(el) {
      try {
        el.scrollIntoView({ block: "center" });
      } catch {
      }
      const View = win.PointerEvent || win.MouseEvent;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        try {
          const Kind = type.startsWith("pointer") ? View : win.MouseEvent;
          el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, view: win, button: 0 }));
        } catch {
        }
      }
      el.click();
    }
    function press(el, step) {
      if (step.opens) {
        let link = null;
        try {
          link = el.closest("a[href]");
        } catch {
          link = null;
        }
        const href = realHref(link, win.location.href);
        if (href) {
          keepHandle(gm2.openTab(href));
          return;
        }
      }
      withOpenCaught(
        pageWindow2,
        (url) => {
          const handle = gm2.openTab(url);
          keepHandle(handle);
          return handle;
        },
        win.location.href,
        () => fire(el)
      );
    }
    function comeForward() {
      try {
        if (doc.hidden) win.focus();
      } catch {
      }
    }
    async function act(live, rec, ledger) {
      const run2 = live.run;
      if (!run2 || !rec) return;
      const now = Date.now();
      const mine = me(now);
      const task = currentTask(run2, rec);
      if (mine.token !== run2.home && !beatFresh(await store.readBeat(), now)) {
        say("The run's tab has gone quiet. Press Stop if it was closed.");
        return;
      }
      const who = whoActs(run2, rec, mine, task);
      if (!who.mine) {
        if (mine.token === run2.home && overdue(run2, rec, now, task)) await endRow(live, run2, rec, ledger, "failed", failNote(task, rec));
        return;
      }
      if (mine.token === run2.home) comeForward();
      if (task.type === "pick-row") {
        closeHandles();
        if (!sameList(win.location.href, run2.listUrl)) {
          if (now - run2.since > 1500) await goToList(live, run2);
          return;
        }
        const rows = rowsHere(rec);
        paintRows(rows, ledger, null);
        if (!rows.length) {
          if (timedOut(run2, rec, now, task)) await finish(live, "No items found on the list page. Press Play on the list.");
          return;
        }
        const wanted = wantedRows(rows, ledger, rec);
        if (!wanted.length) {
          await commit(live, Object.assign({}, live, { run: startTurning(run2, now) }));
          return;
        }
        await commit(live, Object.assign({}, live, { run: rowPicked(run2, { id: wanted[0].id, title: wanted[0].name || wanted[0].title }, now) }));
        return;
      }
      if (task.type === "unwind") {
        closeHandles();
        if (sameList(win.location.href, run2.listUrl)) await commit(live, Object.assign({}, live, { run: listArrived(run2, now) }));
        else if (now - run2.since > 1500) await goToList(live, run2);
        return;
      }
      if (task.type === "turn-page") {
        if (rec.pages > 0 && run2.page >= rec.pages) {
          await finish(live, `Stopped after ${run2.page} page(s).`);
          return;
        }
        if (!settledNow(now)) return;
        const rows = rowsHere(rec);
        const last = rows.length ? rows[rows.length - 1].node : null;
        const found = findNextControls(doc, last, { isOurs, onScreen: onScreen2, win });
        if (!found.length) {
          await finish(live, "Last page done.");
          return;
        }
        const signature = rows.map((row3) => row3.id).join("\n");
        if (!await commit(live, Object.assign({}, live, { run: turnStarted(run2, mine, signature, now) }))) return;
        hold(1500);
        fire(found[0].control);
        return;
      }
      if (task.type === "await-page") {
        const rows = rowsHere(rec);
        const signature = rows.map((row3) => row3.id).join("\n");
        if (rows.length && (mine.visit !== run2.turnFrom.visit || signature !== run2.turnFrom.signature)) {
          await commit(live, Object.assign({}, live, { run: pageTurned(run2, win.location.href, now) }));
        } else if (timedOut(run2, rec, now, task)) {
          await finish(live, "The next page didn't load.");
        }
        return;
      }
      const step = task.step;
      const ready = who.bind ? bindTab(run2, step.tab, mine.token) : run2;
      if (who.skip) {
        await moveOn(live, ready, rec, ledger, mine);
        return;
      }
      if (step.kind === "click") {
        const el = settledNow(now) ? locate(step, task.index, ready, rec) : null;
        if (!el) {
          if (timedOut(ready, rec, now, task)) await endRow(live, ready, rec, ledger, "failed", failNote(task, rec));
          return;
        }
        if (!await moveOn(live, ready, rec, ledger, mine)) return;
        hold(1500);
        press(el, step);
        return;
      }
      if (step.kind === "wait") {
        if (now - ready.since >= step.seconds * 1e3) await moveOn(live, ready, rec, ledger, mine);
        return;
      }
      if (step.kind === "check") {
        if (pageHasWords(doc, step.text, { isOurs, onScreen: onScreen2 })) {
          await endRow(live, ready, rec, ledger, "skipped", `page says "${step.text}"`);
          return;
        }
        const settled = doc.readyState === "complete" && now - lastChange >= 1e3 && now - ready.since >= 1e3;
        if (settled || timedOut(ready, rec, now, task)) await moveOn(live, ready, rec, ledger, mine);
        return;
      }
      if (step.kind === "back") {
        if (!await moveOn(live, ready, rec, ledger, mine)) return;
        closeHandles();
        hold(5e3);
        win.history.back();
        return;
      }
      if (step.kind === "close") {
        if (!await moveOn(live, ready, rec, ledger, mine)) return;
        setTimeout(closeSelf, 100);
      }
    }
    function paintRows(rows, ledger, currentId) {
      for (const row3 of rows) {
        const held = ledger.rows[row3.id];
        const status = row3.id === currentId ? "current" : held ? held.status : "";
        if (row3.node.getAttribute(ROW_MARK) === (status || null)) continue;
        const look = ROW_LOOK[status];
        row3.node.style.outline = look ? look[0] : "";
        row3.node.style.opacity = look ? look[1] : "";
        if (status) {
          row3.node.setAttribute(ROW_MARK, status);
          if (held && held.note) row3.node.title = held.status + ": " + held.note;
        } else {
          row3.node.removeAttribute(ROW_MARK);
        }
      }
    }
    function clearRowPaint() {
      for (const node of doc.querySelectorAll("[" + ROW_MARK + "]")) {
        node.style.outline = "";
        node.style.opacity = "";
        node.removeAttribute(ROW_MARK);
      }
    }
    function refreshHighlights(rec, force = false) {
      const words = rec ? [rec.highlight || "", rec.skipText || ""] : ["", ""];
      const key = words.join("\n");
      if (!force && key === highlightKey && Date.now() - highlightAt < 2e3) return;
      highlightKey = key;
      highlightAt = Date.now();
      try {
        highlightWords(doc, MARK2, parseWords(words[0]), isOurs);
        highlightWords(doc, SKIP, parseWords(words[1]), isOurs);
      } catch {
      }
    }
    function stepsOf(live, rec) {
      if (live.mode === "recording" && live.draft) return live.draft.steps;
      return rec ? rec.steps : [];
    }
    function statusOf(live, rec) {
      if (localNote && Date.now() < localNote.until) return localNote.text;
      if (live.mode === "recording") {
        const steps = live.draft && live.draft.steps || [];
        return steps.length ? `Recording: ${steps.length} step(s). Finish the item, then Stop recording.` : "Recording: do one item by hand, starting with its button in the list.";
      }
      if (live.mode === "paused") return "Paused.";
      if (live.mode === "running" && live.run && rec) {
        const run2 = live.run;
        const task = currentTask(run2, rec);
        const item = run2.row ? `"${run2.row.title.slice(0, 40)}" ` : "";
        if (task.type === "step") return `Page ${run2.page} \xB7 ${item}step ${task.index + 1} of ${rec.steps.length}: ${describeStep(task.step, task.index, rec.steps)}`;
        if (task.type === "pick-row") return `Page ${run2.page} \xB7 finding the next item\u2026`;
        if (task.type === "unwind") return `Page ${run2.page} \xB7 back to the list\u2026`;
        return `Page ${run2.page} done \xB7 turning the page\u2026`;
      }
      return live.note || (rec ? "Ready. Play repeats the steps for every item." : "Press Record on the list page, then do one item by hand.");
    }
    function render(live, rec, ledger) {
      if (!view) return;
      view.setMode(live.mode);
      const steps = stepsOf(live, rec);
      const stepsKey = JSON.stringify(steps) + "|" + selected;
      if (stepsKey !== shown.steps) {
        shown.steps = stepsKey;
        if (selected >= steps.length) selected = steps.length - 1;
        view.setSteps(
          steps.map((step, index) => describeStep(step, index, steps)),
          steps.map((step) => step.kind),
          steps.map((step) => step.kind === "wait" ? step.seconds : null),
          selected
        );
      }
      if (rec) {
        const fieldsKey = [rec.id, rec.skipText, rec.onlyText, rec.highlight, rec.pages, rec.timeout].join("|");
        const typing = doc.activeElement && view.el.contains(doc.activeElement) && doc.activeElement.tagName === "INPUT";
        if (fieldsKey !== shown.fields && !typing) {
          shown.fields = fieldsKey;
          view.setFields(rec);
        }
      }
      const tally = ledgerTally(ledger);
      const rows = rec && win.location.origin === rec.origin ? rowsHere(rec) : [];
      const page = live.run ? `Page ${live.run.page} \xB7 ` : "";
      view.setCounts(rec ? `${page}${rows.length} items here \xB7 ${tally.done} done \xB7 ${tally.skipped} skipped \xB7 ${tally.failed} failed` : "");
      view.setStatus(statusOf(live, rec));
      view.setDetails(ledgerLines(ledger).join("\n"));
      if (rows.length && live.mode !== "recording") paintRows(rows, ledger, live.run && live.run.row ? live.run.row.id : null);
      refreshHighlights(rec);
    }
    let listening = false;
    let recRowNode = null;
    function onRecordClick(event) {
      if (!event || event.isTrusted !== true || isOurs(event.target)) return;
      try {
        const live = store.readLiveNow() || liveCache;
        if (!live || live.mode !== "recording" || !live.draft) return;
        const out = stepFromClick(event.target, me(), live.draft, { doc, isOurs, rowNode: recRowNode });
        if (out.ignored) return;
        if (out.problem) {
          say(out.problem);
          return;
        }
        if (out.rowNode) recRowNode = out.rowNode;
        const draft = Object.assign(addClick(live.draft, out.click), { lastAt: Date.now() });
        const next = Object.assign({}, live, { draft, rev: (live.rev || 0) + 1 });
        liveCache = next;
        store.writeLiveNow(next);
        say("Recorded: " + describeStep(draft.steps[draft.steps.length - 1], draft.steps.length - 1, draft.steps));
        render(next, recCache, ledgerCache);
      } catch (error) {
        say("Couldn't record that click: " + (error && error.message ? error.message : String(error)));
      }
    }
    function listenForClicks() {
      if (listening) return;
      listening = true;
      win.addEventListener("click", onRecordClick, true);
    }
    function stopListening() {
      if (!listening) return;
      listening = false;
      win.removeEventListener("click", onRecordClick, true);
    }
    async function noteBack() {
      const live = store.readLiveNow() || await store.readLive();
      if (live.mode !== "recording" || !live.draft) return;
      const mine = me();
      const backed = addBack(live.draft, { tab: mine.token, origin: mine.origin, visit: mine.visit });
      if (backed === live.draft) return;
      const draft = Object.assign(backed, { lastAt: Date.now() });
      await writeFresh(Object.assign({}, live, { draft }));
      say("Recorded: Go back");
    }
    function navType() {
      try {
        const entry = win.performance.getEntriesByType("navigation")[0];
        return entry ? String(entry.type) : "";
      } catch {
        return "";
      }
    }
    const cameBack = () => navType() === "back_forward";
    async function record() {
      const live = await store.readLive();
      if (live.mode === "running" || live.mode === "paused") {
        say("Stop the run first.");
        return;
      }
      if (live.mode === "recording") {
        await stopRecording(live);
        return;
      }
      const token = readToken() || keepToken(newId());
      recRowNode = null;
      clearRowPaint();
      await writeFresh({
        mode: "recording",
        closing: live.closing,
        note: "",
        draft: Object.assign(newDraft({ origin: win.location.origin, listUrl: win.location.href, homeTab: token, visit }), { lastAt: Date.now() })
      });
      listenForClicks();
      startLoop();
      selected = -1;
      say("Recording: do one item by hand, starting with its button in the list.");
    }
    async function stopRecording(live) {
      stopListening();
      const origin2 = live.draft.origin;
      const previous = await store.readRecording(origin2);
      const out = finishRecording(live.draft, previous, { now: Date.now() });
      if (out.problem) {
        await writeFresh({ mode: "idle", closing: live.closing, note: out.problem });
        say(out.problem);
        return;
      }
      await store.writeRecording(origin2, out.recording);
      if (out.recording.firstRow) {
        const ledger = markRow(
          await store.readLedger(origin2),
          out.recording.firstRow.id,
          { status: "done", title: out.recording.firstRow.title, note: "done by hand", at: (/* @__PURE__ */ new Date()).toISOString(), page: 1 }
        );
        await store.writeLedger(origin2, ledger);
      }
      await writeFresh({ mode: "idle", closing: live.closing, note: `Recorded ${out.recording.steps.length} steps. Play repeats them for every item.` });
      selected = -1;
    }
    async function play() {
      const live = await store.readLive();
      if (live.mode === "recording") {
        say("Stop recording first.");
        return;
      }
      if (live.mode === "running") {
        await writeFresh(Object.assign({}, live, { mode: "paused" }));
        say("Paused.");
        return;
      }
      if (live.mode === "paused" && live.run) {
        await writeFresh(Object.assign({}, live, { mode: "running", run: resumed(live.run, Date.now()) }));
        if (live.run.home === readToken()) beat(live.run.home);
        startLoop();
        return;
      }
      const rec = await store.readRecording(win.location.origin);
      if (!rec) {
        say("Record one item first.");
        return;
      }
      const token = readToken() || keepToken(newId());
      const ledger = forgetFailed(await store.readLedger(rec.origin));
      await store.writeLedger(rec.origin, ledger);
      const run2 = startRun(rec, Object.assign(me(), { token }), Date.now());
      await writeFresh({ mode: "running", run: run2, closing: live.closing, note: "" });
      beat(token);
      startLoop();
      say("Playing.");
    }
    async function stop() {
      const live = await store.readLive();
      if (live.mode === "recording") {
        await stopRecording(live);
        return;
      }
      if (live.mode === "idle") {
        say("Nothing is running.");
        return;
      }
      closeHandles();
      await writeFresh(stopRun(live, "Stopped."));
      say("Stopped.");
    }
    async function reset() {
      const live = await store.readLive();
      if (live.mode !== "idle") {
        say("Stop first.");
        return;
      }
      const origin2 = recOriginOf(live);
      const count = Object.keys((await store.readLedger(origin2)).rows).length;
      if (!count) {
        say("The ledger is already empty.");
        return;
      }
      if (Date.now() > resetArmed) {
        resetArmed = Date.now() + 4e3;
        if (view) view.setReset("Confirm reset?");
        say(`Press again to forget ${count} item(s) on this site.`);
        setTimeout(() => {
          if (view && Date.now() > resetArmed) view.setReset("\u21BA Reset");
        }, 4100);
        return;
      }
      resetArmed = 0;
      if (view) view.setReset("\u21BA Reset");
      await store.writeLedger(origin2, { rows: {} });
      ledgerCache = { rows: {} };
      clearRowPaint();
      say("Forgot every item; Play starts from the first.");
    }
    async function backOne() {
      const live = await store.readLive();
      if (live.mode === "running") {
        say("Pause first, then Item back.");
        return;
      }
      if (live.mode === "recording") {
        say("Stop recording first.");
        return;
      }
      const origin2 = recOriginOf(live);
      const out = undoLast(await store.readLedger(origin2));
      if (!out.row) {
        say("Nothing done or skipped to take back.");
        return;
      }
      await store.writeLedger(origin2, out.ledger);
      ledgerCache = out.ledger;
      say(`Item back: "${String(out.row.title).slice(0, 70)}" will be done again.`);
    }
    async function stepBackNow() {
      const live = await store.readLive();
      if (live.mode !== "running" && live.mode !== "paused" || !live.run) {
        say("Nothing is running.");
        return;
      }
      const rec = await store.readRecording(live.run.origin);
      if (!rec) {
        say("The recording is missing.");
        return;
      }
      const out = stepBack(live.run, rec, Date.now());
      if (out.refused) {
        say(out.refused);
        return;
      }
      const closing = live.closing.slice();
      for (const token of out.closing) if (closing.indexOf(token) < 0) closing.push(token);
      await writeFresh(Object.assign({}, live, { run: out.run, closing }));
      say(`Step back: step ${out.run.at + 1} again, ${describeStep(rec.steps[out.run.at], out.run.at, rec.steps)}.`);
    }
    async function editRecording(change) {
      const live = await store.readLive();
      if (live.mode !== "idle") {
        say(live.mode === "recording" ? "Stop recording first." : "Stop the run first.");
        return;
      }
      const origin2 = recOriginOf(live);
      const rec = await store.readRecording(origin2);
      if (!rec) {
        say("Record one item first.");
        return;
      }
      const next = change(rec);
      if (next === rec) return;
      await store.writeRecording(origin2, next);
      recCache = next;
      render(live, next, ledgerCache);
      refreshHighlights(next, true);
    }
    function saveExport() {
      const now = /* @__PURE__ */ new Date();
      const out = { script: `popup-zapper ${version} step recorder`, at: now.toISOString(), recording: recCache, ledger: ledgerCache, live: liveCache };
      const link = doc.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
      link.download = `step-recorder-${win.location.hostname || "page"}-${fileStamp2(now)}.json`;
      link.style.display = "none";
      (doc.body || doc.documentElement).appendChild(link);
      link.click();
      link.remove();
      const made = link.href;
      setTimeout(() => {
        try {
          URL.revokeObjectURL(made);
        } catch {
        }
      }, 3e4);
      say("Saved " + link.download);
    }
    const run = (work) => () => {
      Promise.resolve().then(work).catch((error) => say("Recorder fault: " + (error && error.message)));
    };
    function readPosition() {
      try {
        const held = JSON.parse(win.localStorage.getItem(POSITION_KEY2) || "null");
        if (held && Number.isFinite(held.left) && Number.isFinite(held.top) && held.left < win.innerWidth - 40 && held.top < win.innerHeight - 30) return held;
      } catch {
      }
      return null;
    }
    function build() {
      view = createRecorderPanel({
        position: readPosition(),
        onClose: () => close(),
        onRecord: run(record),
        onPlay: run(play),
        onStop: run(stop),
        onReset: run(reset),
        onBack: run(backOne),
        onStepBack: run(stepBackNow),
        onExport: saveExport,
        onSelectStep: (index) => {
          selected = index === selected ? -1 : index;
          render(liveCache, recCache, ledgerCache);
        },
        onRemoveStep: (index) => run(() => editRecording((rec) => removeStep(rec, index)))(),
        onWaitSeconds: (index, value) => run(() => editRecording((rec) => setWait(rec, index, value)))(),
        onAddWait: run(() => editRecording((rec) => insertWait(rec, selected >= 0 ? selected : rec.steps.length - 1))),
        onAddCheck: (text) => run(() => {
          if (selected <= 0) {
            say("Choose the step whose page to check, then add the words.");
            return null;
          }
          return editRecording((rec) => insertCheck(rec, selected, text));
        })(),
        onSkipText: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { skipText: String(value) })))(),
        onOnlyText: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { onlyText: String(value) })))(),
        onHighlight: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { highlight: String(value) })))(),
        onPages: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { pages: readSetting(value, 0, 0, 1e4, true) })))(),
        onTimeout: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { timeout: readSetting(value, 30, 5, 600, true) })))()
      });
      (doc.body || doc.documentElement).appendChild(view.el);
      makeDraggable(view.el, view.head, (spot) => {
        try {
          win.localStorage.setItem(POSITION_KEY2, JSON.stringify(spot));
        } catch {
        }
      });
      shown = { steps: "", fields: "" };
      render(liveCache, recCache, ledgerCache);
    }
    function open() {
      if (opened) return;
      opened = true;
      build();
      startLoop();
      tick();
    }
    function close() {
      if (!opened) return true;
      opened = false;
      if (view) view.el.remove();
      view = null;
      if (liveCache.mode === "idle") {
        clearRowPaint();
        clearHighlights(doc);
      }
      return true;
    }
    function repaint2() {
      if (!opened) return;
      if (view) view.el.remove();
      build();
    }
    async function resume() {
      const live = await store.readLive();
      liveCache = live;
      const token = readToken();
      if (token && live.closing.indexOf(token) >= 0) {
        closeSelf();
        return true;
      }
      if (live.mode === "idle") return false;
      let opener = false;
      try {
        opener = !!win.opener;
      } catch {
        opener = true;
      }
      const cloned = !!token && win.history.length === 1 && opener && navType() === "navigate";
      const adopted = !token || cloned ? await adoptable(live) : null;
      const alive = beatFresh(await store.readBeat(), Date.now());
      const plan = tokenPlan(live, {
        token,
        cloned,
        adopted,
        historyLength: win.history.length,
        startedAt,
        now: Date.now(),
        beatFresh: alive
      });
      if (plan === "none") return false;
      if (plan === "adopt") keepToken(adopted);
      if (plan === "new") keepToken(newId());
      const leaving = await store.readLeaving();
      if (leaving && leaving.token === readToken()) store.writeLeavingNow(null);
      if (live.mode === "running" && live.run && live.run.home === readToken() && !alive) {
        await writeFresh(Object.assign({}, live, { mode: "paused", note: "" }));
        say("Paused: this tab was away from the run. Press Resume to carry on.");
      }
      if (live.mode === "recording") {
        listenForClicks();
        if (cameBack()) await noteBack();
        open();
      }
      startLoop();
      tick();
      return true;
    }
    win.addEventListener("pageshow", (event) => {
      if (!event || !event.persisted) return;
      visit = newId();
      startedAt = Date.now();
      completeAt = startedAt;
      holdUntil = 0;
      navigatedAt = 0;
      if (readToken() && liveCache.mode === "recording") noteBack().catch(() => {
      });
      if (readToken() && liveCache.mode !== "idle") startLoop();
    });
    win.addEventListener("pagehide", () => {
      const token = readToken();
      if (!token || liveCache.mode === "idle") return;
      try {
        store.writeLeavingNow({ token, at: Date.now(), origin: win.location.origin });
      } catch {
      }
    });
    return {
      open,
      close,
      toggle: () => opened ? close() : (open(), true),
      isOpen: () => opened,
      repaint: repaint2,
      resume,
      dispose() {
        stopLoop();
        stopListening();
      }
    };
  }

  // src/main.js
  var gm = createGm();
  var hostname = location.hostname.replace(/^www\./, "");
  var RAW_URL = "https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js";
  var VERSION = typeof GM_info !== "undefined" && GM_info && GM_info.script ? GM_info.script.version : "0.0.0";
  var THEME_KEY = "pz-theme";
  var library = null;
  var persist = () => {
    saveLibrary((k, v) => gm.set(k, v), library);
  };
  var activityLog = createActivityLog();
  var undo = createUndoStack();
  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  var recorder = createRecorderTool({ gm, pageWindow, version: VERSION });
  var batch = createBatchTool({
    version: VERSION,
    pageWindow,
    onSteps: () => {
      recorder.open();
    }
  });
  function domainEntry() {
    return library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} };
  }
  function describeEl(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList && el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }
  var lastStatus = "Ready.";
  function setStatus(msg) {
    lastStatus = msg;
    const strip = control && control.querySelector("[data-pz-status]");
    if (strip) strip.textContent = msg;
  }
  var BLOCK_ACTIONS = /* @__PURE__ */ new Set(["popup", "autozap", "paywall", "unlock"]);
  function pageBlocked() {
    return activityLog.entries().some((e) => BLOCK_ACTIONS.has(e.action));
  }
  function updateBadgeDot() {
    const dot = control && control.querySelector("[data-pz-dot]");
    if (dot) dot.style.display = pageBlocked() ? "block" : "none";
  }
  activityLog.subscribe(() => {
    const es = activityLog.entries();
    if (es.length) {
      const e = es[es.length - 1];
      setStatus(formatStatus(e.action, e.detail));
    }
    updateBadgeDot();
  });
  var lastInteraction = 0;
  for (const ev of ["click", "keydown", "submit", "pointerdown"]) {
    window.addEventListener(ev, () => {
      lastInteraction = Date.now();
    }, true);
  }
  var guard = createReloadGuard({
    now: () => Date.now(),
    sessionStorage: window.sessionStorage,
    hadRecentInteraction: () => Date.now() - lastInteraction < 1500
  });
  function installReloadDefense() {
    guard.recordReload();
    const origReload = Location.prototype.reload;
    try {
      Location.prototype.reload = function(...args) {
        if (guard.allowReload()) return origReload.apply(this, args);
        activityLog.add("reload", "blocked an automatic page reload");
      };
    } catch {
    }
    const origAssign = Location.prototype.assign;
    Location.prototype.assign = function(url) {
      if (guard.allowReload()) return origAssign.call(this, url);
      activityLog.add("reload", "blocked an automatic redirect");
    };
    const origReplace = Location.prototype.replace;
    Location.prototype.replace = function(url) {
      if (guard.allowReload()) return origReplace.call(this, url);
      activityLog.add("reload", "blocked an automatic redirect");
    };
    const stripMeta = () => {
      document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove());
    };
    document.addEventListener("DOMContentLoaded", stripMeta, { once: true });
  }
  function runOnce() {
    try {
      document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove());
    } catch {
    }
    runBlocker({ doc: document, library, hostname, log: (a, d) => activityLog.add(a, d) });
  }
  function startObserver() {
    let pending = false;
    const obs = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        runOnce();
      });
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"]
    });
  }
  var blockActive = false;
  function startBlock() {
    if (blockActive) return;
    blockActive = true;
    const picker = createPicker(document);
    let outlined = null;
    const highlight = () => {
      if (outlined) outlined.style.outline = "";
      outlined = picker.current();
      if (outlined && outlined !== document.body) outlined.style.outline = "3px solid #ff3b30";
    };
    const onKey = (e) => {
      if (e.key === "[") {
        e.preventDefault();
        picker.grow();
        highlight();
      } else if (e.key === "]") {
        e.preventDefault();
        picker.shrink();
        highlight();
      } else if (e.key === "Escape") {
        cleanup();
      }
    };
    const cleanup = () => {
      blockActive = false;
      if (outlined) outlined.style.outline = "";
      bar.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    const doBlock = (allSites) => {
      const el = picker.current();
      if (!el || el === document.body) {
        setStatus("Nothing selected to block");
        return cleanup();
      }
      const kws = extractKeywords(el);
      const rule = kws[0] ? { ...kws[0], enabled: true } : null;
      let ruleRef = null;
      if (rule) {
        const list = allSites ? library.global : domainEntry().rules;
        list.push(rule);
        ruleRef = { list, rule };
      }
      if (outlined) {
        outlined.style.outline = "";
        outlined = null;
      }
      undo.record(el, ruleRef);
      try {
        el.remove();
      } catch {
      }
      persist();
      setStatus(rule ? `\u2713 Blocked ${describeEl(el)} (${allSites ? "all sites" : "this site"})` : `\u2713 Removed ${describeEl(el)} (no rule saved)`);
      runOnce();
      cleanup();
    };
    const bar = createPickerToolbar({
      onPrev: () => {
        picker.prevCandidate();
        highlight();
      },
      onNext: () => {
        picker.nextCandidate();
        highlight();
      },
      onGrow: () => {
        picker.grow();
        highlight();
      },
      onShrink: () => {
        picker.shrink();
        highlight();
      },
      onBlock: doBlock,
      onCancel: cleanup
    });
    document.body.appendChild(bar);
    document.addEventListener("keydown", onKey, true);
    highlight();
  }
  function doRevert() {
    const ok = undo.revertLast();
    persist();
    setStatus(ok ? "\u21A9 Reverted last block" : "Nothing to revert");
    refreshControl();
  }
  function doReveal() {
    const n = revealDeep(document, (el) => !!(el.closest && el.closest("[data-pz]")));
    setStatus(n ? `\u{1F50E} Revealed content (${n} change(s))` : "Nothing more to reveal");
    refreshControl();
  }
  var filterPanel = null;
  function closeFilterPanel() {
    if (filterPanel) {
      filterPanel.remove();
      filterPanel = null;
    }
  }
  function offerFreeze() {
    const hosts = findPaywallHosts(document, window.performance);
    if (!hosts.length) {
      setStatus("No known paywall vendor detected to block");
      return;
    }
    const filters = buildUblockFilters(hosts);
    const show = (copied) => {
      closeFilterPanel();
      filterPanel = createFilterPanel({ filters, hosts, copied, onClose: closeFilterPanel });
      document.body.appendChild(filterPanel);
    };
    Promise.resolve(gm.clipboard(filters)).then(() => show(true), () => show(false));
  }
  function doRemovePaywall() {
    try {
      const cleared = resetMeter(document, window);
      if (cleared.length) activityLog.add("meter", `cleared ${cleared.length} meter key(s): ${cleared.join(", ")}`);
    } catch {
    }
    runOnce();
    try {
      captureSnapshot(document, window.sessionStorage);
    } catch {
    }
    setStatus("Fetching a clean, cookie-free copy\u2026");
    gm.xhr({
      method: "GET",
      url: location.href,
      anonymous: true,
      headers: { "Cache-Control": "no-cache" },
      onload: (res) => {
        try {
          const extracted = extractCleanContent(res.responseText);
          if (!extracted || extracted.len < 400) {
            setStatus("Clean copy was also gated (server-side). Offering permanent block\u2026");
            offerFreeze();
            return;
          }
          const html = buildCleanDocument(res.responseText, location.href);
          if (!html) {
            setStatus("Couldn't build the clean copy");
            return;
          }
          const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
          const w = window.open(url, "_blank");
          if (!w) window.location.href = url;
          setStatus(`\u2713 Opened clean copy (${extracted.len} chars) in a new tab`);
        } catch {
          setStatus("Error building clean copy");
        }
      },
      onerror: () => {
        setStatus("Clean fetch failed; offering permanent block\u2026");
        offerFreeze();
      }
    });
  }
  function openInstallPage() {
    gm.openTab(RAW_URL);
  }
  var updateState = { state: "idle" };
  function setUpdateState(next) {
    updateState = next;
    if (settingsPanel) reopenSettings();
  }
  function checkUpdates() {
    setUpdateState({ state: "checking" });
    const decide2 = (remote) => {
      const plan = updatePlan(VERSION, remote);
      if (plan.action === "install") setUpdateState({ state: "available", remote: plan.remote });
      else if (plan.action === "error") setUpdateState({ state: "error" });
      else setUpdateState({ state: "current" });
    };
    gm.xhr({
      method: "GET",
      url: RAW_URL + "?t=" + Date.now(),
      // cache-bust GitHub raw
      onload: (res) => decide2(parseVersion(res.responseText)),
      onerror: () => decide2(null)
    });
  }
  function installUpdate() {
    openInstallPage();
    setUpdateState({ state: "opened", remote: updateState.remote });
  }
  function reloadPage() {
    location.reload();
  }
  function copyDiagnostics() {
    const report = collectDiagnostics(document);
    Promise.resolve(gm.clipboard(report)).then(
      () => alert("Popup Zapper: diagnostics copied to clipboard. Paste them to share."),
      () => {
        console.log("[Popup Zapper diagnostics]\n" + report);
        alert("Popup Zapper: diagnostics logged to the console (press F12 to view).");
      }
    );
  }
  var logPanel = null;
  var logUnsub = null;
  function renderLogPanel() {
    if (logPanel) logPanel.remove();
    logPanel = createActivityPanel({
      entries: activityLog.entries(),
      onClear: () => activityLog.clear(),
      onClose: () => {
        closeLog();
      }
    });
    document.body.appendChild(logPanel);
    logPanel.scrollTop = logPanel.scrollHeight;
  }
  function closeLog() {
    if (logUnsub) {
      logUnsub();
      logUnsub = null;
    }
    if (logPanel) {
      logPanel.remove();
      logPanel = null;
    }
  }
  function toggleLog() {
    if (logPanel) {
      closeLog();
      return;
    }
    renderLogPanel();
    logUnsub = activityLog.subscribe(() => {
      if (logPanel) renderLogPanel();
    });
  }
  var settingsPanel = null;
  function closeSettings() {
    if (settingsPanel) {
      settingsPanel.remove();
      settingsPanel = null;
    }
  }
  function openSettings() {
    settingsPanel = createSettingsPanel({
      library,
      hostname,
      version: VERSION,
      theme: getTheme(),
      onToggleRule: ({ rule, enabled }) => {
        rule.enabled = enabled;
        persist();
        runOnce();
        reopenSettings();
      },
      onEditRule: ({ rule }) => {
        const next = prompt(`Edit rule value (matched by ${rule.type}):`, rule.value);
        if (next != null && next.trim()) {
          rule.value = next.trim();
          persist();
          runOnce();
          reopenSettings();
        }
      },
      onDeleteRule: ({ rule, scope }) => {
        if (scope === "global") library.global = library.global.filter((r) => r !== rule);
        else {
          const dom = library.domains[hostname];
          if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
        }
        persist();
        runOnce();
        reopenSettings();
      },
      onPromoteRule: ({ rule }) => {
        const dom = library.domains[hostname];
        if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
        library.global.push(rule);
        persist();
        reopenSettings();
      },
      onToggleCleanup: (on) => {
        domainEntry().cleanup = on;
        persist();
        if (on) runOnce();
      },
      onSetTheme: (mode) => {
        gm.set(THEME_KEY, setTheme(mode));
        repaint();
      },
      update: updateState,
      onCheckUpdates: checkUpdates,
      onInstallUpdate: installUpdate,
      onReloadPage: reloadPage,
      onCopyUpdate: () => {
        Promise.resolve(gm.clipboard(RAW_URL)).then(
          () => setUpdateState({ state: "copied", remote: updateState.remote }),
          () => setUpdateState({ state: "available", remote: updateState.remote })
        );
      },
      onShowLog: toggleLog,
      onDiagnostics: copyDiagnostics,
      onClose: closeSettings
    });
    document.body.appendChild(settingsPanel);
  }
  function reopenSettings() {
    closeSettings();
    openSettings();
  }
  function toggleSettings() {
    if (settingsPanel) closeSettings();
    else openSettings();
  }
  function toggleSite() {
    const i = library.disabledDomains.indexOf(hostname);
    if (i >= 0) library.disabledDomains.splice(i, 1);
    else library.disabledDomains.push(hostname);
    persist();
    const enabled = !library.disabledDomains.includes(hostname);
    activityLog.add("site", enabled ? "enabled on this site" : "disabled on this site");
    refreshControl();
    if (enabled) runOnce();
  }
  var control = null;
  var menuOpen = false;
  function safeResidual() {
    try {
      return hasResidualGating(document);
    } catch {
      return false;
    }
  }
  function refreshControl() {
    if (control) control.remove();
    control = createControlMenu({
      enabled: !library.disabledDomains.includes(hostname),
      hostname,
      open: menuOpen,
      status: lastStatus,
      showReveal: safeResidual(),
      blocked: pageBlocked(),
      onToggleMenu: toggleMenu,
      onToggleSite: toggleSite,
      onBlock: startBlock,
      onRemovePaywall: doRemovePaywall,
      onRevert: doRevert,
      onReveal: doReveal,
      onSettings: toggleSettings,
      onBatch: toggleBatch,
      batchOpen: batch.isOpen()
    });
    document.body.appendChild(control);
  }
  function toggleBatch() {
    if (batch.isOpen()) {
      if (!batch.close()) return;
    } else {
      batch.open();
      menuOpen = false;
    }
    refreshControl();
  }
  function toggleMenu() {
    menuOpen = !menuOpen;
    if (!menuOpen) {
      closeSettings();
      closeLog();
      closeFilterPanel();
    }
    refreshControl();
  }
  function repaint() {
    refreshControl();
    batch.repaint();
    recorder.repaint();
    if (settingsPanel) reopenSettings();
    if (logPanel) renderLogPanel();
  }
  try {
    GM_registerMenuCommand("Block a popup", startBlock);
    GM_registerMenuCommand("Remove paywall", doRemovePaywall);
    GM_registerMenuCommand("Revert last block", doRevert);
    GM_registerMenuCommand("Reveal deeper (this page)", doReveal);
    GM_registerMenuCommand("Batch clicker", toggleBatch);
    GM_registerMenuCommand("Step recorder", () => {
      recorder.toggle();
    });
    GM_registerMenuCommand("Settings", toggleSettings);
    GM_registerMenuCommand("Toggle zapper (this site)", toggleSite);
  } catch {
  }
  installReloadDefense();
  async function bootAsync() {
    setTouch(detectTouch());
    library = await loadLibraryAsync((k) => gm.get(k));
    setTheme(await gm.get(THEME_KEY, "auto"));
    const start = () => {
      runOnce();
      startObserver();
      refreshControl();
      try {
        if (batch.resume()) refreshControl();
      } catch {
      }
      recorder.resume().catch(() => {
      });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }
  bootAsync();
})();
