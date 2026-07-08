// ==UserScript==
// @name         Popup Zapper
// @namespace    https://github.com/EJR-of-Scrutopia/popup-zapper
// @version      2.0.0
// @description  Remove login/consent/newsletter/paywall popups, reveal blurred/gated content, defeat reload traps, and learn popups by click.
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
// @grant        GM_info
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
  function loadLibrary(getValue) {
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
  function saveLibrary(setValue, library2) {
    setValue("popupZapper.library", JSON.stringify(library2));
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
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
  function restorePage(doc) {
    const html = doc.documentElement;
    const body = doc.body;
    for (const node of [html, body]) {
      if (!node) continue;
      node.style.setProperty("overflow", "auto", "important");
      node.style.setProperty("position", "static", "important");
      node.style.removeProperty("height");
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
  function updateMessage(current, remote) {
    if (!remote) return "Couldn't check for updates (network blocked).";
    const c = compareVersions(remote, current);
    if (c > 0) return `v${remote} available \u2014 your userscript manager will install it.`;
    return "Up to date \u2713";
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
  function createControlMenu({
    enabled,
    hostname: hostname2,
    open,
    status,
    showReveal,
    onToggleSite,
    onBlock,
    onRemovePaywall,
    onRevert,
    onReveal,
    onSettings
  }) {
    const wrap = own(tag("div", { className: PREFIX2 + "control" }), "control");
    wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;";
    const badge = tag("button", {
      textContent: enabled ? "\u26A1 Zapper: ON" : "\u26A1 Zapper: OFF",
      title: "Popup Zapper menu"
    });
    badge.setAttribute("data-act", "menu");
    badge.style.cssText = "padding:5px 10px;border:0;border-radius:6px;color:#fff;cursor:pointer;opacity:.9;box-shadow:0 1px 4px rgba(0,0,0,.4);font-weight:bold;background:" + (enabled ? "#2e7d32" : "#b00020");
    const menu = tag("div");
    menu.style.cssText = `display:${open ? "block" : "none"};position:absolute;bottom:34px;right:0;background:#fff;color:#111;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.3);overflow:hidden;min-width:240px;`;
    const header = tag("div");
    header.style.cssText = "padding:8px 12px;background:#f6f6f6;border-bottom:1px solid #e0e0e0;";
    const hRow = tag("div");
    hRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";
    hRow.appendChild(tag("span", {
      textContent: hostname2 || "this site",
      style: "font-weight:bold;color:#333;word-break:break-all;"
    }));
    const toggle = tag("button", { textContent: enabled ? "On \u25CF" : "Off \u25CB" });
    toggle.setAttribute("data-act", "site");
    toggle.title = enabled ? "Turn off for this site" : "Turn on for this site";
    toggle.style.cssText = "border:0;border-radius:12px;padding:3px 10px;cursor:pointer;font-weight:bold;color:#fff;background:" + (enabled ? "#2e7d32" : "#b00020");
    toggle.addEventListener("click", onToggleSite);
    hRow.appendChild(toggle);
    header.appendChild(hRow);
    menu.appendChild(header);
    const item = (act, label, handler, accent) => {
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", act);
      b.style.cssText = `display:block;width:100%;text-align:left;padding:9px 12px;border:0;background:#fff;color:${accent || "#111"};cursor:pointer;font:12px sans-serif;`;
      b.addEventListener("mouseenter", () => {
        b.style.background = "#f0f0f0";
      });
      b.addEventListener("mouseleave", () => {
        b.style.background = "#fff";
      });
      if (handler) b.addEventListener("click", handler);
      menu.appendChild(b);
      return b;
    };
    item("block", "\u25CE Block a popup", onBlock);
    item("paywall", "\u21EA Remove paywall", onRemovePaywall);
    item("revert", "\u21A9 Revert last block", onRevert);
    const strip = tag("div");
    strip.setAttribute("data-pz-status", "");
    strip.style.cssText = "padding:7px 12px;border-top:1px solid #eee;border-bottom:1px solid #eee;color:#555;font:11px sans-serif;min-height:16px;background:#fafafa;";
    strip.textContent = status || "Ready.";
    menu.appendChild(strip);
    if (showReveal) {
      item("reveal", "\u{1F50E} Still blocked? Reveal deeper", onReveal, "#8a5a00");
    }
    item("settings", "\u2699 Settings", onSettings);
    badge.addEventListener("click", () => {
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    wrap.appendChild(badge);
    wrap.appendChild(menu);
    return wrap;
  }
  function createSettingsPanel({
    library: library2,
    hostname: hostname2,
    version,
    onToggleRule,
    onEditRule,
    onDeleteRule,
    onPromoteRule,
    onToggleCleanup,
    onCheckUpdates,
    onShowLog,
    onDiagnostics,
    onClose
  }) {
    const panel = own(tag("div", { className: PREFIX2 + "settings" }), "settings");
    panel.style.cssText = "position:fixed;top:40px;right:12px;z-index:2147483647;background:#fff;color:#111;padding:12px;border-radius:8px;font:13px sans-serif;max-height:74vh;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.3);min-width:300px;max-width:92vw;";
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
    head.appendChild(tag("strong", { textContent: "\u2699 Settings" }));
    const cls = tag("button", { textContent: "\u2715" });
    cls.setAttribute("data-act", "close");
    cls.style.cssText = "border:0;background:none;font-size:16px;cursor:pointer;";
    cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel.appendChild(head);
    panel.appendChild(tag("div", {
      textContent: "What's blocked on this site",
      style: "font-weight:bold;color:#333;margin:6px 0 4px;"
    }));
    const addRule = (rule, scope) => {
      const row = tag("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";
      const cb = tag("input", { type: "checkbox", checked: rule.enabled !== false });
      cb.setAttribute("data-act", "toggle-rule");
      cb.addEventListener("change", () => onToggleRule({ rule, scope, enabled: cb.checked }));
      row.appendChild(cb);
      row.appendChild(tag("span", {
        textContent: `[${scope}] ${rule.type}: ${rule.value}`,
        style: "flex:1;word-break:break-all;color:" + (rule.enabled === false ? "#999" : "#111")
      }));
      const edit = tag("button", { textContent: "Edit" });
      edit.setAttribute("data-act", "edit-rule");
      edit.addEventListener("click", () => onEditRule({ rule, scope }));
      row.appendChild(edit);
      const del = tag("button", { textContent: "Delete" });
      del.setAttribute("data-act", "delete-rule");
      del.addEventListener("click", () => onDeleteRule({ rule, scope }));
      row.appendChild(del);
      if (scope === "site") {
        const prom = tag("button", { textContent: "Make global" });
        prom.setAttribute("data-act", "promote-rule");
        prom.addEventListener("click", () => onPromoteRule({ rule }));
        row.appendChild(prom);
      }
      panel.appendChild(row);
    };
    const globals = library2.global || [];
    const dom = (library2.domains || {})[hostname2] || {};
    const siteRules = dom.rules || [];
    if (!globals.length && !siteRules.length) {
      panel.appendChild(tag("div", {
        textContent: "No rules yet. Use \u201CBlock a popup\u201D to add one.",
        style: "color:#888;margin:2px 0 6px;"
      }));
    }
    for (const r of globals) addRule(r, "global");
    for (const r of siteRules) addRule(r, "site");
    const cleanupRow = tag("label");
    cleanupRow.style.cssText = "display:flex;gap:6px;align-items:center;margin:10px 0 4px;border-top:1px solid #eee;padding-top:8px;";
    const cleanupCb = tag("input", { type: "checkbox", checked: dom.cleanup === true });
    cleanupCb.setAttribute("data-act", "toggle-cleanup");
    cleanupCb.addEventListener("change", () => onToggleCleanup(cleanupCb.checked));
    cleanupRow.appendChild(cleanupCb);
    cleanupRow.appendChild(tag("span", { textContent: "Delete tracking cookies/storage on this site (can log you out)" }));
    panel.appendChild(cleanupRow);
    const verRow = tag("div");
    verRow.style.cssText = "display:flex;gap:8px;align-items:center;margin:10px 0 4px;border-top:1px solid #eee;padding-top:8px;";
    verRow.appendChild(tag("span", { textContent: `Popup Zapper v${version}`, style: "flex:1;color:#333;" }));
    const upd = tag("button", { textContent: "Check for updates" });
    upd.setAttribute("data-act", "check-updates");
    upd.addEventListener("click", onCheckUpdates);
    verRow.appendChild(upd);
    panel.appendChild(verRow);
    const dbg = tag("div");
    dbg.style.cssText = "display:flex;gap:8px;margin-top:8px;";
    const logBtn = tag("button", { textContent: "\u{1F4DC} Activity log" });
    logBtn.setAttribute("data-act", "log");
    logBtn.addEventListener("click", onShowLog);
    dbg.appendChild(logBtn);
    if (onDiagnostics) {
      const diagBtn = tag("button", { textContent: "\u{1F527} Copy diagnostics" });
      diagBtn.setAttribute("data-act", "diag");
      diagBtn.addEventListener("click", onDiagnostics);
      dbg.appendChild(diagBtn);
    }
    panel.appendChild(dbg);
    return panel;
  }
  function createPickerToolbar({ onPrev, onNext, onGrow, onShrink, onBlock, onCancel }) {
    const mk = (act, label, handler, title) => {
      const b = tag("button", { textContent: label, title: title || label });
      b.setAttribute("data-act", act);
      b.style.cssText = "margin:0 3px;padding:4px 9px;font:13px sans-serif;cursor:pointer;border-radius:4px;border:0;";
      b.addEventListener("click", handler);
      return b;
    };
    const bar = own(tag("div", { className: PREFIX2 + "picker" }), "picker");
    bar.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:8px 12px;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;";
    bar.appendChild(tag("span", { textContent: "Pick the popup: ", style: "margin-right:6px" }));
    bar.appendChild(mk("prev", "\u25C0", onPrev, "Previous candidate"));
    bar.appendChild(mk("next", "\u25B6", onNext, "Next candidate"));
    bar.appendChild(mk("grow", "\u25B2", onGrow, "Select parent ( [ )"));
    bar.appendChild(mk("shrink", "\u25BC", onShrink, "Select child ( ] )"));
    const applyAll = tag("label", { style: "margin:0 8px;font:12px sans-serif;" });
    const allCb = tag("input", { type: "checkbox" });
    allCb.setAttribute("data-act", "all-sites");
    applyAll.appendChild(allCb);
    applyAll.appendChild(tag("span", { textContent: " all sites" }));
    bar.appendChild(applyAll);
    bar.appendChild(mk("block", "\u2713 Block", () => onBlock(allCb.checked), "Block this element"));
    bar.appendChild(mk("cancel", "Cancel", onCancel));
    return bar;
  }
  function createFilterPanel({ filters, hosts, copied, onClose }) {
    const panel = own(tag("div", { className: PREFIX2 + "filters" }), "filters");
    panel.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:#fff;color:#111;padding:16px;border-radius:10px;width:440px;max-width:92vw;font:13px sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.5);";
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
    head.appendChild(tag("strong", { textContent: "\u{1F9CA} Block this paywall permanently" }));
    const cls = tag("button", { textContent: "\u2715" });
    cls.setAttribute("data-act", "close");
    cls.style.cssText = "border:0;background:none;font-size:16px;cursor:pointer;";
    cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel.appendChild(head);
    panel.appendChild(tag("div", {
      textContent: `Found ${hosts.length} paywall/metering host(s) on this page${copied ? " \u2014 copied to your clipboard." : "."}`,
      style: "margin-bottom:8px;color:#333;"
    }));
    const area = tag("textarea");
    area.value = filters;
    area.readOnly = true;
    area.style.cssText = "width:100%;height:96px;font:12px monospace;box-sizing:border-box;border:1px solid #ccc;border-radius:6px;padding:8px;resize:vertical;";
    area.addEventListener("focus", () => area.select());
    panel.appendChild(area);
    const steps = tag("ol");
    steps.style.cssText = "margin:10px 0 0 0;padding-left:20px;color:#333;line-height:1.6;";
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
    const panel = own(tag("div", { className: PREFIX2 + "log" }), "log");
    panel.style.cssText = "position:fixed;bottom:54px;right:12px;z-index:2147483647;background:#111;color:#eee;padding:10px;border-radius:8px;font:11px/1.5 monospace;max-height:50vh;width:340px;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.5);";
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;";
    head.appendChild(tag("strong", { textContent: "Activity", style: "color:#fff" }));
    const btns = tag("div");
    const clr = tag("button", { textContent: "Clear" });
    clr.setAttribute("data-act", "clear");
    clr.style.cssText = "margin-left:6px;cursor:pointer;font:11px monospace;";
    clr.addEventListener("click", onClear);
    const cls = tag("button", { textContent: "\u2715" });
    cls.setAttribute("data-act", "close");
    cls.style.cssText = "margin-left:6px;cursor:pointer;font:11px monospace;";
    cls.addEventListener("click", onClose);
    btns.appendChild(clr);
    btns.appendChild(cls);
    head.appendChild(btns);
    panel.appendChild(head);
    if (!entries || entries.length === 0) {
      panel.appendChild(tag("div", {
        textContent: "Nothing yet on this page. If a popup is here, use Block a popup.",
        style: "color:#aaa"
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

  // src/main.js
  var getV = (k) => GM_getValue(k);
  var setV = (k, v) => GM_setValue(k, v);
  var hostname = location.hostname.replace(/^www\./, "");
  var RAW_URL = "https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js";
  var VERSION = typeof GM_info !== "undefined" && GM_info && GM_info.script ? GM_info.script.version : "0.0.0";
  var library = loadLibrary(getV);
  var persist = () => saveLibrary(setV, library);
  var activityLog = createActivityLog();
  var undo = createUndoStack();
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
  activityLog.subscribe(() => {
    const es = activityLog.entries();
    if (es.length) {
      const e = es[es.length - 1];
      setStatus(`${e.action}: ${e.detail}`);
    }
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
  function offerFreeze() {
    const hosts = findPaywallHosts(document, window.performance);
    if (!hosts.length) {
      setStatus("No known paywall vendor detected to block");
      return;
    }
    const filters = buildUblockFilters(hosts);
    let copied = false;
    try {
      GM_setClipboard(filters);
      copied = true;
    } catch {
    }
    if (filterPanel) filterPanel.remove();
    filterPanel = createFilterPanel({
      filters,
      hosts,
      copied,
      onClose: () => {
        if (filterPanel) {
          filterPanel.remove();
          filterPanel = null;
        }
      }
    });
    document.body.appendChild(filterPanel);
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
    if (typeof GM_xmlhttpRequest !== "function") {
      setStatus("Remove paywall: fetch unavailable in this manager");
      return;
    }
    setStatus("Fetching a clean, cookie-free copy\u2026");
    GM_xmlhttpRequest({
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
  function checkUpdates() {
    if (typeof GM_xmlhttpRequest !== "function") {
      alert("Popup Zapper: update check unavailable in this manager.");
      return;
    }
    GM_xmlhttpRequest({
      method: "GET",
      url: RAW_URL,
      onload: (res) => alert("Popup Zapper: " + updateMessage(VERSION, parseVersion(res.responseText))),
      onerror: () => alert("Popup Zapper: " + updateMessage(VERSION, null))
    });
  }
  function copyDiagnostics() {
    const report = collectDiagnostics(document);
    try {
      GM_setClipboard(report);
      alert("Popup Zapper: diagnostics copied to clipboard. Paste them to share.");
    } catch {
      console.log("[Popup Zapper diagnostics]\n" + report);
      alert("Popup Zapper: diagnostics logged to the console (press F12 to view).");
    }
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
      onCheckUpdates: checkUpdates,
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
    refreshControl(true);
    if (enabled) runOnce();
  }
  var control = null;
  function safeResidual() {
    try {
      return hasResidualGating(document);
    } catch {
      return false;
    }
  }
  function refreshControl(open) {
    if (control) control.remove();
    control = createControlMenu({
      enabled: !library.disabledDomains.includes(hostname),
      hostname,
      open: !!open,
      status: lastStatus,
      showReveal: safeResidual(),
      onToggleSite: toggleSite,
      onBlock: startBlock,
      onRemovePaywall: doRemovePaywall,
      onRevert: doRevert,
      onReveal: doReveal,
      onSettings: toggleSettings
    });
    document.body.appendChild(control);
  }
  try {
    GM_registerMenuCommand("Block a popup", startBlock);
    GM_registerMenuCommand("Remove paywall", doRemovePaywall);
    GM_registerMenuCommand("Revert last block", doRevert);
    GM_registerMenuCommand("Reveal deeper (this page)", doReveal);
    GM_registerMenuCommand("Settings", toggleSettings);
    GM_registerMenuCommand("Toggle zapper (this site)", toggleSite);
  } catch {
  }
  installReloadDefense();
  function boot() {
    runOnce();
    startObserver();
    refreshControl();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
