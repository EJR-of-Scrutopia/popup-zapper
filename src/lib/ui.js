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

// A bottom-right badge that opens a small action menu on click. Replaces global
// hotkeys (which collide with Brave's built-in shortcuts).
export function createControlMenu({
  enabled, autozap, resetMeter, hostname, open,
  onLearn, onManage, onToggleAutozap, onToggleResetMeter, onToggleSite,
  onShowLog, onDiagnostics, onFreeze,
}) {
  const wrap = own(tag("div", { className: PREFIX + "control" }), "control");
  wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;";

  const badge = tag("button", {
    textContent: enabled ? "⚡ Zapper: ON" : "⚡ Zapper: OFF",
    title: "Popup Zapper menu",
  });
  badge.setAttribute("data-act", "menu");
  badge.style.cssText =
    "padding:5px 10px;border:0;border-radius:6px;color:#fff;cursor:pointer;" +
    "opacity:.9;box-shadow:0 1px 4px rgba(0,0,0,.4);font-weight:bold;background:" +
    (enabled ? "#2e7d32" : "#b00020");

  const menu = tag("div");
  menu.style.cssText =
    `display:${open ? "block" : "none"};position:absolute;bottom:34px;right:0;background:#fff;` +
    "color:#111;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.3);overflow:hidden;min-width:240px;";

  // Header: which site, and whether the zapper is running here.
  const header = tag("div");
  header.style.cssText = "padding:8px 12px;background:#f6f6f6;border-bottom:1px solid #e0e0e0;";
  header.appendChild(tag("div", {
    textContent: hostname || "this site",
    style: "font-weight:bold;color:#333;word-break:break-all;",
  }));
  header.appendChild(tag("div", {
    textContent: enabled ? "● Running on this site" : "○ Turned off on this site",
    style: `color:${enabled ? "#2e7d32" : "#b00020"};margin-top:2px;`,
  }));
  menu.appendChild(header);

  const item = (act, label, handler, accent) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText =
      "display:block;width:100%;text-align:left;padding:9px 12px;border:0;" +
      `background:#fff;color:${accent || "#111"};cursor:pointer;font:12px sans-serif;`;
    b.addEventListener("mouseenter", () => { b.style.background = "#f0f0f0"; });
    b.addEventListener("mouseleave", () => { b.style.background = "#fff"; });
    b.addEventListener("click", handler);
    menu.appendChild(b);
    return b;
  };

  // The on/off switch for this site, worded as the action it performs.
  item(
    "site",
    enabled ? "🔴 Turn OFF for this site" : "🟢 Turn ON for this site",
    onToggleSite,
    enabled ? "#b00020" : "#2e7d32",
  );
  item(
    "autozap",
    `🤖 Auto-zap: ${autozap ? "ON" : "OFF"}  —  tap to turn ${autozap ? "off" : "on"}`,
    onToggleAutozap,
  );
  if (onToggleResetMeter) {
    item("meter", `🍪 Reset meter: ${resetMeter ? "ON" : "OFF"}  —  tap to turn ${resetMeter ? "off" : "on"}`, onToggleResetMeter);
  }
  if (onFreeze) item("freeze", "🧊 Freeze auth (block paywall)", onFreeze);
  item("learn", "🎯 Learn a popup", onLearn);
  item("manage", "📋 Manage rules", onManage);
  item("log", "📜 Activity log", onShowLog);
  if (onDiagnostics) item("diag", "🔧 Copy diagnostics (debug)", onDiagnostics);

  badge.addEventListener("click", () => {
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });

  wrap.appendChild(badge);
  wrap.appendChild(menu);
  return wrap;
}

// Panel showing generated uBlock filters + how to apply them (Freeze auth).
export function createFilterPanel({ filters, hosts, copied, onClose }) {
  const panel = own(tag("div", { className: PREFIX + "filters" }), "filters");
  panel.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;" +
    "background:#fff;color:#111;padding:16px;border-radius:10px;width:440px;max-width:92vw;" +
    "font:13px sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.5);";

  const head = tag("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  head.appendChild(tag("strong", { textContent: "🧊 Freeze auth — block this paywall" }));
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
      textContent: "Nothing yet on this page. If a popup is here, use Learn a popup or turn on Auto-zap.",
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

export function createLearnerToolbar({ onConfirm, onPick, onCancel }) {
  const mk = (act, label) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText = "margin:0 4px;padding:4px 8px;font:12px sans-serif;cursor:pointer;";
    return b;
  };
  const bar = own(tag("div", { className: PREFIX + "toolbar" }, [
    tag("span", { textContent: "Popup? " }),
    mk("confirm", "✓ Yes"),
    mk("pick", "Click the right one"),
    mk("cancel", "Cancel"),
  ]), "toolbar");
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
  const panel = own(tag("div", { className: PREFIX + "panel" }), "panel");
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