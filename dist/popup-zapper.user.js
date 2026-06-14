// ==UserScript==
// @name         Popup Zapper
// @namespace    https://github.com/param/popup-zapper
// @version      1.4.0
// @description  Remove login/consent/newsletter/paywall popups, restore blurred content, defeat reload traps, auto-zap overlays, and learn new popups by click.
// @author       Param
// @match        *://*/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
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
  function styleOf(el) {
    const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    return {
      filter: el.style.filter || cs.filter || "",
      backdrop: el.style.backdropFilter || cs.backdropFilter || "",
      opacity: el.style.opacity || cs.opacity || "1",
      pointerEvents: el.style.pointerEvents || cs.pointerEvents || "auto",
      userSelect: el.style.userSelect || cs.userSelect || "auto",
      maxHeight: el.style.maxHeight || cs.maxHeight || "none"
    };
  }
  function detectDegradation(el) {
    const s = styleOf(el);
    const blur = /blur\(/i.test(s.filter) || /blur\(/i.test(s.backdrop);
    const opacity = parseFloat(s.opacity) <= 0.05;
    const pointerEvents = s.pointerEvents === "none";
    const userSelect = s.userSelect === "none";
    const maxHeight = /\d/.test(s.maxHeight) && s.maxHeight !== "none";
    return { blur, opacity, pointerEvents, userSelect, maxHeight };
  }
  function restoreElement(el) {
    if (!el || el.nodeType !== 1) return;
    el.style.setProperty("filter", "none", "important");
    el.style.setProperty("backdrop-filter", "none", "important");
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("pointer-events", "auto", "important");
    el.style.setProperty("user-select", "auto", "important");
    el.style.removeProperty("max-height");
  }
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
  function findBestGuess(doc) {
    let best = null;
    let bestScore = MIN_SCORE - 1;
    for (const el of doc.body.querySelectorAll("*")) {
      if (el.closest && el.closest("[data-pz]")) continue;
      if (el.id && EXT_ROOTS.test(el.id)) continue;
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
    const guess = findBestGuess(doc);
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
    for (const el of doc.body.querySelectorAll("*")) {
      if (skip(el, whitelist)) continue;
      let cs;
      try {
        cs = win.getComputedStyle(el);
      } catch {
        continue;
      }
      const mh = parseFloat(cs.maxHeight);
      const clipped = /hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY);
      if (!Number.isNaN(mh) && cs.maxHeight !== "none" && mh < 2e3 && clipped) {
        if ((el.textContent || "").length > 600) {
          el.style.setProperty("max-height", "none", "important");
          el.style.setProperty("overflow", "visible", "important");
          changes++;
        }
      }
    }
    if (changes) log("unlock", `unlocked gated content (${changes} change(s))`);
  }
  function restorePass(doc, whitelist, log) {
    restorePage(doc);
    for (const el of doc.body.querySelectorAll("*")) {
      if (skip(el, whitelist)) continue;
      const style = el.getAttribute && el.getAttribute("style");
      if (style && /pointer-events\s*:\s*none|opacity\s*:\s*0/i.test(style)) {
        safe(() => restoreElement(el));
      }
    }
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

  // src/lib/ui.js
  var PREFIX = "pz-";
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
    autozap,
    hostname: hostname2,
    open,
    onLearn,
    onManage,
    onToggleAutozap,
    onToggleSite,
    onShowLog,
    onDiagnostics,
    onFreeze
  }) {
    const wrap = own(tag("div", { className: PREFIX + "control" }), "control");
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
    header.appendChild(tag("div", {
      textContent: hostname2 || "this site",
      style: "font-weight:bold;color:#333;word-break:break-all;"
    }));
    header.appendChild(tag("div", {
      textContent: enabled ? "\u25CF Running on this site" : "\u25CB Turned off on this site",
      style: `color:${enabled ? "#2e7d32" : "#b00020"};margin-top:2px;`
    }));
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
      b.addEventListener("click", handler);
      menu.appendChild(b);
      return b;
    };
    item(
      "site",
      enabled ? "\u{1F534} Turn OFF for this site" : "\u{1F7E2} Turn ON for this site",
      onToggleSite,
      enabled ? "#b00020" : "#2e7d32"
    );
    item(
      "autozap",
      `\u{1F916} Auto-zap: ${autozap ? "ON" : "OFF"}  \u2014  tap to turn ${autozap ? "off" : "on"}`,
      onToggleAutozap
    );
    if (onFreeze) item("freeze", "\u{1F9CA} Freeze auth (block paywall)", onFreeze);
    item("learn", "\u{1F3AF} Learn a popup", onLearn);
    item("manage", "\u{1F4CB} Manage rules", onManage);
    item("log", "\u{1F4DC} Activity log", onShowLog);
    if (onDiagnostics) item("diag", "\u{1F527} Copy diagnostics (debug)", onDiagnostics);
    badge.addEventListener("click", () => {
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    wrap.appendChild(badge);
    wrap.appendChild(menu);
    return wrap;
  }
  function createFilterPanel({ filters, hosts, copied, onClose }) {
    const panel2 = own(tag("div", { className: PREFIX + "filters" }), "filters");
    panel2.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;background:#fff;color:#111;padding:16px;border-radius:10px;width:440px;max-width:92vw;font:13px sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.5);";
    const head = tag("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
    head.appendChild(tag("strong", { textContent: "\u{1F9CA} Freeze auth \u2014 block this paywall" }));
    const cls = tag("button", { textContent: "\u2715" });
    cls.setAttribute("data-act", "close");
    cls.style.cssText = "border:0;background:none;font-size:16px;cursor:pointer;";
    cls.addEventListener("click", onClose);
    head.appendChild(cls);
    panel2.appendChild(head);
    panel2.appendChild(tag("div", {
      textContent: `Found ${hosts.length} paywall/metering host(s) on this page${copied ? " \u2014 copied to your clipboard." : "."}`,
      style: "margin-bottom:8px;color:#333;"
    }));
    const area = tag("textarea");
    area.value = filters;
    area.readOnly = true;
    area.style.cssText = "width:100%;height:96px;font:12px monospace;box-sizing:border-box;border:1px solid #ccc;border-radius:6px;padding:8px;resize:vertical;";
    area.addEventListener("focus", () => area.select());
    panel2.appendChild(area);
    const steps = tag("ol");
    steps.style.cssText = "margin:10px 0 0 0;padding-left:20px;color:#333;line-height:1.6;";
    for (const s of [
      "Open uBlock Origin \u2192 Dashboard (the gears icon).",
      'Go to the "My filters" tab.',
      "Paste the lines above (already copied) at the end.",
      'Click "Apply changes", then reload this page.'
    ]) steps.appendChild(tag("li", { textContent: s }));
    panel2.appendChild(steps);
    return panel2;
  }
  function createActivityPanel({ entries, onClear, onClose }) {
    const panel2 = own(tag("div", { className: PREFIX + "log" }), "log");
    panel2.style.cssText = "position:fixed;bottom:54px;right:12px;z-index:2147483647;background:#111;color:#eee;padding:10px;border-radius:8px;font:11px/1.5 monospace;max-height:50vh;width:340px;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.5);";
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
    panel2.appendChild(head);
    if (!entries || entries.length === 0) {
      panel2.appendChild(tag("div", {
        textContent: "Nothing yet on this page. If a popup is here, use Learn a popup or turn on Auto-zap.",
        style: "color:#aaa"
      }));
    } else {
      for (const e of entries) {
        const time = new Date(e.t).toLocaleTimeString();
        const times = e.count > 1 ? ` (x${e.count})` : "";
        panel2.appendChild(tag("div", { textContent: `${time}  [${e.action}] ${e.detail}${times}` }));
      }
    }
    return panel2;
  }
  function createLearnerToolbar({ onConfirm, onPick, onCancel }) {
    const mk = (act, label) => {
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", act);
      b.style.cssText = "margin:0 4px;padding:4px 8px;font:12px sans-serif;cursor:pointer;";
      return b;
    };
    const bar = own(tag("div", { className: PREFIX + "toolbar" }, [
      tag("span", { textContent: "Popup? " }),
      mk("confirm", "\u2713 Yes"),
      mk("pick", "Click the right one"),
      mk("cancel", "Cancel")
    ]), "toolbar");
    bar.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:8px 12px;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);";
    bar.querySelector("[data-act='confirm']").addEventListener("click", onConfirm);
    bar.querySelector("[data-act='pick']").addEventListener("click", onPick);
    bar.querySelector("[data-act='cancel']").addEventListener("click", onCancel);
    return bar;
  }
  function createManagePanel({ library: library2, hostname: hostname2, onDelete, onPromote }) {
    const panel2 = own(tag("div", { className: PREFIX + "panel" }), "panel");
    panel2.style.cssText = "position:fixed;top:40px;right:12px;z-index:2147483647;background:#fff;color:#111;padding:12px;border-radius:8px;font:13px sans-serif;max-height:70vh;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.3);min-width:280px;";
    const rows = [];
    const addRow = (rule, scope) => {
      const row = tag("div");
      row.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";
      row.appendChild(tag("span", {
        textContent: `[${scope}] ${rule.type}: ${rule.value}`,
        style: "flex:1"
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
    panel2.appendChild(tag("strong", { textContent: "Popup Zapper rules" }));
    for (const r of library2.global || []) addRow(r, "global");
    const dom = (library2.domains || {})[hostname2];
    for (const r of dom && dom.rules || []) addRow(r, "site");
    for (const row of rows) panel2.appendChild(row);
    return panel2;
  }

  // src/main.js
  var getV = (k) => GM_getValue(k);
  var setV = (k, v) => GM_setValue(k, v);
  var hostname = location.hostname.replace(/^www\./, "");
  var library = loadLibrary(getV);
  var persist = () => saveLibrary(setV, library);
  var activityLog = createActivityLog();
  function domainEntry() {
    return library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} };
  }
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
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
  var learnerActive = false;
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
        const dom = domainEntry();
        dom.rules.push(...kws);
        dom.restore = { ...dom.restore, ...detectDegradation(el) };
        persist();
        activityLog.add("learn", `saved ${kws.length} rule(s) from ${el.tagName.toLowerCase()}`);
        runOnce();
      } else {
        activityLog.add("learn", "could not extract a stable keyword from that element");
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
      onPick: () => {
        document.addEventListener("click", onPick, true);
      },
      onCancel: cleanup
    });
    document.body.appendChild(toolbar);
  }
  var panel = null;
  function toggleManage() {
    if (panel) {
      panel.remove();
      panel = null;
      return;
    }
    panel = createManagePanel({
      library,
      hostname,
      onDelete: ({ rule, scope }) => {
        if (scope === "global") {
          library.global = library.global.filter((r) => r !== rule);
        } else {
          const dom = library.domains[hostname];
          if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
        }
        persist();
        panel.remove();
        panel = null;
        toggleManage();
      },
      onPromote: ({ rule }) => {
        const dom = library.domains[hostname];
        if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
        library.global.push(rule);
        persist();
        panel.remove();
        panel = null;
        toggleManage();
      }
    });
    document.body.appendChild(panel);
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
  var filterPanel = null;
  function freezeAuth() {
    const hosts = findPaywallHosts(document, window.performance);
    if (!hosts.length) {
      alert("Popup Zapper: no known paywall/metering scripts detected on this page.");
      return;
    }
    const filters = buildUblockFilters(hosts);
    let copied = false;
    try {
      GM_setClipboard(filters);
      copied = true;
    } catch {
    }
    activityLog.add("freeze", `found ${hosts.length} paywall host(s): ${hosts.join(", ")}`);
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
  function toggleAutozap() {
    const dom = domainEntry();
    dom.autozap = !dom.autozap;
    persist();
    activityLog.add("autozap", dom.autozap ? "enabled on this site" : "disabled on this site");
    refreshControl(true);
    runOnce();
  }
  var control = null;
  function refreshControl(open) {
    if (control) control.remove();
    const dom = (library.domains || {})[hostname];
    control = createControlMenu({
      enabled: !library.disabledDomains.includes(hostname),
      autozap: !!(dom && dom.autozap),
      hostname,
      open: !!open,
      onLearn: startLearner,
      onManage: toggleManage,
      onToggleAutozap: toggleAutozap,
      onToggleSite: toggleSite,
      onShowLog: toggleLog,
      onDiagnostics: copyDiagnostics,
      onFreeze: freezeAuth
    });
    document.body.appendChild(control);
  }
  try {
    GM_registerMenuCommand("Learn a popup", startLearner);
    GM_registerMenuCommand("Manage rules", toggleManage);
    GM_registerMenuCommand("Toggle auto-zap (this site)", toggleAutozap);
    GM_registerMenuCommand("Show activity log", toggleLog);
    GM_registerMenuCommand("Freeze auth (block paywall via uBlock)", freezeAuth);
    GM_registerMenuCommand("Copy page diagnostics (debug)", copyDiagnostics);
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
