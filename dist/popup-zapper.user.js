// ==UserScript==
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
  function consentPass(doc) {
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
        return;
      }
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
  function runBlocker({ doc, library: library2, hostname: hostname2 }) {
    if (!library2.enabled) return;
    if ((library2.disabledDomains || []).includes(hostname2)) return;
    const rules = getActiveRules(library2, hostname2);
    safe(() => consentPass(doc));
    const domain = (library2.domains || {})[hostname2];
    if (domain && domain.cleanup) {
      safe(() => runCleanup(doc, doc.defaultView));
    }
    safe(() => popupPass(doc, rules, library2.whitelist));
    safe(() => restorePass(doc, rules, library2.whitelist));
  }
  function safe(fn) {
    try {
      fn();
    } catch {
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

  // src/lib/learner.js
  var WALL_TEXT = /sign ?in|log ?in|subscribe|sign ?up|register|cookie|consent|create (an )?account|continue reading/i;
  var MIN_SCORE = 3;
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
      const s = scorePopupCandidate(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    return bestScore >= MIN_SCORE ? best : null;
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

  // src/lib/ui.js
  var PREFIX = "pz-";
  function tag(name, props = {}, children = []) {
    const el = document.createElement(name);
    Object.assign(el, props);
    for (const c of children) el.appendChild(c);
    return el;
  }
  function createBadge({ enabled, onToggle }) {
    const badge2 = tag("button", {
      className: PREFIX + "badge",
      textContent: enabled ? "Zapper: ON" : "Zapper: OFF",
      title: "Toggle Popup Zapper on this site"
    });
    badge2.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;padding:4px 8px;font:12px sans-serif;border:0;border-radius:6px;color:#fff;cursor:pointer;opacity:.6;background:" + (enabled ? "#2e7d32" : "#9e9e9e");
    badge2.addEventListener("click", onToggle);
    return badge2;
  }
  function createLearnerToolbar({ onConfirm, onPick, onCancel }) {
    const mk = (act, label) => {
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", act);
      b.style.cssText = "margin:0 4px;padding:4px 8px;font:12px sans-serif;cursor:pointer;";
      return b;
    };
    const bar = tag("div", { className: PREFIX + "toolbar" }, [
      tag("span", { textContent: "Popup? " }),
      mk("confirm", "\u2713 Yes"),
      mk("pick", "Click the right one"),
      mk("cancel", "Cancel")
    ]);
    bar.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#222;color:#fff;padding:8px 12px;border-radius:8px;font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);";
    bar.querySelector("[data-act='confirm']").addEventListener("click", onConfirm);
    bar.querySelector("[data-act='pick']").addEventListener("click", onPick);
    bar.querySelector("[data-act='cancel']").addEventListener("click", onCancel);
    return bar;
  }
  function createManagePanel({ library: library2, hostname: hostname2, onDelete, onPromote }) {
    const panel2 = tag("div", { className: PREFIX + "panel" });
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
      };
    } catch {
    }
    const origAssign = Location.prototype.assign;
    Location.prototype.assign = function(url) {
      if (guard.allowReload()) return origAssign.call(this, url);
    };
    const origReplace = Location.prototype.replace;
    Location.prototype.replace = function(url) {
      if (guard.allowReload()) return origReplace.call(this, url);
    };
    const stripMeta = () => {
      document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove());
    };
    document.addEventListener("DOMContentLoaded", stripMeta, { once: true });
  }
  function runOnce() {
    runBlocker({ doc: document, library, hostname });
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
        const dom = library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} };
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
  function toggleSite() {
    const i = library.disabledDomains.indexOf(hostname);
    if (i >= 0) library.disabledDomains.splice(i, 1);
    else library.disabledDomains.push(hostname);
    persist();
    refreshBadge();
  }
  function toggleCleanup() {
    const dom = library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} };
    dom.cleanup = !dom.cleanup;
    persist();
    runOnce();
  }
  var badge = null;
  function refreshBadge() {
    if (badge) badge.remove();
    badge = createBadge({
      enabled: !library.disabledDomains.includes(hostname),
      onToggle: toggleSite
    });
    document.body.appendChild(badge);
  }
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === "p") {
      e.preventDefault();
      startLearner();
    } else if (k === "m") {
      e.preventDefault();
      toggleManage();
    } else if (k === "z") {
      e.preventDefault();
      toggleSite();
    } else if (k === "c") {
      e.preventDefault();
      toggleCleanup();
    }
  }, true);
  try {
    GM_registerMenuCommand("Learn a popup (Alt+Shift+P)", startLearner);
    GM_registerMenuCommand("Manage rules (Alt+Shift+M)", toggleManage);
    GM_registerMenuCommand("Toggle on this site (Alt+Shift+Z)", toggleSite);
    GM_registerMenuCommand("Toggle tracker cleanup here (Alt+Shift+C)", toggleCleanup);
  } catch {
  }
  installReloadDefense();
  function boot() {
    runOnce();
    startObserver();
    refreshBadge();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
