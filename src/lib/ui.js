const PREFIX = "pz-";

function tag(name, props = {}, children = []) {
  const el = document.createElement(name);
  Object.assign(el, props);
  for (const c of children) el.appendChild(c);
  return el;
}

// A bottom-right badge that opens a small action menu on click. Replaces global
// hotkeys (which collide with Brave's built-in shortcuts).
export function createControlMenu({
  enabled, autozap, onLearn, onManage, onToggleAutozap, onToggleSite, onShowLog,
}) {
  const wrap = tag("div", { className: PREFIX + "control" });
  wrap.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:12px sans-serif;";

  const badge = tag("button", {
    textContent: enabled ? "⚡ Zapper" : "⚡ Zapper (off)",
    title: "Popup Zapper menu",
  });
  badge.setAttribute("data-act", "menu");
  badge.style.cssText =
    "padding:5px 10px;border:0;border-radius:6px;color:#fff;cursor:pointer;" +
    "opacity:.85;box-shadow:0 1px 4px rgba(0,0,0,.4);background:" +
    (enabled ? "#2e7d32" : "#9e9e9e");

  const menu = tag("div");
  menu.style.cssText =
    "display:none;position:absolute;bottom:34px;right:0;background:#fff;color:#111;" +
    "border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.3);overflow:hidden;min-width:200px;";

  const item = (act, label, handler) => {
    const b = tag("button", { textContent: label });
    b.setAttribute("data-act", act);
    b.style.cssText =
      "display:block;width:100%;text-align:left;padding:8px 12px;border:0;" +
      "background:#fff;color:#111;cursor:pointer;font:12px sans-serif;";
    b.addEventListener("mouseenter", () => { b.style.background = "#f0f0f0"; });
    b.addEventListener("mouseleave", () => { b.style.background = "#fff"; });
    b.addEventListener("click", handler);
    menu.appendChild(b);
    return b;
  };

  item("learn", "🎯 Learn a popup", onLearn);
  item("manage", "📋 Manage rules", onManage);
  item("autozap", autozap ? "🤖 Auto-zap: ON (this site)" : "🤖 Auto-zap: OFF (this site)", onToggleAutozap);
  item("log", "📜 Activity log", onShowLog);
  item("site", enabled ? "🚫 Disable on this site" : "✅ Enable on this site", onToggleSite);

  badge.addEventListener("click", () => {
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });

  wrap.appendChild(badge);
  wrap.appendChild(menu);
  return wrap;
}

// Live activity panel showing what the zapper did / could not do.
export function createActivityPanel({ entries, onClear, onClose }) {
  const panel = tag("div", { className: PREFIX + "log" });
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
      panel.appendChild(tag("div", { textContent: `${time}  [${e.action}] ${e.detail}` }));
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
  const bar = tag("div", { className: PREFIX + "toolbar" }, [
    tag("span", { textContent: "Popup? " }),
    mk("confirm", "✓ Yes"),
    mk("pick", "Click the right one"),
    mk("cancel", "Cancel"),
  ]);
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
  const panel = tag("div", { className: PREFIX + "panel" });
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