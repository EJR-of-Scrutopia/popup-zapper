const PREFIX = "pz-";

function tag(name, props = {}, children = []) {
  const el = document.createElement(name);
  Object.assign(el, props);
  for (const c of children) el.appendChild(c);
  return el;
}

// Mark a root element as our own UI so the blocker/learner never act on it.
function own(el, kind) {
  el.setAttribute("data-pz", kind);
  return el;
}

// Follow the OS/browser colour scheme. Guarded because jsdom has no matchMedia.
function prefersDark() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }
  catch { return false; }
}

// Theme preference: "auto" follows the OS, "light"/"dark" force it. Set once at
// boot (and whenever the user picks from Settings) so every panel repaints to match.
let themeMode = "auto";
export function setTheme(mode) {
  themeMode = (mode === "light" || mode === "dark") ? mode : "auto";
  return themeMode;
}
export function getTheme() { return themeMode; }
function isDark() {
  if (themeMode === "dark") return true;
  if (themeMode === "light") return false;
  return prefersDark();
}

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

export function palette() {
  return isDark()
    ? {
      bg: "#1f1f22", fg: "#e8e8ea", sub: "#a2a2a8", border: "#3a3a40", hover: "#2c2c31",
      head: "#26262b", accent: "#4caf50", danger: "#ff5c5c", chip: "#2a2a30",
      chipBorder: "#5a5a62", field: "#2a2a30", shadow: "0 2px 14px rgba(0,0,0,.6)",
    }
    : {
      bg: "#ffffff", fg: "#141414", sub: "#5f5f5f", border: "#e2e2e2", hover: "#f0f0f0",
      head: "#f6f6f6", accent: "#2e7d32", danger: "#c62828", chip: "#ffffff",
      chipBorder: "#bcbcbc", field: "#ffffff", shadow: "0 2px 12px rgba(0,0,0,.28)",
    };
}

// Turn a raw (action, detail) log entry into a short, human status line.
export function formatStatus(action, detail) {
  switch (action) {
    case "popup": return "Blocked a popup";
    case "autozap": return "Removed an overlay";
    case "paywall": return "Removed a paywall veil";
    case "deblur": return "Un-blurred the page";
    case "consent": return "Dismissed a cookie banner";
    case "reload": return "Blocked an auto-reload";
    case "meter": return "Reset the paywall meter";
    case "unlock": return "Unlocked gated content";
    case "keep": return "Restored saved content";
    case "freeze": return "Found a paywall vendor to block";
    default: return detail || action;
  }
}

// Bottom-right badge that opens the action menu. Icon-only bordered chip that
// expands to the name on hover (or stays open when the menu is open), with a red
// dot when something was blocked on this page.
export function createControlMenu({
  enabled, hostname, open, status, showReveal, blocked,
  onToggleMenu, onToggleSite, onBlock, onRemovePaywall, onRevert, onReveal, onSettings,
}) {
  const t = palette();
  const wrap = own(tag("div", { className: PREFIX + "control" }), "control");
  wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;" +
    (touchMode ? "bottom:calc(12px + env(safe-area-inset-bottom));right:calc(12px + env(safe-area-inset-right));" : "");

  // Bordered chip so it's always visible on any background; theme-coloured.
  const badge = tag("button");
  badge.setAttribute("data-act", "menu");
  badge.title = enabled ? "Popup Zapper: on — click for menu" : "Popup Zapper: off — click for menu";
  badge.style.cssText =
    "position:relative;display:flex;align-items:center;gap:6px;cursor:pointer;" +
    "padding:5px 10px;border-radius:16px;font:bold 13px sans-serif;line-height:1;" +
    `background:${t.chip};color:${t.fg};border:1.5px solid ${t.chipBorder};box-shadow:${t.shadow};`;

  const icon = tag("span");
  icon.style.cssText = `display:flex;flex:0 0 auto;color:${enabled ? t.fg : t.sub};`;
  const strike = enabled ? "" : '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5"/>';
  icon.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M7 2v11h3v9l7-12h-4l4-8z"/>' + strike + "</svg>";

  const name = tag("span", { textContent: "Popup Zapper" });
  const nameOpen = open || touchMode;
  name.style.cssText =
    "overflow:hidden;white-space:nowrap;transition:max-width .25s ease,opacity .25s ease;" +
    (nameOpen ? "max-width:140px;opacity:1;" : "max-width:0;opacity:0;");

  // Red indicator: shown when the zapper actually blocked something here.
  const dot = tag("span");
  dot.setAttribute("data-pz-dot", "");
  dot.style.cssText =
    "position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;" +
    `background:${t.danger};border:1.5px solid ${t.chip};display:${blocked ? "block" : "none"};`;

  badge.appendChild(icon);
  badge.appendChild(name);
  badge.appendChild(dot);
  if (!open && !touchMode) {
    badge.addEventListener("mouseenter", () => { name.style.maxWidth = "140px"; name.style.opacity = "1"; });
    badge.addEventListener("mouseleave", () => { name.style.maxWidth = "0"; name.style.opacity = "0"; });
  }
  if (onToggleMenu) badge.addEventListener("click", onToggleMenu);

  const menu = tag("div");
  menu.style.cssText =
    `display:${open ? "block" : "none"};position:absolute;bottom:42px;right:0;` +
    `background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:8px;` +
    `box-shadow:${t.shadow};overflow:hidden;min-width:240px;`;

  // Header: which site, and the top on/off switch for it.
  const header = tag("div");
  header.style.cssText = `padding:8px 12px;background:${t.head};border-bottom:1px solid ${t.border};`;
  const hRow = tag("div");
  hRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";
  hRow.appendChild(tag("span", {
    textContent: hostname || "this site",
    style: `font-weight:bold;color:${t.fg};word-break:break-all;`,
  }));
  const toggle = tag("button", { textContent: enabled ? "On" : "Off" });
  toggle.setAttribute("data-act", "site");
  toggle.title = enabled ? "Turn off for this site" : "Turn on for this site";
  toggle.style.cssText =
    "border:0;border-radius:12px;padding:3px 10px;cursor:pointer;font-weight:bold;color:#fff;background:" +
    (enabled ? t.accent : t.danger);
  toggle.addEventListener("click", onToggleSite);
  hRow.appendChild(toggle);
  header.appendChild(hRow);
  menu.appendChild(header);

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

  item("block", "🚫  Block a popup", onBlock);
  item("paywall", "🔓  Remove paywall", onRemovePaywall);
  item("revert", "↩️  Revert last block", onRevert);

  // Status strip: echoes the last action so it's clear something happened.
  const strip = tag("div");
  strip.setAttribute("data-pz-status", "");
  strip.style.cssText =
    `padding:7px 12px;border-top:1px solid ${t.border};border-bottom:1px solid ${t.border};` +
    `color:${t.sub};font:11px sans-serif;min-height:16px;background:${t.head};`;
  strip.textContent = status || "Ready.";
  menu.appendChild(strip);

  // Contextual escalation: only shown when the page still looks gated.
  if (showReveal) {
    item("reveal", "🔍  Reveal hidden content", onReveal, isDark() ? "#e0a44a" : "#8a5a00");
  }

  item("settings", "⚙️  Settings", onSettings);

  wrap.appendChild(badge);
  wrap.appendChild(menu);
  return wrap;
}

// Settings panel: per-site rule list (toggle/edit/delete/promote), tracker
// cleanup toggle, and version + update check.
export function createSettingsPanel({
  library, hostname, version, theme, update,
  onToggleRule, onEditRule, onDeleteRule, onPromoteRule,
  onToggleCleanup, onSetTheme, onCheckUpdates, onInstallUpdate, onReloadPage, onCopyUpdate,
  onShowLog, onDiagnostics, onClose,
}) {
  const t = palette();
  const panel = own(tag("div", { className: PREFIX + "settings" }), "settings");
  panel.style.cssText =
    `position:fixed;top:40px;right:12px;z-index:2147483647;background:${t.bg};` +
    `color:${t.fg};padding:12px;border:1px solid ${t.border};border-radius:8px;font:13px sans-serif;` +
    `max-height:74vh;overflow:auto;box-shadow:${t.shadow};min-width:300px;max-width:92vw;`;

  const btn = (label, act, handler) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText =
      `border:1px solid ${t.border};background:${t.head};color:${t.fg};` +
      "border-radius:5px;padding:3px 8px;cursor:pointer;font:12px sans-serif;";
    if (handler) b.addEventListener("click", handler);
    return b;
  };

  const head = tag("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  head.appendChild(tag("strong", { textContent: "⚙ Settings" }));
  const cls = tag("button", { textContent: "✕" });
  cls.setAttribute("data-act", "close");
  cls.title = "Close";
  cls.style.cssText = `border:0;background:none;color:${t.fg};font-size:16px;line-height:1;cursor:pointer;`;
  cls.addEventListener("click", onClose);
  head.appendChild(cls);
  panel.appendChild(head);

  // --- rules for this site ---
  panel.appendChild(tag("div", {
    textContent: "What's blocked on this site",
    style: `font-weight:bold;color:${t.fg};margin:6px 0 4px;`,
  }));

  const addRule = (rule, scope) => {
    const row = tag("div");
    row.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0;";

    const cb = tag("input", { type: "checkbox", checked: rule.enabled !== false });
    cb.setAttribute("data-act", "toggle-rule");
    cb.addEventListener("change", () => onToggleRule({ rule, scope, enabled: cb.checked }));
    row.appendChild(cb);

    row.appendChild(tag("span", {
      textContent: `${rule.type} “${rule.value}” · ${scope === "global" ? "all sites" : "this site"}`,
      style: "flex:1;word-break:break-all;color:" + (rule.enabled === false ? t.sub : t.fg),
    }));

    row.appendChild(btn("Edit", "edit-rule", () => onEditRule({ rule, scope })));
    row.appendChild(btn("Delete", "delete-rule", () => onDeleteRule({ rule, scope })));
    if (scope === "site") row.appendChild(btn("Make global", "promote-rule", () => onPromoteRule({ rule })));
    panel.appendChild(row);
  };

  const globals = library.global || [];
  const dom = (library.domains || {})[hostname] || {};
  const siteRules = dom.rules || [];
  if (!globals.length && !siteRules.length) {
    panel.appendChild(tag("div", {
      textContent: "No rules yet. Use “Block a popup” to add one.",
      style: `color:${t.sub};margin:2px 0 6px;`,
    }));
  }
  for (const r of globals) addRule(r, "global");
  for (const r of siteRules) addRule(r, "site");

  // --- tracker cleanup toggle ---
  const cleanupRow = tag("label");
  cleanupRow.style.cssText =
    `display:flex;gap:6px;align-items:center;margin:10px 0 4px;border-top:1px solid ${t.border};padding-top:8px;`;
  const cleanupCb = tag("input", { type: "checkbox", checked: dom.cleanup === true });
  cleanupCb.setAttribute("data-act", "toggle-cleanup");
  cleanupCb.addEventListener("change", () => onToggleCleanup(cleanupCb.checked));
  cleanupRow.appendChild(cleanupCb);
  cleanupRow.appendChild(tag("span", { textContent: "Delete tracking cookies/storage on this site (can log you out)" }));
  panel.appendChild(cleanupRow);

  // --- appearance (theme) ---
  if (onSetTheme) {
    const themeRow = tag("div");
    themeRow.style.cssText =
      `display:flex;gap:8px;align-items:center;margin:10px 0 4px;border-top:1px solid ${t.border};padding-top:8px;`;
    themeRow.appendChild(tag("span", { textContent: "Appearance", style: `flex:1;color:${t.sub};` }));
    const seg = tag("div");
    seg.style.cssText = `display:flex;border:1px solid ${t.border};border-radius:6px;overflow:hidden;`;
    const cur = theme || "auto";
    [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].forEach(([mode, label], i) => {
      const on = cur === mode;
      const b = tag("button", { textContent: label });
      b.setAttribute("data-act", "theme-" + mode);
      b.style.cssText =
        "border:0;padding:3px 10px;cursor:pointer;font:12px sans-serif;" +
        (i ? `border-left:1px solid ${t.border};` : "") +
        (on ? `background:${t.accent};color:#fff;font-weight:bold;` : `background:${t.head};color:${t.fg};`);
      if (!on) b.addEventListener("click", () => onSetTheme(mode));
      seg.appendChild(b);
    });
    themeRow.appendChild(seg);
    panel.appendChild(themeRow);
  }

  // --- version + updates (all in-panel; no native dialogs) ---
  const u = update || { state: "idle" };
  const verRow = tag("div");
  verRow.style.cssText =
    `display:flex;gap:8px;align-items:center;margin:10px 0 4px;border-top:1px solid ${t.border};padding-top:8px;`;
  verRow.appendChild(tag("span", { textContent: `Popup Zapper v${version}`, style: `flex:1;color:${t.sub};` }));
  // Right-hand control depends on where we are in the update flow.
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
  panel.appendChild(verRow);

  // Sub-line explaining the current update state, themed (no browser popups).
  const noteText = {
    checking: "Checking for a new version…",
    current: "You're on the latest version ✓",
    error: "Couldn't check — network blocked.",
    available: `Version ${u.remote} is ready to install.`,
    opened: "Install page opened. Click Update/Reinstall there, then reload here.",
    copied: "Link copied. Open it in your userscript app (Userscripts) to reinstall the new version.",
  }[u.state];
  if (noteText) {
    panel.appendChild(tag("div", { textContent: noteText, style: `color:${t.sub};font-size:12px;margin:2px 0 4px;` }));
  }

  // --- debug tools ---
  const dbg = tag("div");
  dbg.style.cssText = "display:flex;gap:8px;margin-top:8px;";
  dbg.appendChild(btn("📜 Activity log", "log", onShowLog));
  if (onDiagnostics) dbg.appendChild(btn("🔧 Copy diagnostics", "diag", onDiagnostics));
  panel.appendChild(dbg);

  return panel;
}

// Small floating toolbar for the Block picker: candidate nav + tree nav + block.
export function createPickerToolbar({ onPrev, onNext, onGrow, onShrink, onBlock, onCancel }) {
  const t = palette();
  const mk = (act, label, handler, title, primary) => {
    const b = tag("button", { textContent: label, title: title || label });
    b.setAttribute("data-act", act);
    b.style.cssText =
      "margin:0 3px;padding:4px 9px;font:13px sans-serif;cursor:pointer;border-radius:4px;border:0;" +
      (touchMode ? "min-height:44px;min-width:44px;" : "") +
      (primary ? "background:#2e7d32;color:#fff;font-weight:bold;" : "background:#f0f0f0;color:#111;");
    b.addEventListener("click", handler);
    return b;
  };
  const bar = own(tag("div", { className: PREFIX + "picker" }), "picker");
  bar.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    `background:${t.bg};color:${t.fg};padding:8px 12px;border:1px solid ${t.border};border-radius:8px;` +
    `font:13px sans-serif;box-shadow:${t.shadow};display:flex;align-items:center;`;
  if (touchMode) bar.style.paddingTop = "calc(8px + env(safe-area-inset-top))";
  bar.appendChild(tag("span", { textContent: "Pick the popup: ", style: "margin-right:6px" }));
  bar.appendChild(mk("prev", "◀", onPrev, "Previous candidate"));
  bar.appendChild(mk("next", "▶", onNext, "Next candidate"));
  bar.appendChild(mk("grow", "▲", onGrow, "Select parent ( [ )"));
  bar.appendChild(mk("shrink", "▼", onShrink, "Select child ( ] )"));
  const applyAll = tag("label", { style: "margin:0 8px;font:12px sans-serif;display:flex;align-items:center;gap:4px;" });
  const allCb = tag("input", { type: "checkbox" });
  allCb.setAttribute("data-act", "all-sites");
  applyAll.appendChild(allCb);
  applyAll.appendChild(tag("span", { textContent: "all sites" }));
  bar.appendChild(applyAll);
  bar.appendChild(mk("block", "✓ Block", () => onBlock(allCb.checked), "Block this element", true));
  bar.appendChild(mk("cancel", "Cancel", onCancel));
  return bar;
}

// Panel showing generated uBlock filters + how to apply them (Freeze auth,
// offered as a secondary action from Remove paywall).
export function createFilterPanel({ filters, hosts, copied, onClose }) {
  const t = palette();
  const panel = own(tag("div", { className: PREFIX + "filters" }), "filters");
  panel.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;" +
    `background:${t.bg};color:${t.fg};padding:16px;border:1px solid ${t.border};border-radius:10px;` +
    `width:440px;max-width:92vw;font:13px sans-serif;box-shadow:${t.shadow};`;

  const head = tag("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  head.appendChild(tag("strong", { textContent: "🧊 Block this paywall permanently" }));
  const cls = tag("button", { textContent: "✕" });
  cls.setAttribute("data-act", "close");
  cls.title = "Close";
  cls.style.cssText = `border:0;background:none;color:${t.fg};font-size:16px;line-height:1;cursor:pointer;`;
  cls.addEventListener("click", onClose);
  head.appendChild(cls);
  panel.appendChild(head);

  panel.appendChild(tag("div", {
    textContent: `Found ${hosts.length} paywall/metering host(s) on this page${copied ? " — copied to your clipboard." : "."}`,
    style: `margin-bottom:8px;color:${t.sub};`,
  }));

  const area = tag("textarea");
  area.value = filters;
  area.readOnly = true;
  area.style.cssText = "width:100%;height:96px;font:12px monospace;box-sizing:border-box;" +
    `border:1px solid ${t.border};border-radius:6px;padding:8px;resize:vertical;background:${t.field};color:${t.fg};`;
  area.addEventListener("focus", () => area.select());
  panel.appendChild(area);

  const steps = tag("ol");
  steps.style.cssText = `margin:10px 0 0 0;padding-left:20px;color:${t.sub};line-height:1.6;`;
  for (const s of [
    "Open uBlock Origin → Dashboard (the gears icon).",
    'Go to the "My filters" tab.',
    "Paste the lines above (already copied) at the end.",
    'Click "Apply changes", then reload this page.',
  ]) steps.appendChild(tag("li", { textContent: s }));
  panel.appendChild(steps);

  return panel;
}

// Live activity panel showing what the zapper did / could not do.
export function createActivityPanel({ entries, onClear, onClose }) {
  const t = palette();
  const panel = own(tag("div", { className: PREFIX + "log" }), "log");
  panel.style.cssText =
    `position:fixed;bottom:54px;right:12px;z-index:2147483647;background:${t.bg};` +
    `color:${t.fg};padding:10px;border:1px solid ${t.border};border-radius:8px;font:11px/1.5 monospace;` +
    `max-height:50vh;width:340px;overflow:auto;box-shadow:${t.shadow};`;

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
  btns.appendChild(mkBtn("✕", "close", onClose));
  head.appendChild(btns);
  panel.appendChild(head);

  if (!entries || entries.length === 0) {
    panel.appendChild(tag("div", {
      textContent: "Nothing yet on this page. If a popup is here, use Block a popup.",
      style: `color:${t.sub}`,
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