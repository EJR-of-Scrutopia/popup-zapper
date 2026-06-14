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