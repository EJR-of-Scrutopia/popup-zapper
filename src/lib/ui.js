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

// Bottom-right badge that opens the action menu. Consolidated to a top on/off
// toggle + three primary actions (Block / Remove paywall / Revert) + a status
// strip + Settings. See the 2026-07-08 redesign spec.
export function createControlMenu({
  enabled, hostname, open, status, showReveal,
  onToggleSite, onBlock, onRemovePaywall, onRevert, onReveal, onSettings,
}) {
  const wrap = own(tag("div", { className: PREFIX + "control" }), "control");
  wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;";

  // Monochrome zap badge: shows just the bolt, expands to the name on hover.
  // mix-blend-mode:difference renders it as the inverse of whatever is behind it,
  // so it stays legible on any background (black over light, white over dark).
  const badge = tag("button");
  badge.setAttribute("data-act", "menu");
  badge.title = enabled ? "Popup Zapper: on — click for menu" : "Popup Zapper: off — click for menu";
  // No opacity here: opacity on the same element isolates the blend and breaks it.
  // OFF state is shown by a struck-through bolt (and the title) instead.
  badge.style.cssText =
    "display:flex;align-items:center;gap:6px;border:0;background:transparent;cursor:pointer;" +
    "padding:4px 6px;color:#fff;font:bold 13px sans-serif;line-height:1;" +
    "mix-blend-mode:difference;-webkit-mix-blend-mode:difference;";

  const icon = tag("span");
  icon.style.cssText = "display:flex;flex:0 0 auto;";
  const strike = enabled ? "" : '<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5"/>';
  icon.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M7 2v11h3v9l7-12h-4l4-8z"/>' + strike + '</svg>';

  const name = tag("span", { textContent: "Popup Zapper" });
  name.style.cssText =
    "max-width:0;overflow:hidden;white-space:nowrap;opacity:0;" +
    "transition:max-width .25s ease,opacity .25s ease;";

  badge.appendChild(icon);
  badge.appendChild(name);
  badge.addEventListener("mouseenter", () => { name.style.maxWidth = "130px"; name.style.opacity = "1"; });
  badge.addEventListener("mouseleave", () => { name.style.maxWidth = "0"; name.style.opacity = "0"; });

  const menu = tag("div");
  menu.style.cssText =
    `display:${open ? "block" : "none"};position:absolute;bottom:34px;right:0;background:#fff;` +
    "color:#111;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.3);overflow:hidden;min-width:240px;";

  // Header: which site, and the top on/off switch for it.
  const header = tag("div");
  header.style.cssText = "padding:8px 12px;background:#f6f6f6;border-bottom:1px solid #e0e0e0;";
  const hRow = tag("div");
  hRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;";
  hRow.appendChild(tag("span", {
    textContent: hostname || "this site",
    style: "font-weight:bold;color:#333;word-break:break-all;",
  }));
  const toggle = tag("button", { textContent: enabled ? "On ●" : "Off ○" });
  toggle.setAttribute("data-act", "site");
  toggle.title = enabled ? "Turn off for this site" : "Turn on for this site";
  toggle.style.cssText =
    "border:0;border-radius:12px;padding:3px 10px;cursor:pointer;font-weight:bold;color:#fff;background:" +
    (enabled ? "#2e7d32" : "#b00020");
  toggle.addEventListener("click", onToggleSite);
  hRow.appendChild(toggle);
  header.appendChild(hRow);
  menu.appendChild(header);

  const item = (act, label, handler, accent) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText =
      "display:block;width:100%;text-align:left;padding:9px 12px;border:0;" +
      `background:#fff;color:${accent || "#111"};cursor:pointer;font:12px sans-serif;`;
    b.addEventListener("mouseenter", () => { b.style.background = "#f0f0f0"; });
    b.addEventListener("mouseleave", () => { b.style.background = "#fff"; });
    if (handler) b.addEventListener("click", handler);
    menu.appendChild(b);
    return b;
  };

  item("block", "◎ Block a popup", onBlock);
  item("paywall", "⇪ Remove paywall", onRemovePaywall);
  item("revert", "↩ Revert last block", onRevert);

  // Status strip: echoes the last action so it's clear something happened.
  const strip = tag("div");
  strip.setAttribute("data-pz-status", "");
  strip.style.cssText =
    "padding:7px 12px;border-top:1px solid #eee;border-bottom:1px solid #eee;" +
    "color:#555;font:11px sans-serif;min-height:16px;background:#fafafa;";
  strip.textContent = status || "Ready.";
  menu.appendChild(strip);

  // Contextual escalation: only shown when the page still looks gated.
  if (showReveal) {
    item("reveal", "🔎 Still blocked? Reveal deeper", onReveal, "#8a5a00");
  }

  item("settings", "⚙ Settings", onSettings);

  badge.addEventListener("click", () => {
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });

  wrap.appendChild(badge);
  wrap.appendChild(menu);
  return wrap;
}

// Settings panel: per-site rule list (toggle/edit/delete/promote), tracker
// cleanup toggle, and version + update check.
export function createSettingsPanel({
  library, hostname, version,
  onToggleRule, onEditRule, onDeleteRule, onPromoteRule,
  onToggleCleanup, onCheckUpdates, onShowLog, onDiagnostics, onClose,
}) {
  const panel = own(tag("div", { className: PREFIX + "settings" }), "settings");
  panel.style.cssText =
    "position:fixed;top:40px;right:12px;z-index:2147483647;background:#fff;" +
    "color:#111;padding:12px;border-radius:8px;font:13px sans-serif;" +
    "max-height:74vh;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.3);min-width:300px;max-width:92vw;";

  const head = tag("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  head.appendChild(tag("strong", { textContent: "⚙ Settings" }));
  const cls = tag("button", { textContent: "✕" });
  cls.setAttribute("data-act", "close");
  cls.style.cssText = "border:0;background:none;font-size:16px;cursor:pointer;";
  cls.addEventListener("click", onClose);
  head.appendChild(cls);
  panel.appendChild(head);

  // --- rules for this site ---
  panel.appendChild(tag("div", {
    textContent: "What's blocked on this site",
    style: "font-weight:bold;color:#333;margin:6px 0 4px;",
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
      style: "flex:1;word-break:break-all;color:" + (rule.enabled === false ? "#999" : "#111"),
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

  const globals = library.global || [];
  const dom = (library.domains || {})[hostname] || {};
  const siteRules = dom.rules || [];
  if (!globals.length && !siteRules.length) {
    panel.appendChild(tag("div", {
      textContent: "No rules yet. Use “Block a popup” to add one.",
      style: "color:#888;margin:2px 0 6px;",
    }));
  }
  for (const r of globals) addRule(r, "global");
  for (const r of siteRules) addRule(r, "site");

  // --- tracker cleanup toggle ---
  const cleanupRow = tag("label");
  cleanupRow.style.cssText =
    "display:flex;gap:6px;align-items:center;margin:10px 0 4px;border-top:1px solid #eee;padding-top:8px;";
  const cleanupCb = tag("input", { type: "checkbox", checked: dom.cleanup === true });
  cleanupCb.setAttribute("data-act", "toggle-cleanup");
  cleanupCb.addEventListener("change", () => onToggleCleanup(cleanupCb.checked));
  cleanupRow.appendChild(cleanupCb);
  cleanupRow.appendChild(tag("span", { textContent: "Delete tracking cookies/storage on this site (can log you out)" }));
  panel.appendChild(cleanupRow);

  // --- version + updates ---
  const verRow = tag("div");
  verRow.style.cssText =
    "display:flex;gap:8px;align-items:center;margin:10px 0 4px;border-top:1px solid #eee;padding-top:8px;";
  verRow.appendChild(tag("span", { textContent: `Popup Zapper v${version}`, style: "flex:1;color:#333;" }));
  const upd = tag("button", { textContent: "Check for updates" });
  upd.setAttribute("data-act", "check-updates");
  upd.addEventListener("click", onCheckUpdates);
  verRow.appendChild(upd);
  panel.appendChild(verRow);

  // --- debug tools ---
  const dbg = tag("div");
  dbg.style.cssText = "display:flex;gap:8px;margin-top:8px;";
  const logBtn = tag("button", { textContent: "📜 Activity log" });
  logBtn.setAttribute("data-act", "log");
  logBtn.addEventListener("click", onShowLog);
  dbg.appendChild(logBtn);
  if (onDiagnostics) {
    const diagBtn = tag("button", { textContent: "🔧 Copy diagnostics" });
    diagBtn.setAttribute("data-act", "diag");
    diagBtn.addEventListener("click", onDiagnostics);
    dbg.appendChild(diagBtn);
  }
  panel.appendChild(dbg);

  return panel;
}

// Small floating toolbar for the Block picker: candidate nav + tree nav + block.
export function createPickerToolbar({ onPrev, onNext, onGrow, onShrink, onBlock, onCancel }) {
  const mk = (act, label, handler, title) => {
    const b = tag("button", { textContent: label, title: title || label });
    b.setAttribute("data-act", act);
    b.style.cssText = "margin:0 3px;padding:4px 9px;font:13px sans-serif;cursor:pointer;border-radius:4px;border:0;";
    b.addEventListener("click", handler);
    return b;
  };
  const bar = own(tag("div", { className: PREFIX + "picker" }), "picker");
  bar.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#222;color:#fff;padding:8px 12px;border-radius:8px;font:13px sans-serif;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;";
  bar.appendChild(tag("span", { textContent: "Pick the popup: ", style: "margin-right:6px" }));
  bar.appendChild(mk("prev", "◀", onPrev, "Previous candidate"));
  bar.appendChild(mk("next", "▶", onNext, "Next candidate"));
  bar.appendChild(mk("grow", "▲", onGrow, "Select parent ( [ )"));
  bar.appendChild(mk("shrink", "▼", onShrink, "Select child ( ] )"));
  const applyAll = tag("label", { style: "margin:0 8px;font:12px sans-serif;" });
  const allCb = tag("input", { type: "checkbox" });
  allCb.setAttribute("data-act", "all-sites");
  applyAll.appendChild(allCb);
  applyAll.appendChild(tag("span", { textContent: " all sites" }));
  bar.appendChild(applyAll);
  bar.appendChild(mk("block", "✓ Block", () => onBlock(allCb.checked), "Block this element"));
  bar.appendChild(mk("cancel", "Cancel", onCancel));
  return bar;
}

// Panel showing generated uBlock filters + how to apply them (Freeze auth,
// offered as a secondary action from Remove paywall).
export function createFilterPanel({ filters, hosts, copied, onClose }) {
  const panel = own(tag("div", { className: PREFIX + "filters" }), "filters");
  panel.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;" +
    "background:#fff;color:#111;padding:16px;border-radius:10px;width:440px;max-width:92vw;" +
    "font:13px sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.5);";

  const head = tag("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  head.appendChild(tag("strong", { textContent: "🧊 Block this paywall permanently" }));
  const cls = tag("button", { textContent: "✕" });
  cls.setAttribute("data-act", "close");
  cls.style.cssText = "border:0;background:none;font-size:16px;cursor:pointer;";
  cls.addEventListener("click", onClose);
  head.appendChild(cls);
  panel.appendChild(head);

  panel.appendChild(tag("div", {
    textContent: `Found ${hosts.length} paywall/metering host(s) on this page${copied ? " — copied to your clipboard." : "."}`,
    style: "margin-bottom:8px;color:#333;",
  }));

  const area = tag("textarea");
  area.value = filters;
  area.readOnly = true;
  area.style.cssText = "width:100%;height:96px;font:12px monospace;box-sizing:border-box;" +
    "border:1px solid #ccc;border-radius:6px;padding:8px;resize:vertical;";
  area.addEventListener("focus", () => area.select());
  panel.appendChild(area);

  const steps = tag("ol");
  steps.style.cssText = "margin:10px 0 0 0;padding-left:20px;color:#333;line-height:1.6;";
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
  const panel = own(tag("div", { className: PREFIX + "log" }), "log");
  panel.style.cssText =
    "position:fixed;bottom:54px;right:12px;z-index:2147483647;background:#111;" +
    "color:#eee;padding:10px;border-radius:8px;font:11px/1.5 monospace;" +
    "max-height:50vh;width:340px;overflow:auto;box-shadow:0 2px 12px rgba(0,0,0,.5);";

  const head = tag("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;";
  head.appendChild(tag("strong", { textContent: "Activity", style: "color:#fff" }));
  const btns = tag("div");
  const clr = tag("button", { textContent: "Clear" });
  clr.setAttribute("data-act", "clear");
  clr.style.cssText = "margin-left:6px;cursor:pointer;font:11px monospace;";
  clr.addEventListener("click", onClear);
  const cls = tag("button", { textContent: "✕" });
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
      style: "color:#aaa",
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