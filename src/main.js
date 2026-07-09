import { loadLibrary, saveLibrary } from "./lib/storage.js";
import { runBlocker } from "./lib/blocker.js";
import { createReloadGuard } from "./lib/reload-guard.js";
import { extractKeywords } from "./lib/extract.js";
import { createActivityLog } from "./lib/log.js";
import { collectDiagnostics } from "./lib/diagnostics.js";
import { findPaywallHosts, buildUblockFilters } from "./lib/paywall-filters.js";
import { resetMeter } from "./lib/meter.js";
import { captureSnapshot } from "./lib/freeze.js";
import { extractCleanContent, buildCleanDocument } from "./lib/cleanfetch.js";
import { createPicker } from "./lib/picker.js";
import { createUndoStack } from "./lib/undo.js";
import { revealDeep, hasResidualGating } from "./lib/reveal.js";
import { parseVersion, updatePlan } from "./lib/updates.js";
import {
  createControlMenu, createSettingsPanel, createPickerToolbar,
  createActivityPanel, createFilterPanel, formatStatus,
  setTheme, getTheme,
} from "./lib/ui.js";

const getV = (k) => GM_getValue(k);
const setV = (k, v) => GM_setValue(k, v);
const hostname = location.hostname.replace(/^www\./, "");
const RAW_URL = "https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js";
const VERSION = (typeof GM_info !== "undefined" && GM_info && GM_info.script)
  ? GM_info.script.version : "0.0.0";

let library = loadLibrary(getV);
const persist = () => saveLibrary(setV, library);

// Appearance preference (global, not per-site): "auto" | "light" | "dark".
const THEME_KEY = "pz-theme";
setTheme(getV(THEME_KEY) || "auto");
const activityLog = createActivityLog();
const undo = createUndoStack();

function domainEntry() {
  return (library.domains[hostname] = library.domains[hostname] || { rules: [], restore: {} });
}

function describeEl(el) {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList && el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

// ---- status strip + blocked indicator ----
// The badge menu shows the last thing the zapper did, so it's clear something
// happened. Updated in place (no menu reopen) and also mirrored from the log.
let lastStatus = "Ready.";
function setStatus(msg) {
  lastStatus = msg;
  const strip = control && control.querySelector("[data-pz-status]");
  if (strip) strip.textContent = msg;
}

// The red dot appears once the zapper has actually removed a popup/overlay/gate
// on this page (not for ambient things like cookie-reject or de-blur alone).
const BLOCK_ACTIONS = new Set(["popup", "autozap", "paywall", "unlock"]);
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

// ---- reload-trap defense (always on; install before page scripts run) ----
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

// ---- blocker engine (always-on safe pass) ----
function runOnce() {
  // Keep stripping meta-refresh in case it is injected after load.
  try { document.querySelectorAll("meta[http-equiv='refresh' i]").forEach((m) => m.remove()); } catch { /* ignore */ }
  runBlocker({ doc: document, library, hostname, log: (a, d) => activityLog.add(a, d) });
}

function startObserver() {
  let pending = false;
  const obs = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; runOnce(); });
  });
  // Watch attribute changes too: metering gates (e.g. ArchDaily's Piano) apply
  // blur/veil by toggling a class or inline style on an existing element — no
  // node is inserted — so a childList-only observer would never re-run the
  // de-blur pass. The rAF debounce above coalesces the extra callbacks.
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });
}

// ---- Block: pick a popup (ranked candidates + DOM tree cycling) ----
let blockActive = false;
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
    if (e.key === "[") { e.preventDefault(); picker.grow(); highlight(); }
    else if (e.key === "]") { e.preventDefault(); picker.shrink(); highlight(); }
    else if (e.key === "Escape") { cleanup(); }
  };

  const cleanup = () => {
    blockActive = false;
    if (outlined) outlined.style.outline = "";
    bar.remove();
    document.removeEventListener("keydown", onKey, true);
  };

  const doBlock = (allSites) => {
    const el = picker.current();
    if (!el || el === document.body) { setStatus("Nothing selected to block"); return cleanup(); }
    const kws = extractKeywords(el);
    const rule = kws[0] ? { ...kws[0], enabled: true } : null;
    let ruleRef = null;
    if (rule) {
      const list = allSites ? library.global : domainEntry().rules;
      list.push(rule);
      ruleRef = { list, rule };
    }
    if (outlined) { outlined.style.outline = ""; outlined = null; }
    undo.record(el, ruleRef);
    try { el.remove(); } catch { /* ignore */ }
    persist();
    setStatus(rule
      ? `✓ Blocked ${describeEl(el)} (${allSites ? "all sites" : "this site"})`
      : `✓ Removed ${describeEl(el)} (no rule saved)`);
    runOnce();
    cleanup();
  };

  const bar = createPickerToolbar({
    onPrev: () => { picker.prevCandidate(); highlight(); },
    onNext: () => { picker.nextCandidate(); highlight(); },
    onGrow: () => { picker.grow(); highlight(); },
    onShrink: () => { picker.shrink(); highlight(); },
    onBlock: doBlock,
    onCancel: cleanup,
  });
  document.body.appendChild(bar);
  document.addEventListener("keydown", onKey, true);
  highlight();
}

// ---- Revert: undo the last Block ----
function doRevert() {
  const ok = undo.revertLast();
  persist();
  setStatus(ok ? "↩ Reverted last block" : "Nothing to revert");
  refreshControl();
}

// ---- Reveal (deeper): aggressive restore, on demand only ----
function doReveal() {
  const n = revealDeep(document, (el) => !!(el.closest && el.closest("[data-pz]")));
  setStatus(n ? `🔎 Revealed content (${n} change(s))` : "Nothing more to reveal");
  refreshControl();
}

// ---- Remove paywall: un-gate in place, then open a clean copy in a new tab ----
let filterPanel = null;
function closeFilterPanel() { if (filterPanel) { filterPanel.remove(); filterPanel = null; } }
function offerFreeze() {
  const hosts = findPaywallHosts(document, window.performance);
  if (!hosts.length) { setStatus("No known paywall vendor detected to block"); return; }
  const filters = buildUblockFilters(hosts);
  let copied = false;
  try { GM_setClipboard(filters); copied = true; } catch { /* not granted */ }
  closeFilterPanel();
  filterPanel = createFilterPanel({ filters, hosts, copied, onClose: closeFilterPanel });
  document.body.appendChild(filterPanel);
}

function doRemovePaywall() {
  // 1. wipe the meter, un-gate in place, snapshot the current (fullest) content.
  try {
    const cleared = resetMeter(document, window);
    if (cleared.length) activityLog.add("meter", `cleared ${cleared.length} meter key(s): ${cleared.join(", ")}`);
  } catch { /* ignore */ }
  runOnce();
  try { captureSnapshot(document, window.sessionStorage); } catch { /* ignore */ }

  // 2. re-download cookie-free and open the clean copy in a NEW tab.
  if (typeof GM_xmlhttpRequest !== "function") {
    setStatus("Remove paywall: fetch unavailable in this manager");
    return;
  }
  setStatus("Fetching a clean, cookie-free copy…");
  GM_xmlhttpRequest({
    method: "GET",
    url: location.href,
    anonymous: true,
    headers: { "Cache-Control": "no-cache" },
    onload: (res) => {
      try {
        const extracted = extractCleanContent(res.responseText);
        if (!extracted || extracted.len < 400) {
          setStatus("Clean copy was also gated (server-side). Offering permanent block…");
          offerFreeze();
          return;
        }
        const html = buildCleanDocument(res.responseText, location.href);
        if (!html) { setStatus("Couldn't build the clean copy"); return; }
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        const w = window.open(url, "_blank");
        if (!w) window.location.href = url; // popup blocked — replace instead
        setStatus(`✓ Opened clean copy (${extracted.len} chars) in a new tab`);
      } catch { setStatus("Error building clean copy"); }
    },
    onerror: () => { setStatus("Clean fetch failed; offering permanent block…"); offerFreeze(); },
  });
}

// ---- update check ----
// A userscript can't install itself; only the userscript manager can. When a
// newer version exists we open the raw .user.js URL, which Tampermonkey/
// Violentmonkey intercept to show their native install/update page. The whole
// flow lives in the Settings panel (state below) so there are no browser popups.
function openInstallPage() {
  if (typeof GM_openInTab === "function") { GM_openInTab(RAW_URL, { active: true }); return; }
  const w = window.open(RAW_URL, "_blank");
  if (!w) window.location.href = RAW_URL; // popup blocked — navigate instead
}

// idle | checking | current | available | error | opened
let updateState = { state: "idle" };
function setUpdateState(next) {
  updateState = next;
  if (settingsPanel) reopenSettings();
}

function checkUpdates() {
  if (typeof GM_xmlhttpRequest !== "function") {
    setUpdateState({ state: "error" });
    return;
  }
  setUpdateState({ state: "checking" });
  const decide = (remote) => {
    const plan = updatePlan(VERSION, remote);
    if (plan.action === "install") setUpdateState({ state: "available", remote: plan.remote });
    else if (plan.action === "error") setUpdateState({ state: "error" });
    else setUpdateState({ state: "current" });
  };
  GM_xmlhttpRequest({
    method: "GET",
    url: RAW_URL + "?t=" + Date.now(), // cache-bust GitHub raw
    onload: (res) => decide(parseVersion(res.responseText)),
    onerror: () => decide(null),
  });
}

function installUpdate() {
  openInstallPage();
  setUpdateState({ state: "opened", remote: updateState.remote });
}
function reloadPage() { location.reload(); }

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

// ---- settings panel ----
let settingsPanel = null;
function closeSettings() { if (settingsPanel) { settingsPanel.remove(); settingsPanel = null; } }
function openSettings() {
  settingsPanel = createSettingsPanel({
    library, hostname, version: VERSION, theme: getTheme(),
    onToggleRule: ({ rule, enabled }) => { rule.enabled = enabled; persist(); runOnce(); reopenSettings(); },
    onEditRule: ({ rule }) => {
      const next = prompt(`Edit rule value (matched by ${rule.type}):`, rule.value);
      if (next != null && next.trim()) { rule.value = next.trim(); persist(); runOnce(); reopenSettings(); }
    },
    onDeleteRule: ({ rule, scope }) => {
      if (scope === "global") library.global = library.global.filter((r) => r !== rule);
      else { const dom = library.domains[hostname]; if (dom) dom.rules = dom.rules.filter((r) => r !== rule); }
      persist(); runOnce(); reopenSettings();
    },
    onPromoteRule: ({ rule }) => {
      const dom = library.domains[hostname];
      if (dom) dom.rules = dom.rules.filter((r) => r !== rule);
      library.global.push(rule); persist(); reopenSettings();
    },
    onToggleCleanup: (on) => { domainEntry().cleanup = on; persist(); if (on) runOnce(); },
    onSetTheme: (mode) => { setV(THEME_KEY, setTheme(mode)); repaint(); },
    update: updateState,
    onCheckUpdates: checkUpdates,
    onInstallUpdate: installUpdate,
    onReloadPage: reloadPage,
    onShowLog: toggleLog,
    onDiagnostics: copyDiagnostics,
    onClose: closeSettings,
  });
  document.body.appendChild(settingsPanel);
}
function reopenSettings() { closeSettings(); openSettings(); }
function toggleSettings() { if (settingsPanel) closeSettings(); else openSettings(); }

// ---- site on/off ----
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

// ---- control menu ----
let control = null;
let menuOpen = false;
function safeResidual() { try { return hasResidualGating(document); } catch { return false; } }
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
  });
  document.body.appendChild(control);
}

// Clicking the badge toggles the menu open/closed. Closing it also dismisses any
// panels it spawned (settings, activity log, paywall filters), so one click tidies
// everything away.
function toggleMenu() {
  menuOpen = !menuOpen;
  if (!menuOpen) { closeSettings(); closeLog(); closeFilterPanel(); }
  refreshControl();
}

// Re-render every open piece of UI so a theme change takes effect at once.
function repaint() {
  refreshControl();
  if (settingsPanel) reopenSettings();
  if (logPanel) renderLogPanel();
}

// ---- GM menu commands (extension-menu fallback for the on-page menu) ----
try {
  GM_registerMenuCommand("Block a popup", startBlock);
  GM_registerMenuCommand("Remove paywall", doRemovePaywall);
  GM_registerMenuCommand("Revert last block", doRevert);
  GM_registerMenuCommand("Reveal deeper (this page)", doReveal);
  GM_registerMenuCommand("Settings", toggleSettings);
  GM_registerMenuCommand("Toggle zapper (this site)", toggleSite);
} catch { /* not available in all managers */ }

// ---- boot ----
installReloadDefense();
function boot() {
  runOnce();
  startObserver();
  refreshControl();
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });