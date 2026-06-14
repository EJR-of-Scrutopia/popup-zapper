const PREFIX = "pz-";

function tag(name, props = {}, children = []) {
  const el = document.createElement(name);
  Object.assign(el, props);
  for (const c of children) el.appendChild(c);
  return el;
}

export function createBadge({ enabled, onToggle }) {
  const badge = tag("button", {
    className: PREFIX + "badge",
    textContent: enabled ? "Zapper: ON" : "Zapper: OFF",
    title: "Toggle Popup Zapper on this site",
  });
  badge.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:2147483647;" +
    "padding:4px 8px;font:12px sans-serif;border:0;border-radius:6px;" +
    "color:#fff;cursor:pointer;opacity:.6;background:" +
    (enabled ? "#2e7d32" : "#9e9e9e");
  badge.addEventListener("click", onToggle);
  return badge;
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