import { loadLibrary, saveLibrary } from "./lib/storage.js";
import { runBlocker } from "./lib/blocker.js";
import { createReloadGuard } from "./lib/reload-guard.js";
import { findBestGuess } from "./lib/learner.js";
import { extractKeywords } from "./lib/extract.js";
import { detectDegradation } from "./lib/restore.js";
import { createActivityLog } from "./lib/log.js";
import { collectDiagnostics } from "./lib/diagnostics.js";
import { findPaywallHosts, buildUblockFilters } from "./lib/paywall-filters.js";
import { resetMeter } from "./lib/meter.js";
import { captureSnapshot, restoreSnapshot } from "./lib/freeze.js";
import {
  createControlMenu, createActivityPanel, createLearnerToolbar, createManagePanel,
  createFilterPanel,
} from "./lib/ui.js";

const getV = (k) => GM_getValue(k);
const setV = (k, v) => GM_setValue(k, v);
const hostname = location.hostname.replace(/^www\./, "");

let library = loadLibrary(getV);
const persist = () => saveLibrary(setV, library);
const activityLog = createActivityLog();

function domainEntry() {
  return (library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} });
}

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
      activityLog.add("reload", "blocked an automatic page reload");
    };
  } catch { /* some browsers lock this; ignore */ }

  const origAssign = Location.prototype.assign;
  Location.prototype.assign = function (url) {
    if (guard.allowReload()) return origAssign.call(this, url);
    activityLog.add("reload", "blocked an automatic redirect");
  };
  const origReplace = Location.prototype.replace;
  Location.prototype.replace = function (url) {
    if (guard.allowReload()) return origReplace.call(this, url);
    activityLog.add("reload", "blocked an automatic redirect");
  };

  const stripMeta = () => {
    document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove());
  };
  document.addEventListener("DOMContentLoaded", stripMeta, { once: true });
}

// ---- blocker engine ----
function runOnce() {
  // Keep stripping meta-refresh in case it is injected after load.
  try { document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove()); } catch { /* ignore */ }
  runBlocker({ doc: document, library, hostname, log: (a, d) => activityLog.add(a, d) });
  runFreeze();
}

// Keep-content: save the fullest version, restore it if the page got gated.
// Capped so that if the site keeps re-gating we don't war with it (flashing).
let freezeRestores = 0;
const MAX_FREEZE_RESTORES = 3;
function runFreeze() {
  const dom = (library.domains || {})[hostname];
  if (!dom || !dom.freeze) return;
  try {
    captureSnapshot(document, window.sessionStorage);
    if (freezeRestores < MAX_FREEZE_RESTORES && restoreSnapshot(document, window.sessionStorage)) {
      freezeRestores++;
      if (freezeRestores >= MAX_FREEZE_RESTORES) {
        activityLog.add("keep", "stopped restoring — the page keeps re-gating (likely a navigation gate we can't beat)");
      } else {
        activityLog.add("keep", `restored saved full content (${freezeRestores}/${MAX_FREEZE_RESTORES})`);
      }
    }
  } catch { /* ignore */ }
}

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

// ---- activity log panel ----
let logPanel = null;
let logUnsub = null;
function renderLogPanel() {
  if (logPanel) logPanel.remove();
  logPanel = createActivityPanel({
    entries: activityLog.entries(),
    onClear: () => activityLog.clear(),
    onClose: () => { closeLog(); },
  });
  document.body.appendChild(logPanel);
  logPanel.scrollTop = logPanel.scrollHeight; // keep newest in view
}
function closeLog() {
  if (logUnsub) { logUnsub(); logUnsub = null; }
  if (logPanel) { logPanel.remove(); logPanel = null; }
}
function toggleLog() {
  if (logPanel) { closeLog(); return; }
  renderLogPanel();
  logUnsub = activityLog.subscribe(() => { if (logPanel) renderLogPanel(); });
}

// ---- diagnostics ----
function copyDiagnostics() {
  const report = collectDiagnostics(document);
  try {
    GM_setClipboard(report);
    alert("Popup Zapper: diagnostics copied to clipboard. Paste them to share.");
  } catch {
    // eslint-disable-next-line no-console
    console.log("[Popup Zapper diagnostics]\n" + report);
    alert("Popup Zapper: diagnostics logged to the console (press F12 to view).");
  }
}

// ---- freeze auth (generate uBlock paywall filters) ----
let filterPanel = null;
function freezeAuth() {
  const hosts = findPaywallHosts(document, window.performance);
  if (!hosts.length) {
    alert("Popup Zapper: no known paywall/metering scripts detected on this page.");
    return;
  }
  const filters = buildUblockFilters(hosts);
  let copied = false;
  try { GM_setClipboard(filters); copied = true; } catch { /* not granted */ }
  activityLog.add("freeze", `found ${hosts.length} paywall host(s): ${hosts.join(", ")}`);
  if (filterPanel) filterPanel.remove();
  filterPanel = createFilterPanel({
    filters, hosts, copied,
    onClose: () => { if (filterPanel) { filterPanel.remove(); filterPanel = null; } },
  });
  document.body.appendChild(filterPanel);
}

// ---- toggles ----
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

// One bundled switch: auto-zap + reset-meter + keep-content together.
function toggleUnlock() {
  const dom = domainEntry();
  dom.unlock = !dom.unlock;
  dom.autozap = dom.unlock;
  dom.resetMeter = dom.unlock;
  dom.freeze = dom.unlock;
  freezeRestores = 0;
  persist();
  activityLog.add("unlock", dom.unlock ? "Unlock mode ON (gates/meter/keep-content)" : "Unlock mode OFF");
  refreshControl(true);
  if (dom.unlock) maybeResetMeter();
  runOnce();
}

function saveContentNow() {
  try {
    const ok = captureSnapshot(document, window.sessionStorage, true);
    activityLog.add("keep", ok ? "saved content snapshot (manual)" : "nothing substantial to save");
    alert(ok
      ? "Popup Zapper: content saved. If the page reloads to a blocked version, use 'Restore content'."
      : "Popup Zapper: nothing substantial to save on this page yet.");
  } catch { /* ignore */ }
}

function restoreContentNow() {
  try {
    const ok = restoreSnapshot(document, window.sessionStorage, true);
    activityLog.add("keep", ok ? "restored content snapshot (manual)" : "no saved content for this page");
    alert(ok ? "Popup Zapper: restored saved content." : "Popup Zapper: no saved content for this page.");
  } catch { /* ignore */ }
}

// Wipe the gate's counter before the site's scripts read it, so this load looks
// like a fresh visit. Runs at document-start when enabled for the domain.
function maybeResetMeter() {
  const dom = (library.domains || {})[hostname];
  if (!dom || !dom.resetMeter) return;
  const cleared = resetMeter(document, window);
  if (cleared.length) activityLog.add("meter", `cleared ${cleared.length} meter key(s): ${cleared.join(", ")}`);
}

// ---- control menu ----
let control = null;
function refreshControl(open) {
  if (control) control.remove();
  const dom = (library.domains || {})[hostname];
  control = createControlMenu({
    enabled: !library.disabledDomains.includes(hostname),
    unlock: !!(dom && dom.unlock),
    hostname,
    open: !!open,
    onLearn: startLearner,
    onManage: toggleManage,
    onToggleUnlock: toggleUnlock,
    onRestoreContent: restoreContentNow,
    onToggleSite: toggleSite,
    onShowLog: toggleLog,
    onDiagnostics: copyDiagnostics,
    onFreeze: freezeAuth,
  });
  document.body.appendChild(control);
}

// ---- GM menu commands (extension-menu fallback for the on-page menu) ----
try {
  GM_registerMenuCommand("Learn a popup", startLearner);
  GM_registerMenuCommand("Manage rules", toggleManage);
  GM_registerMenuCommand("Toggle Unlock mode (this site)", toggleUnlock);
  GM_registerMenuCommand("Save content snapshot now", saveContentNow);
  GM_registerMenuCommand("Restore content snapshot", restoreContentNow);
  GM_registerMenuCommand("Show activity log", toggleLog);
  GM_registerMenuCommand("Freeze auth (block paywall via uBlock)", freezeAuth);
  GM_registerMenuCommand("Copy page diagnostics (debug)", copyDiagnostics);
  GM_registerMenuCommand("Toggle zapper (this site)", toggleSite);
} catch { /* not available in all managers */ }

// ---- boot ----
maybeResetMeter(); // wipe the gate counter at document-start, before page scripts run
installReloadDefense();
function boot() {
  runOnce();
  startObserver();
  refreshControl();
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });