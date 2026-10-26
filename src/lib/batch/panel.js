// The batch clicker's panel, drawn in the zapper's own style: themed header,
// compact controls, and a status strip with the details folded away.

import { palette, getTouch, tag, own } from "../ui.js";

// A page's own styles reach the panel, and one page's padding cropped "10"
// to "1" in a number box; each box sets its own size, marked important.
export function numberStyle(width, t = palette()) {
  return [`width:${width}px`, "min-width:0", "max-width:none", "height:auto", "box-sizing:border-box",
    "padding:2px 4px", "margin:0", "font:12px/1.3 sans-serif", `color:${t.fg}`, `background:${t.field}`,
    `border:1px solid ${t.border}`, "border-radius:4px", "text-align:left"]
    .map((rule) => rule + " !important").join(";");
}

// What pages most often restyle on every button (capitals, spacing, sizes),
// set inline so a stylesheet's rule cannot reach the panel's own.
const RESET = "text-transform:none;letter-spacing:normal;line-height:1.3;margin:0;width:auto;height:auto;" +
  "box-shadow:none;text-shadow:none;float:none;text-align:center;vertical-align:middle;";

function button(t, act, label, handler, title) {
  const b = tag("button", { textContent: label, type: "button" });
  b.setAttribute("data-act", act);
  if (title) b.title = title;
  b.style.cssText =
    `border:1px solid ${t.border};background:${t.head};color:${t.fg};border-radius:5px;` +
    RESET + "padding:3px 8px;cursor:pointer;font:12px sans-serif;box-sizing:border-box;" +
    (getTouch() ? "min-height:40px;" : "");
  if (handler) b.addEventListener("click", handler);
  return b;
}

function row(gap = 6) {
  const r = tag("div");
  r.style.cssText = `display:flex;flex-wrap:wrap;gap:${gap}px;align-items:center;`;
  return r;
}

function numberField(t, act, label, value, width, handler) {
  const wrap = tag("label");
  wrap.style.cssText = `display:flex;align-items:center;gap:4px;color:${t.sub};`;
  wrap.appendChild(tag("span", { textContent: label }));
  const input = tag("input", { type: "number", min: "1", value: String(value) });
  input.setAttribute("data-act", act);
  input.style.cssText = numberStyle(width, t);
  if (handler) input.addEventListener("change", () => handler(input.value));
  wrap.appendChild(input);
  return { wrap, input };
}

// A row of joined buttons, the current one lit; the others call onPick.
function segmented(t, act, options, current, onPick) {
  const seg = tag("div");
  seg.style.cssText = `display:flex;align-self:flex-start;border:1px solid ${t.border};border-radius:6px;overflow:hidden;`;
  options.forEach(([value, label, title], i) => {
    const on = current === value;
    const b = tag("button", { textContent: label, type: "button" });
    b.setAttribute("data-act", act + "-" + value);
    if (title) b.title = title;
    b.style.cssText = RESET + "border:0;padding:3px 10px;cursor:pointer;font:11px sans-serif;" +
      (i ? `border-left:1px solid ${t.border};` : "") +
      (on ? `background:${t.accent};color:#fff;font-weight:bold;` : `background:${t.head};color:${t.fg};`);
    if (!on && onPick) b.addEventListener("click", () => onPick(value));
    seg.appendChild(b);
  });
  return seg;
}

export function chipStyle(on, t = palette()) {
  return RESET + "padding:1px 8px;border-radius:10px;cursor:pointer;font:11px/1.6 sans-serif;" +
    (on ? `background:${t.accent};color:#fff;border:1px solid ${t.accent};`
      : `background:${t.chip};color:${t.sub};border:1px solid ${t.chipBorder};text-decoration:line-through;`);
}

export function createBatchPanel({
  mode = "tick", kind = null, variant = null, batchSize = 10, startAt = 1, limit = 50, position = null,
  onClose, onPlay, onStop, onReset, onPickItem, onForgetItem, onPickButton, onSelectAll,
  onSize, onStart, onLimit, onType, onKind, onSteps, onVariant, onRefine,
}) {
  const t = palette();
  const panel = own(tag("div", { className: "pz-batch" }), "batch");
  panel.style.cssText =
    "position:fixed;z-index:2147483647;width:300px;max-width:calc(100vw - 24px);box-sizing:border-box;" +
    `background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:8px;` +
    `font:12px sans-serif;box-shadow:${t.shadow};overflow:hidden;text-align:left;` +
    (position ? `left:${position.left}px;top:${position.top}px;` : "right:12px;bottom:54px;");

  // Header: title, mode, close. Dragging it moves the panel.
  const head = tag("div");
  head.setAttribute("data-pz-drag", "");
  head.style.cssText =
    `display:flex;align-items:center;gap:8px;padding:8px 12px;background:${t.head};` +
    `border-bottom:1px solid ${t.border};cursor:move;user-select:none;`;
  head.appendChild(tag("strong", { textContent: "☑ Batch clicker", style: `color:${t.fg};` }));
  const modeLabel = tag("span", {
    textContent: mode === "click" ? "click each" : "tick & download",
    style: `flex:1;color:${t.sub};font-size:11px;`,
  });
  modeLabel.setAttribute("data-pz-mode", "");
  head.appendChild(modeLabel);
  const cls = tag("button", { textContent: "✕", type: "button", title: "Close" });
  cls.setAttribute("data-act", "batch-close");
  cls.style.cssText = RESET + `border:0;background:none;color:${t.fg};font-size:15px;line-height:1;cursor:pointer;padding:0 2px;`;
  if (onClose) cls.addEventListener("click", onClose);
  head.appendChild(cls);
  panel.appendChild(head);

  const body = tag("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;";
  panel.appendChild(body);

  // Play / Stop / Reset.
  const controls = row();
  const play = tag("button", { textContent: "▶ Play", type: "button" });
  play.setAttribute("data-act", "batch-play");
  play.style.cssText = RESET +
    "border:0;border-radius:12px;padding:4px 14px;cursor:pointer;font:bold 12px sans-serif;" +
    `color:#fff;background:${t.accent};min-width:76px;` + (getTouch() ? "min-height:40px;" : "");
  if (onPlay) play.addEventListener("click", onPlay);
  controls.appendChild(play);
  controls.appendChild(button(t, "batch-stop", "■ Stop", onStop, "Stop, and save the list"));
  const reset = button(t, "batch-reset", "↺ Reset", onReset, "Forget what this site's ledger holds");
  controls.appendChild(reset);
  body.appendChild(controls);

  // Numbers.
  const numbers = row(10);
  let size = null;
  let start = null;
  let cap = null;
  if (mode === "click") {
    cap = numberField(t, "batch-limit", "Stop after", limit, 64, onLimit);
    cap.wrap.title = "Stop once this many are added (or the site's own zip count reaches it)";
    numbers.appendChild(cap.wrap);
  } else {
    size = numberField(t, "batch-size", "Batch", batchSize, 52, onSize);
    start = numberField(t, "batch-start", "Start at row", startAt, 64, onStart);
    numbers.appendChild(size.wrap);
    numbers.appendChild(start.wrap);
  }
  body.appendChild(numbers);

  // File type switches (tick mode, drawn from the rows).
  const types = row(4);
  types.setAttribute("data-pz-types", "");
  types.style.display = "none";
  if (onType) {
    types.addEventListener("click", (event) => {
      const chip = event.target && event.target.closest ? event.target.closest("[data-type]") : null;
      if (chip) onType(chip.getAttribute("data-type"));
    });
  }
  body.appendChild(types);

  // Teaching: the item to click many of, the download button, Select all.
  const teach = row();
  const pickItem = button(t, "batch-pick-item", "☐ Pick item", onPickItem,
    "Click one of the things you want clicked many times: a checkbox or a button");
  teach.appendChild(pickItem);
  const forget = button(t, "batch-forget-item", "✕", onForgetItem, "Forget the picked item; find items automatically");
  forget.style.padding = "3px 6px";
  forget.style.display = "none";
  teach.appendChild(forget);
  let pickButton = null;
  let selectAll = null;
  if (mode !== "click") {
    pickButton = button(t, "batch-pick-button", "⬇ Download button", onPickButton,
      "Click the page's own download button, so Play presses that one");
    teach.appendChild(pickButton);
    selectAll = button(t, "batch-select-all", "Select all", onSelectAll,
      "Tick every row a run would take, and leave the download to you");
    teach.appendChild(selectAll);
  }
  teach.appendChild(button(t, "batch-steps", "⏺ Steps", onSteps,
    "Open the step recorder: do one item by hand, then repeat it for every item"));
  body.appendChild(teach);

  // A picked item may be ticked in batches or clicked each once; the guess
  // from what was clicked can be put right here.
  if (kind) {
    body.appendChild(segmented(t, "batch-kind", [
      ["box", "Tick in batches", "Tick these in batches and press the page's download button"],
      ["button", "Click each", "Press each of these once, page by page"],
    ], kind, onKind));
  }

  // Which of the look-alikes: only the picked one's kind (a PDF icon, not the
  // DWG beside it), or every one alike; Refine puts the kind right by clicks.
  let refine = null;
  if (variant) {
    const line = row();
    if (variant.all > variant.kind || !variant.on) {
      line.appendChild(segmented(t, "batch-variant", [
        ["kind", `This kind ${variant.kind}`, "Only those like the one you picked (outlined green)"],
        ["all", `All alike ${variant.all}`, "Every look-alike, whatever its icon or label"],
      ], variant.on ? "kind" : "all", (value) => onVariant && onVariant(value === "kind")));
    }
    refine = button(t, "batch-refine", "✎ Refine", onRefine,
      "Then click a green one to leave its kind out, or an unmarked look-alike to take its kind in");
    line.appendChild(refine);
    body.appendChild(line);
  }

  // Strip: counts, status, and details folded away.
  const strip = tag("div");
  strip.style.cssText =
    `padding:7px 12px;border-top:1px solid ${t.border};background:${t.head};` +
    "display:flex;flex-direction:column;gap:3px;";
  const counts = tag("div", { style: `color:${t.fg};font:11px sans-serif;min-height:14px;` });
  counts.setAttribute("data-pz-counts", "");
  const status = tag("div", { textContent: "Ready.", style: `color:${t.sub};font:11px sans-serif;min-height:14px;` });
  status.setAttribute("data-pz-status", "");
  const more = tag("button", { textContent: "Details ▸", type: "button" });
  more.setAttribute("data-act", "batch-details");
  more.style.cssText = RESET + `display:none;align-self:flex-start;border:0;background:none;padding:0;cursor:pointer;color:${t.sub};font:11px sans-serif;text-decoration:underline;`;
  const box = tag("pre");
  box.setAttribute("data-pz-details", "");
  box.style.cssText =
    `display:none;margin:2px 0 0;max-height:160px;overflow:auto;padding:5px 6px;white-space:pre-wrap;` +
    `background:${t.field};color:${t.fg};border:1px solid ${t.border};border-radius:4px;font:10.5px/1.4 ui-monospace,Consolas,monospace;`;
  more.addEventListener("click", () => {
    const open = box.style.display === "none";
    box.style.display = open ? "block" : "none";
    more.textContent = open ? "Details ▾" : "Details ▸";
  });
  strip.appendChild(counts);
  strip.appendChild(status);
  strip.appendChild(more);
  strip.appendChild(box);
  panel.appendChild(strip);

  const view = {
    el: panel,
    mode,
    head,
    inputs: { size: size && size.input, start: start && start.input, limit: cap && cap.input },
    // The button names what pressing it does next.
    setPlay(state) {
      if (mode === "click") {
        play.textContent = state === "running" ? "⏳ Clicking…" : "▶ Play";
        return;
      }
      play.textContent = state === "running" ? "⏸ Pause" : state === "pausing" ? "▶ Resume"
        : state === "stopping" ? "Stopping…" : "▶ Play";
    },
    setStatus(text) { status.textContent = text || ""; },
    setCounts(text) { counts.textContent = text || ""; },
    // Folded away unless there is something to show; a report the person
    // should see opens itself.
    setDetails(text, openIt = false) {
      box.textContent = text || "";
      more.style.display = text ? "block" : "none";
      if (!text || openIt) {
        box.style.display = text && openIt ? "block" : "none";
        more.textContent = text && openIt ? "Details ▾" : "Details ▸";
      }
    },
    setTypes(list) {
      types.textContent = "";
      types.style.display = list.length ? "flex" : "none";
      if (!list.length) return;
      types.appendChild(tag("span", { textContent: "Types", style: `color:${t.sub};margin-right:2px;` }));
      for (const each of list) {
        const chip = tag("button", { textContent: `${each.format} ${each.rows}`, type: "button" });
        chip.setAttribute("data-type", each.format);
        chip.setAttribute("aria-pressed", each.on ? "true" : "false");
        chip.title = (each.on ? "Fetched" : "Left alone") + ". Click to switch " + (each.on ? "off." : "on.");
        chip.style.cssText = chipStyle(each.on, t);
        types.appendChild(chip);
      }
    },
    setSelectAll(label) { if (selectAll) selectAll.textContent = label; },
    setPickItem(label, learned) {
      pickItem.textContent = label;
      forget.style.display = learned ? "inline-block" : "none";
    },
    setPickButton(label) { if (pickButton) pickButton.textContent = label; },
    setReset(label) { reset.textContent = label; },
    setRefine(label) { if (refine) refine.textContent = label; },
  };
  return view;
}

// Drag the panel by its header; returns the new spot through onMoved.
export function makeDraggable(panel, handle, onMoved) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target && event.target.closest && event.target.closest("button"))) return;
    const box = panel.getBoundingClientRect();
    const dx = event.clientX - box.left;
    const dy = event.clientY - box.top;
    const move = (e) => {
      const left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dx));
      const top = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - dy));
      panel.style.left = left + "px";
      panel.style.top = top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      const now = panel.getBoundingClientRect();
      if (onMoved) onMoved({ left: Math.round(now.left), top: Math.round(now.top) });
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    event.preventDefault();
  });
}
