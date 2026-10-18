// The step recorder's panel, in the batch clicker's style: themed header,
// compact controls, the steps as a list to edit, and a status strip with the
// details folded away.

import { palette, getTouch, tag, own } from "../ui.js";
import { numberStyle } from "../batch/panel.js";

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

function field(t, act, label, type, width, title, handler) {
  const wrap = tag("label");
  wrap.style.cssText = `display:flex;align-items:center;gap:4px;color:${t.sub};`;
  if (title) wrap.title = title;
  wrap.appendChild(tag("span", { textContent: label }));
  const input = tag("input", { type });
  if (type === "number") input.min = "0";
  input.setAttribute("data-act", act);
  input.style.cssText = numberStyle(width, t);
  if (handler) input.addEventListener("change", () => handler(input.value));
  wrap.appendChild(input);
  return { wrap, input };
}

export function createRecorderPanel({
  position = null, onClose, onRecord, onPlay, onStop, onReset, onBack, onExport,
  onSelectStep, onRemoveStep, onWaitSeconds, onAddWait, onAddCheck,
  onSkipText, onOnlyText, onHighlight, onPages, onTimeout,
}) {
  const t = palette();
  const panel = own(tag("div", { className: "pz-recorder" }), "recorder");
  panel.style.cssText =
    "position:fixed;z-index:2147483647;width:320px;max-width:calc(100vw - 24px);box-sizing:border-box;" +
    `background:${t.bg};color:${t.fg};border:1px solid ${t.border};border-radius:8px;` +
    `font:12px sans-serif;box-shadow:${t.shadow};overflow:hidden;text-align:left;` +
    (position ? `left:${position.left}px;top:${position.top}px;` : "left:12px;bottom:54px;");

  const head = tag("div");
  head.setAttribute("data-pz-drag", "");
  head.style.cssText =
    `display:flex;align-items:center;gap:8px;padding:8px 12px;background:${t.head};` +
    `border-bottom:1px solid ${t.border};cursor:move;user-select:none;`;
  head.appendChild(tag("strong", { textContent: "⏺ Step recorder", style: `flex:1;color:${t.fg};` }));
  const cls = tag("button", { textContent: "✕", type: "button", title: "Close" });
  cls.setAttribute("data-act", "rec-close");
  cls.style.cssText = RESET + `border:0;background:none;color:${t.fg};font-size:15px;line-height:1;cursor:pointer;padding:0 2px;`;
  if (onClose) cls.addEventListener("click", onClose);
  head.appendChild(cls);
  panel.appendChild(head);

  const body = tag("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px 12px;";
  panel.appendChild(body);

  // Record / Play / Stop / Reset.
  const controls = row();
  const record = button(t, "rec-record", "⏺ Record", onRecord, "Do one item by hand while this watches");
  controls.appendChild(record);
  const play = tag("button", { textContent: "▶ Play", type: "button" });
  play.setAttribute("data-act", "rec-play");
  play.style.cssText = RESET +
    "border:0;border-radius:12px;padding:4px 14px;cursor:pointer;font:bold 12px sans-serif;" +
    `color:#fff;background:${t.accent};min-width:76px;` + (getTouch() ? "min-height:40px;" : "");
  if (onPlay) play.addEventListener("click", onPlay);
  controls.appendChild(play);
  controls.appendChild(button(t, "rec-stop", "■ Stop", onStop, "Stop the run and close the tabs it opened"));
  const reset = button(t, "rec-reset", "↺ Reset", onReset, "Forget which items are done on this site");
  controls.appendChild(reset);
  controls.appendChild(button(t, "rec-back", "↶ Back one", onBack,
    "Have the last item marked done or skipped done again at the next Play; press again for the one before"));
  body.appendChild(controls);

  // The steps.
  const list = tag("div");
  list.setAttribute("data-pz-steps", "");
  list.style.cssText = `display:flex;flex-direction:column;gap:2px;max-height:180px;overflow:auto;` +
    `border:1px solid ${t.border};border-radius:5px;padding:4px;background:${t.field};`;
  list.appendChild(tag("div", { textContent: "No steps yet. Press Record, then do one item by hand.", style: `color:${t.sub};padding:2px;` }));
  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    const remove = target.closest('[data-act="rec-remove"]');
    if (remove) { if (onRemoveStep) onRemoveStep(Number(remove.getAttribute("data-index"))); return; }
    if (target.closest("input")) return;
    const line = target.closest('[data-act="rec-step"]');
    if (line && onSelectStep) onSelectStep(Number(line.getAttribute("data-index")));
  });
  list.addEventListener("change", (event) => {
    const box = event.target && event.target.closest ? event.target.closest('[data-act="rec-wait-seconds"]') : null;
    if (box && onWaitSeconds) onWaitSeconds(Number(box.getAttribute("data-index")), box.value);
  });
  body.appendChild(list);

  // Operators: a wait after the chosen step, a check before it.
  const ops = row();
  ops.appendChild(button(t, "rec-add-wait", "＋ Wait", onAddWait, "Add a wait after the chosen step"));
  const check = tag("input", { type: "text", placeholder: "page says…" });
  check.setAttribute("data-act", "rec-check-text");
  check.style.cssText = numberStyle(110, t);
  ops.appendChild(check);
  ops.appendChild(button(t, "rec-add-check", "＋ Skip if", () => {
    const words = check.value;
    if (onAddCheck) onAddCheck(words);
    check.value = "";
  }, "Before the chosen step, skip the item if its page says these words"));
  body.appendChild(ops);

  // The list's filters, highlight and limits.
  const skip = field(t, "rec-skip", "Skip items with", "text", 150, "Words, comma between; an item holding any is left out", onSkipText);
  const only = field(t, "rec-only", "Only items with", "text", 150, "Words, comma between; only items holding one are taken", onOnlyText);
  const mark = field(t, "rec-highlight", "Highlight", "text", 150, "Words to mark on every page while this is open", onHighlight);
  for (const each of [skip, only, mark]) body.appendChild(each.wrap);
  const numbers = row(10);
  const pages = field(t, "rec-pages", "Pages", "number", 52, "Stop after this many list pages; 0 for all", onPages);
  const timeout = field(t, "rec-timeout", "Step timeout s", "number", 52, "How long a step may wait for its button", onTimeout);
  numbers.appendChild(pages.wrap);
  numbers.appendChild(timeout.wrap);
  body.appendChild(numbers);

  // Strip: counts, status, export, details.
  const strip = tag("div");
  strip.style.cssText =
    `padding:7px 12px;border-top:1px solid ${t.border};background:${t.head};` +
    "display:flex;flex-direction:column;gap:3px;";
  const counts = tag("div", { style: `color:${t.fg};font:11px sans-serif;min-height:14px;` });
  const status = tag("div", { textContent: "Ready.", style: `color:${t.sub};font:11px sans-serif;min-height:14px;` });
  const foot = row();
  const exporter = button(t, "rec-export", "Export", onExport, "Save the steps and the ledger as JSON");
  exporter.style.padding = "1px 6px";
  const more = tag("button", { textContent: "Details ▸", type: "button" });
  more.setAttribute("data-act", "rec-details");
  more.style.cssText = RESET + `display:none;border:0;background:none;padding:0;cursor:pointer;color:${t.sub};font:11px sans-serif;text-decoration:underline;`;
  foot.appendChild(exporter);
  foot.appendChild(more);
  const box = tag("pre");
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
  strip.appendChild(foot);
  strip.appendChild(box);
  panel.appendChild(strip);

  return {
    el: panel,
    head,
    setMode(mode) {
      record.textContent = mode === "recording" ? "■ Stop recording" : "⏺ Record";
      play.textContent = mode === "running" ? "⏸ Pause" : mode === "paused" ? "▶ Resume" : "▶ Play";
    },
    setSteps(lines, kinds, waits, selected) {
      list.textContent = "";
      if (!lines.length) {
        list.appendChild(tag("div", { textContent: "No steps yet. Press Record, then do one item by hand.", style: `color:${t.sub};padding:2px;` }));
        return;
      }
      lines.forEach((text, index) => {
        const line = tag("div");
        line.setAttribute("data-act", "rec-step");
        line.setAttribute("data-index", String(index));
        line.setAttribute("aria-selected", index === selected ? "true" : "false");
        line.style.cssText = "display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;cursor:pointer;" +
          (index === selected ? `background:${t.hover};outline:1px solid ${t.accent};` : "");
        line.appendChild(tag("span", { textContent: `${index + 1}. ${text}`, style: "flex:1;min-width:0;overflow-wrap:anywhere;" }));
        if (kinds[index] === "wait") {
          const seconds = tag("input", { type: "number", min: "0", value: String(waits[index]) });
          seconds.setAttribute("data-act", "rec-wait-seconds");
          seconds.setAttribute("data-index", String(index));
          seconds.title = "Seconds";
          seconds.style.cssText = numberStyle(46, t);
          line.appendChild(seconds);
        }
        if (index > 0) {
          const remove = tag("button", { textContent: "✕", type: "button", title: "Remove this step" });
          remove.setAttribute("data-act", "rec-remove");
          remove.setAttribute("data-index", String(index));
          remove.style.cssText = RESET + `border:0;background:none;color:${t.sub};cursor:pointer;padding:0 3px;font:11px sans-serif;`;
          line.appendChild(remove);
        }
        list.appendChild(line);
      });
    },
    setFields({ skipText = "", onlyText = "", highlight = "", pages: pageCount = 0, timeout: seconds = 30 } = {}) {
      skip.input.value = skipText;
      only.input.value = onlyText;
      mark.input.value = highlight;
      pages.input.value = String(pageCount);
      timeout.input.value = String(seconds);
    },
    setStatus(text) { status.textContent = text || ""; },
    setCounts(text) { counts.textContent = text || ""; },
    setDetails(text, openIt = false) {
      box.textContent = text || "";
      more.style.display = text ? "inline-block" : "none";
      if (!text || openIt) {
        box.style.display = text && openIt ? "block" : "none";
        more.textContent = text && openIt ? "Details ▾" : "Details ▸";
      }
    },
    setReset(label) { reset.textContent = label; },
  };
}
