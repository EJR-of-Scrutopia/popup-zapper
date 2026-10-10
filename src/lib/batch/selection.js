// Making a batch's selection stick before anything is pressed, and Select all.

import { collapse, isTicked, clickBox } from "./rows.js";
import { countFromButtonText } from "./evidence.js";
import { wantsFormat } from "./settings.js";
import { wholeNumber } from "./ledger.js";

// Up to five seconds for the page to take a selection, looked at every 50 ms
// from the moment the boxes are ticked.
const SELECTION_WAIT = 5;
const SELECTION_POLL = 0.05;

export function wordsOf(node) {
  const shown = typeof node.innerText === "string" ? node.innerText : node.textContent;
  return collapse(shown || node.value || "");
}

// The batch's row as the page holds it NOW, found by its identity: a page
// that reuses an element for another document must never get that document
// ticked in its place. The same box alone will do only for unticking.
export function findRow(chosen, live, sameBoxWillDo) {
  let byText = null;
  for (const each of live) {
    if (each.identity.id !== chosen.identity.id) continue;
    if (each.box === chosen.box) return each;
    if (!byText) byText = each;
  }
  if (byText || !sameBoxWillDo) return byText;
  for (const each of live) if (each.box === chosen.box) return each;
  return null;
}

// A disabled button is not ready, even when its count matches.
export function isReady(button) {
  if (!button || button.disabled === true) return false;
  const said = typeof button.getAttribute === "function" ? button.getAttribute("aria-disabled") : null;
  return said !== "true";
}

function setTicked(each, wanted) {
  if (isTicked(each.box) !== wanted) clickBox(each.box);
}

// Untick each by its own box while that is still on the page; a box the
// page replaced is found again by identity, then by the same box.
export function untickChosen(chosen, env) {
  let live = null;
  for (const each of chosen) {
    if (each.box && each.box.isConnected !== false) { setTicked(each, false); continue; }
    if (!live) live = env.rows();
    const found = findRow(each, live, true);
    if (found) setTicked(found, false);
  }
}

export function selectionProblem(size, button, count, missing, reclicked, strays) {
  const said = [];
  if (!button) said.push("no download button (pick one with ⬇)");
  else if (!isReady(button)) said.push("the download button stayed disabled");
  if (count !== null && count !== size) {
    said.push(`the button reads "${wordsOf(button)}" for a batch of ${size}`
      + (count > size ? "; clear other ticks by hand" : ""));
  }
  if (missing) said.push(`${missing} row(s) gone`);
  if (reclicked) said.push(`${reclicked} box(es) would not stay ticked`);
  if (strays) said.push(`${strays} other box(es) ticked`);
  return `The page did not take the selection: ${said.join("; ")}. Nothing pressed. `
    + "Play to try again, or lower the batch size.";
}

// Tick the batch and wait for the page to take it. env: rows, button, now,
// sleep, halted, and optionally locate (quick find) and checked (ticked rows).
// If the page does not take it, nothing is pressed: the batch is cleared,
// tried once more, then given up, recording nothing. Any ticked row outside
// the batch is unticked first, so nothing rides along uncredited.
export async function takeSelection(chosen, env) {
  const halted = () => typeof env.halted === "function" && env.halted() === true;
  let everyRow = null;
  const allRows = () => { if (!everyRow) everyRow = env.rows(); return everyRow; };
  const resolve = (each) => {
    if (typeof env.locate === "function") {
      const quick = env.locate(each);
      if (quick) return quick;
    }
    return findRow(each, allRows(), false);
  };
  let problem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    everyRow = null;
    for (const each of chosen) {
      const found = resolve(each);
      if (found) setTicked(found, true);
    }
    const until = env.now() + SELECTION_WAIT * 1000;
    for (;;) {
      if (halted()) return { ok: false, halted: true, problem: "" };
      everyRow = null;
      const found = chosen.map(resolve);
      const missing = found.filter((each) => !each).length;
      let reclicked = 0;
      for (const each of found) {
        if (each && !isTicked(each.box)) { clickBox(each.box); reclicked++; }
      }
      const ours = new Set(found.filter(Boolean).map((each) => each.box));
      let strays = 0;
      const ticked = typeof env.checked === "function" ? env.checked() : allRows().filter((each) => isTicked(each.box));
      for (const each of ticked) {
        if (isTicked(each.box) && !ours.has(each.box)) { clickBox(each.box); strays++; }
      }
      const button = env.button(everyRow) || null;
      const count = button ? countFromButtonText(wordsOf(button)) : null;
      if (isReady(button) && !missing && !reclicked && !strays && (count === null || count === chosen.length)) {
        return { ok: true, halted: false, button, count };
      }
      problem = selectionProblem(chosen.length, button, count, missing, reclicked, strays);
      if (env.now() >= until) break;
      await env.sleep(SELECTION_POLL);
    }
    untickChosen(chosen, { rows: allRows });
    await env.sleep(1);
  }
  return { ok: false, halted: false, problem };
}

// ---- Select all: ticks every row a run would take, for a site that takes
// a whole page in one download; nothing goes in the ledger ----

export function rowsToSelect(live, types, start) {
  const from = wholeNumber(start, 1);
  const scope = from > 1 ? (live || []).slice(from - 1) : (live || []);
  return scope.filter((each) => wantsFormat(types, each.identity.format));
}

function allTicked(rows) {
  return rows.length > 0 && rows.every((each) => isTicked(each.box) === true);
}

export function selectAllLabel(rows) {
  return allTicked(rows) ? "Untick all" : "Select all";
}

// A box already as wanted is not clicked (a click would undo it), and a row
// the page hides is passed over. `usable` says whether a row may be ticked.
export function tickAll(rows, usable) {
  const untick = allTicked(rows);
  const done = { untick, changed: 0, passed: 0, rows: rows.length };
  for (const each of rows) {
    if (isTicked(each.box) === !untick) continue;
    if (!untick && typeof usable === "function" && usable(each) === false) { done.passed += 1; continue; }
    clickBox(each.box);
    done.changed += 1;
  }
  return done;
}

export function selectAllReport(done, kept, button) {
  if (done.untick) return `Unticked ${done.changed}.` + (kept ? ` ${kept} stayed ticked: press again.` : "");
  if (!done.rows) return "No rows to select.";
  const wanted = done.rows - done.passed;
  const passed = done.passed ? ` (${done.passed} hidden, passed over)` : "";
  if (kept < wanted) {
    return `Only ${kept} of ${wanted} stayed ticked${passed}. Press again; if it will not rise, `
      + "the page caps a selection, so use Play.";
  }
  const named = collapse(button).slice(0, 30);
  return `Selected ${kept} of ${done.rows}${passed}. Now press the page's download button`
    + (named ? ` ("${named}")` : "") + ".";
}
