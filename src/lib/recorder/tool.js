// The step recorder on the page. Record: the person does one item by hand
// and every click and Back is noted, across pages, sites and tabs. Play: the
// steps are done again for every item in the list, page after page.
//
// Every tab with the zapper takes part through shared storage: the run is a
// state machine (engine.js), each page polls it, and only the page whose
// turn it is acts, writing the next state before it acts. Until the recorder
// is used, it changes nothing on any page.

import { createRecorderStore, markRow, ledgerTally, forgetFailed, ledgerLines, undoLast } from "./store.js";
import { newDraft, addClick, addBack, finishRecording, removeStep, insertWait, setWait, insertCheck, describeStep } from "./steps.js";
import {
  startRun, currentTask, whoActs, rowPicked, bindTab, advance, rowEnded, listArrived, startTurning, turnStarted,
  pageTurned, resumed, timedOut, failNote, sameList, stopRun, tokenPlan, overdue,
  adoptToken, beatFresh, tooManyFailures, navigated, pageSettled, stepBack, FAIL_STREAK_LIMIT, NAVIGATION_LIMIT,
} from "./engine.js";
import { describeStepTarget, refineWords, rowsFor, rowOf, findInRow, findOnPage, parseWords, wantedRows, pageHasWords } from "./targets.js";
import { highlightWords, clearHighlights, MARK, SKIP } from "./highlight.js";
import { createRecorderPanel } from "./panel.js";
import { resolveTarget } from "../batch/target.js";
import { findNextControls } from "../batch/pager.js";
import { makeDraggable } from "../batch/panel.js";
import { readSetting } from "../batch/evidence.js";

const TAB_KEY = "pz-rec tab";
const POSITION_KEY = "pz-rec position";
const ROW_MARK = "data-pz-rec";
const POLL_MS = 300;
const BEAT_EVERY_MS = 3000;
const UNBOUND_GIVE_UP_MS = 60000;
const NAV_RETRY_MS = 10000;
const NOT_A_LIST = "That isn't one of a list of items. Click the first item's button.";
// What a person clicks to make something happen; a click anywhere else on
// the page (to take focus back, say) is not a step.
const ACTIONABLE = 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], input, select, label, summary, [onclick], [class*="btn"], [class*="button"], [tabindex]';
const ROW_LOOK = {
  done: ["", "0.45"],
  skipped: ["2px dashed #c62828", ""],
  failed: ["2px dashed #e08a00", ""],
  current: ["3px solid #1e88e5", ""],
};

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function onScreen(node) {
  if (!node) return false;
  if (typeof node.checkVisibility === "function") {
    try { return node.checkVisibility() === true; } catch { /* fall through */ }
  }
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

function fileStamp(date) {
  const two = (number) => (number < 10 ? "0" : "") + number;
  return date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + "-"
    + two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds());
}

// A link's address, when it is a real one: not "#", not script, and not
// this same page with another fragment (a link that only runs a handler).
export function realHref(link, pageHref) {
  if (!link || typeof link.getAttribute !== "function") return "";
  const raw = String(link.getAttribute("href") || "").trim();
  if (!raw || raw.charAt(0) === "#" || /^javascript:/i.test(raw)) return "";
  const href = String(link.href || "");
  const bare = (url) => String(url).split("#")[0];
  return href && bare(href) !== bare(pageHref) ? href : "";
}

// Stands in for a page's window.open while a replayed click runs: the
// address goes to the manager's tab opener. A blank one is not opened; an
// address set on the returned window afterwards is opened instead.
export function openStand(openTab, base) {
  return function (url) {
    const go = (where) => {
      const text = String(where == null ? "" : where).trim();
      if (!text || /^about:blank$/i.test(text)) return;
      try { openTab(new URL(text, base).href); } catch { /* nothing to open */ }
    };
    go(url);
    const location = { assign: go, replace: go, toString: () => "" };
    Object.defineProperty(location, "href", { get: () => "", set: go });
    const stub = { closed: false, focus() {}, close() {}, document: { open() {}, write() {}, close() {} } };
    Object.defineProperty(stub, "location", { get: () => location, set: go });
    return stub;
  };
}

// Runs work with the page's window.open sent to openTab, and gives the
// page its own back a second later (a site's handler may open late).
export function withOpenCaught(pageWindow, openTab, base, work) {
  const original = pageWindow.open;
  const stand = openStand(openTab, base);
  try { pageWindow.open = stand; } catch { /* left as it is */ }
  try { work(); } finally {
    setTimeout(() => { try { if (pageWindow.open === stand) pageWindow.open = original; } catch { /* nothing */ } }, 1000);
  }
}

// One recorded click from the element clicked. The first must be on an item
// of a list (two or more alike); a later one in the same item's row, on the
// same visit, is found again inside each item's row.
export function stepFromClick(node, me, draft, { doc = document, isOurs = () => false, rowNode = null } = {}) {
  const found = resolveTarget(node);
  if (!found) return { problem: "Nothing there to record." };
  const base = { tab: me.token, origin: me.origin, path: me.path, visit: me.visit };
  const firstClick = !draft.steps.some((step) => step.kind === "click");
  if (!firstClick && found.kind === "button") {
    let acts = false;
    try { acts = !!found.node.closest(ACTIONABLE); } catch { acts = false; }
    if (!acts) return { ignored: true };
  }
  let target = describeStepTarget(found.node, found.kind);
  if (!target.chain.length) return { problem: "That can't be found again. Click something inside the page." };
  if (firstClick) {
    const loose = Object.assign({}, target, { words: "" });
    target = refineWords(target, rowsFor(doc, loose, isOurs).map((row) => row.control));
    const rows = rowsFor(doc, target, isOurs);
    const row = rowOf(rows, found.node);
    if (!row || rows.length < 2) return { problem: NOT_A_LIST };
    return { click: Object.assign(base, { target, scope: "row", row: { id: row.id, title: row.name || row.title } }), rowNode: row.node };
  }
  const inRow = !!rowNode && me.visit === draft.rowVisit && rowNode.contains(found.node);
  return { click: Object.assign(base, { target, scope: inRow ? "row" : "page" }), rowNode };
}

export function createRecorderTool({ gm, pageWindow = window, version = "0.0.0", win = window, doc = document } = {}) {
  const store = createRecorderStore(gm);
  const isOurs = (node) => {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return !!(el && typeof el.closest === "function" && el.closest("[data-pz]"));
  };

  // ---- this tab and this visit ----

  let memToken = null;
  let visit = newId();
  let startedAt = Date.now();
  let holdUntil = 0;
  let navigatedAt = 0;
  let closingAsked = false;

  function readToken() {
    try { return win.sessionStorage.getItem(TAB_KEY) || memToken; } catch { return memToken; }
  }

  function keepToken(token) {
    memToken = token;
    try { win.sessionStorage.setItem(TAB_KEY, token); } catch { /* memory only */ }
    return token;
  }

  // The same tab after moving to another site has a fresh sessionStorage: it
  // takes the token a page let go of within 5 s, when it came from that site.
  async function adoptable(live) {
    let from = "";
    try { from = new URL(doc.referrer).origin; } catch { from = ""; }
    return adoptToken(await store.readLeaving(), {
      origin: win.location.origin, referrerOrigin: from, historyLength: win.history.length, now: Date.now(), closing: live.closing,
    });
  }

  function me(now = Date.now()) {
    return {
      token: readToken(), visit, origin: win.location.origin, href: win.location.href, path: win.location.pathname,
      startedAt, now, holdUntil,
    };
  }

  function hold(ms) { holdUntil = Date.now() + ms; }

  // ---- what the panel shows ----

  let opened = false;
  let view = null;
  let selected = -1;
  let localNote = null;
  let shown = { steps: "", fields: "" };
  let resetArmed = 0;
  let liveCache = { mode: "idle", closing: [], note: "" };
  let recCache = null;
  let ledgerCache = { rows: {} };

  function say(text) {
    localNote = { text, until: Date.now() + 5000 };
    if (view) view.setStatus(text);
  }

  // ---- the loop ----

  let timer = null;
  let ticking = false;
  let busy = false;
  let lastChange = Date.now();
  let completeAt = 0;

  // Whether this page is ready to be clicked (engine.js pageSettled).
  function settledNow(now) {
    if (!completeAt && doc.readyState === "complete") completeAt = now;
    return pageSettled({ readyState: doc.readyState, now, lastChange, completeAt });
  }
  let quietWatch = null;
  let highlightAt = 0;
  let highlightKey = "";
  let lastBeat = 0;

  // The home tab's sign of life, so other tabs never carry on a run whose
  // tab has gone.
  function beat(token) {
    lastBeat = Date.now();
    try { store.writeBeatNow({ token, at: lastBeat }); } catch { /* the next tick tries again */ }
  }

  // Tabs this page opened for the run, closed by their handle when the item
  // ends: a tab that never takes a step (a login page, a copy of the item)
  // is closed all the same.
  const handles = [];
  function keepHandle(handle) {
    if (handle && typeof handle.close === "function") handles.push(handle);
  }
  function closeHandles() {
    for (const handle of handles.splice(0)) {
      try { if (!handle.closed) handle.close(); } catch { /* already gone */ }
    }
  }

  function startLoop() {
    if (timer) return;
    timer = setInterval(() => { tick(); }, POLL_MS);
    if (!quietWatch && typeof MutationObserver === "function" && doc.body) {
      try {
        quietWatch = new MutationObserver((records) => {
          if (records.some((record) => !isOurs(record.target))) lastChange = Date.now();
        });
        quietWatch.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch { quietWatch = null; }
    }
  }

  function stopLoop() {
    clearInterval(timer);
    timer = null;
    if (quietWatch) { try { quietWatch.disconnect(); } catch { /* nothing */ } quietWatch = null; }
  }

  function recOriginOf(live) {
    if (live.run) return live.run.origin;
    if (live.draft) return live.draft.origin;
    return win.location.origin;
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const live = await store.readLive();
      liveCache = live;
      const token = readToken();
      if (token && live.closing.indexOf(token) >= 0) { closeSelf(); return; }
      if (live.mode === "recording") listenForClicks(); else stopListening();
      const origin = recOriginOf(live);
      recCache = await store.readRecording(origin);
      ledgerCache = await store.readLedger(origin);
      const bound = live.run && token && Object.keys(live.run.tabs).some((tab) => live.run.tabs[tab] === token);
      if (live.mode === "running" && token && live.run.home === token && Date.now() - lastBeat >= BEAT_EVERY_MS) beat(token);
      if (live.mode === "running" && token && !busy) {
        busy = true;
        try { await act(live, recCache, ledgerCache); } finally { busy = false; }
      }
      if (!opened && (live.mode === "recording" || bound)) open();
      render(live, recCache, ledgerCache);
      const unboundTooLong = live.mode === "running" && !bound && Date.now() - startedAt > UNBOUND_GIVE_UP_MS;
      if (!opened && (live.mode === "idle" || unboundTooLong)) stopLoop();
    } catch (error) {
      say("Recorder fault: " + (error && error.message ? error.message : String(error)));
    } finally {
      ticking = false;
    }
  }

  // Written only if nobody wrote since this page read it (a Stop pressed in
  // another tab must not be undone).
  async function commit(expected, next) {
    const current = await store.readLive();
    if ((current.rev || 0) !== (expected.rev || 0) || current.mode !== expected.mode) return null;
    const written = Object.assign({}, next, { rev: (expected.rev || 0) + 1 });
    await store.writeLive(written);
    liveCache = written;
    return written;
  }

  async function writeFresh(next) {
    const current = await store.readLive();
    const written = Object.assign({}, next, { rev: (current.rev || 0) + 1 });
    await store.writeLive(written);
    liveCache = written;
    return written;
  }

  function closeSelf() {
    if (closingAsked) return;
    closingAsked = true;
    stopLoop();
    try { win.close(); } catch { /* the browser said no */ }
    setTimeout(() => say("Close this tab by hand: the browser kept it open."), 1500);
  }

  // ---- acting on the run ----

  function rowsHere(rec) {
    return rec && rec.steps[0] ? rowsFor(doc, rec.steps[0].target, isOurs) : [];
  }

  async function finish(live, note) {
    closeHandles();
    await commit(live, stopRun(live, note));
    say(note);
  }

  // Three failures in a row (a lapsed login, a changed site) stop the run.
  async function endRow(live, run, rec, ledger, status, note) {
    if (run.row) {
      const kept = markRow(ledger, run.row.id, { status, title: run.row.title, note, at: new Date().toISOString(), page: run.page });
      await store.writeLedger(rec.origin, kept);
      ledgerCache = kept;
    }
    const ended = rowEnded(run, Date.now(), status);
    const next = Object.assign({}, live, { run: ended.run, closing: ended.closing });
    closeHandles();
    if (status === "failed" && tooManyFailures(ended.run)) {
      const words = `Stopped: ${FAIL_STREAK_LIMIT} items failed in a row. Last: ${note}`;
      const written = await commit(live, stopRun(next, words));
      say(words);
      return written;
    }
    return commit(live, next);
  }

  async function moveOn(live, run, rec, ledger, mine) {
    const out = advance(run, rec, mine, Date.now());
    if (!out.finished) return commit(live, Object.assign({}, live, { run: out.run }));
    return endRow(live, out.run, rec, ledger, "done", "");
  }

  // Back to the list's address, at most three times without arriving: a
  // site that rewrites the address would otherwise reload it for ever.
  async function goToList(live, run) {
    if (Date.now() - navigatedAt < NAV_RETRY_MS) return;
    if ((run.navigations || 0) >= NAVIGATION_LIMIT) { await finish(live, "The list page didn't come back at " + run.listUrl); return; }
    if (!await commit(live, Object.assign({}, live, { run: navigated(run, Date.now()) }))) return;
    navigatedAt = Date.now();
    hold(5000);
    win.location.href = run.listUrl;
  }

  function locate(step, index, run, rec) {
    if (step.scope === "row") {
      const row = rowsHere(rec).find((each) => run.row && each.id === run.row.id);
      if (!row) return null;
      return index === 0 ? row.control : findInRow(row.node, step.target);
    }
    return findOnPage(doc, step.target, { isOurs, onScreen });
  }

  function fire(el) {
    try { el.scrollIntoView({ block: "center" }); } catch { /* fine where it stands */ }
    const View = win.PointerEvent || win.MouseEvent;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      try {
        const Kind = type.startsWith("pointer") ? View : win.MouseEvent;
        el.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, view: win, button: 0 }));
      } catch { /* the click still goes */ }
    }
    el.click();
  }

  // A tab opened from a script's click is stopped by the popup blocker, so
  // a link known to open a tab goes through the manager's own tab opener,
  // and on every click the page's own window.open is caught for a moment
  // and sent the same way: CIBSE's "Yes, I agree" opens its file with
  // window.open, whether or not the recording went on into that tab.
  function press(el, step) {
    if (step.opens) {
      let link = null;
      try { link = el.closest("a[href]"); } catch { link = null; }
      const href = realHref(link, win.location.href);
      if (href) { keepHandle(gm.openTab(href)); return; }
    }
    withOpenCaught(pageWindow, (url) => { const handle = gm.openTab(url); keepHandle(handle); return handle; },
      win.location.href, () => fire(el));
  }

  function comeForward() {
    try { if (doc.hidden) win.focus(); } catch { /* the manager may not allow it */ }
  }

  async function act(live, rec, ledger) {
    const run = live.run;
    if (!run || !rec) return;
    const now = Date.now();
    const mine = me(now);
    const task = currentTask(run, rec);
    if (mine.token !== run.home && !beatFresh(await store.readBeat(), now)) {
      say("The run's tab has gone quiet. Press Stop if it was closed.");
      return;
    }
    const who = whoActs(run, rec, mine, task);
    if (!who.mine) {
      // A step nobody is doing (its tab never opened, or was closed by hand).
      if (mine.token === run.home && overdue(run, rec, now, task)) await endRow(live, run, rec, ledger, "failed", failNote(task, rec));
      return;
    }
    if (mine.token === run.home) comeForward();

    if (task.type === "pick-row") {
      closeHandles();
      if (!sameList(win.location.href, run.listUrl)) {
        if (now - run.since > 1500) await goToList(live, run);
        return;
      }
      const rows = rowsHere(rec);
      paintRows(rows, ledger, null);
      if (!rows.length) {
        if (timedOut(run, rec, now, task)) await finish(live, "No items found on the list page. Press Play on the list.");
        return;
      }
      const wanted = wantedRows(rows, ledger, rec);
      if (!wanted.length) { await commit(live, Object.assign({}, live, { run: startTurning(run, now) })); return; }
      await commit(live, Object.assign({}, live, { run: rowPicked(run, { id: wanted[0].id, title: wanted[0].name || wanted[0].title }, now) }));
      return;
    }

    if (task.type === "unwind") {
      closeHandles();
      if (sameList(win.location.href, run.listUrl)) await commit(live, Object.assign({}, live, { run: listArrived(run, now) }));
      else if (now - run.since > 1500) await goToList(live, run);
      return;
    }

    if (task.type === "turn-page") {
      if (rec.pages > 0 && run.page >= rec.pages) { await finish(live, `Stopped after ${run.page} page(s).`); return; }
      if (!settledNow(now)) return;
      const rows = rowsHere(rec);
      const last = rows.length ? rows[rows.length - 1].node : null;
      const found = findNextControls(doc, last, { isOurs, onScreen, win });
      if (!found.length) { await finish(live, "Last page done."); return; }
      const signature = rows.map((row) => row.id).join("\n");
      if (!await commit(live, Object.assign({}, live, { run: turnStarted(run, mine, signature, now) }))) return;
      hold(1500);
      fire(found[0].control);
      return;
    }

    if (task.type === "await-page") {
      const rows = rowsHere(rec);
      const signature = rows.map((row) => row.id).join("\n");
      if (rows.length && (mine.visit !== run.turnFrom.visit || signature !== run.turnFrom.signature)) {
        await commit(live, Object.assign({}, live, { run: pageTurned(run, win.location.href, now) }));
      } else if (timedOut(run, rec, now, task)) {
        await finish(live, "The next page didn't load.");
      }
      return;
    }

    // A step.
    const step = task.step;
    const ready = who.bind ? bindTab(run, step.tab, mine.token) : run;
    if (who.skip) { await moveOn(live, ready, rec, ledger, mine); return; }
    if (step.kind === "click") {
      const el = settledNow(now) ? locate(step, task.index, ready, rec) : null;
      if (!el) {
        if (timedOut(ready, rec, now, task)) await endRow(live, ready, rec, ledger, "failed", failNote(task, rec));
        return;
      }
      if (!await moveOn(live, ready, rec, ledger, mine)) return;
      hold(1500);
      press(el, step);
      return;
    }
    if (step.kind === "wait") {
      if (now - ready.since >= step.seconds * 1000) await moveOn(live, ready, rec, ledger, mine);
      return;
    }
    if (step.kind === "check") {
      if (pageHasWords(doc, step.text, { isOurs, onScreen })) { await endRow(live, ready, rec, ledger, "skipped", `page says "${step.text}"`); return; }
      const settled = doc.readyState === "complete" && now - lastChange >= 1000 && now - ready.since >= 1000;
      if (settled || timedOut(ready, rec, now, task)) await moveOn(live, ready, rec, ledger, mine);
      return;
    }
    if (step.kind === "back") {
      if (!await moveOn(live, ready, rec, ledger, mine)) return;
      closeHandles();
      hold(5000);
      win.history.back();
      return;
    }
    if (step.kind === "close") {
      if (!await moveOn(live, ready, rec, ledger, mine)) return;
      setTimeout(closeSelf, 100);
    }
  }

  // ---- painting and highlighting ----

  function paintRows(rows, ledger, currentId) {
    for (const row of rows) {
      const held = ledger.rows[row.id];
      const status = row.id === currentId ? "current" : held ? held.status : "";
      if (row.node.getAttribute(ROW_MARK) === (status || null)) continue;
      const look = ROW_LOOK[status];
      row.node.style.outline = look ? look[0] : "";
      row.node.style.opacity = look ? look[1] : "";
      if (status) {
        row.node.setAttribute(ROW_MARK, status);
        if (held && held.note) row.node.title = held.status + ": " + held.note;
      } else {
        row.node.removeAttribute(ROW_MARK);
      }
    }
  }

  function clearRowPaint() {
    for (const node of doc.querySelectorAll("[" + ROW_MARK + "]")) {
      node.style.outline = "";
      node.style.opacity = "";
      node.removeAttribute(ROW_MARK);
    }
  }

  function refreshHighlights(rec, force = false) {
    const words = rec ? [rec.highlight || "", rec.skipText || ""] : ["", ""];
    const key = words.join("\n");
    if (!force && key === highlightKey && Date.now() - highlightAt < 2000) return;
    highlightKey = key;
    highlightAt = Date.now();
    try {
      highlightWords(doc, MARK, parseWords(words[0]), isOurs);
      highlightWords(doc, SKIP, parseWords(words[1]), isOurs);
    } catch { /* marks are a help, not a need */ }
  }

  // ---- drawing the panel ----

  function stepsOf(live, rec) {
    if (live.mode === "recording" && live.draft) return live.draft.steps;
    return rec ? rec.steps : [];
  }

  function statusOf(live, rec) {
    if (localNote && Date.now() < localNote.until) return localNote.text;
    if (live.mode === "recording") {
      const steps = (live.draft && live.draft.steps) || [];
      return steps.length ? `Recording: ${steps.length} step(s). Finish the item, then Stop recording.`
        : "Recording: do one item by hand, starting with its button in the list.";
    }
    if (live.mode === "paused") return "Paused.";
    if (live.mode === "running" && live.run && rec) {
      const run = live.run;
      const task = currentTask(run, rec);
      const item = run.row ? `"${run.row.title.slice(0, 40)}" ` : "";
      if (task.type === "step") return `Page ${run.page} · ${item}step ${task.index + 1} of ${rec.steps.length}: ${describeStep(task.step, task.index, rec.steps)}`;
      if (task.type === "pick-row") return `Page ${run.page} · finding the next item…`;
      if (task.type === "unwind") return `Page ${run.page} · back to the list…`;
      return `Page ${run.page} done · turning the page…`;
    }
    return live.note || (rec ? "Ready. Play repeats the steps for every item." : "Press Record on the list page, then do one item by hand.");
  }

  function render(live, rec, ledger) {
    if (!view) return;
    view.setMode(live.mode);
    const steps = stepsOf(live, rec);
    const stepsKey = JSON.stringify(steps) + "|" + selected;
    if (stepsKey !== shown.steps) {
      shown.steps = stepsKey;
      if (selected >= steps.length) selected = steps.length - 1;
      view.setSteps(steps.map((step, index) => describeStep(step, index, steps)), steps.map((step) => step.kind),
        steps.map((step) => (step.kind === "wait" ? step.seconds : null)), selected);
    }
    if (rec) {
      const fieldsKey = [rec.id, rec.skipText, rec.onlyText, rec.highlight, rec.pages, rec.timeout].join("|");
      const typing = doc.activeElement && view.el.contains(doc.activeElement) && doc.activeElement.tagName === "INPUT";
      if (fieldsKey !== shown.fields && !typing) {
        shown.fields = fieldsKey;
        view.setFields(rec);
      }
    }
    const tally = ledgerTally(ledger);
    const rows = rec && win.location.origin === rec.origin ? rowsHere(rec) : [];
    const page = live.run ? `Page ${live.run.page} · ` : "";
    view.setCounts(rec ? `${page}${rows.length} items here · ${tally.done} done · ${tally.skipped} skipped · ${tally.failed} failed` : "");
    view.setStatus(statusOf(live, rec));
    view.setDetails(ledgerLines(ledger).join("\n"));
    if (rows.length && live.mode !== "recording") paintRows(rows, ledger, live.run && live.run.row ? live.run.row.id : null);
    refreshHighlights(rec);
  }

  // ---- recording ----

  let listening = false;
  let recRowNode = null;

  function onRecordClick(event) {
    if (!event || event.isTrusted !== true || isOurs(event.target)) return;
    try {
      const live = store.readLiveNow() || liveCache;
      if (!live || live.mode !== "recording" || !live.draft) return;
      const out = stepFromClick(event.target, me(), live.draft, { doc, isOurs, rowNode: recRowNode });
      if (out.ignored) return;
      if (out.problem) { say(out.problem); return; }
      if (out.rowNode) recRowNode = out.rowNode;
      const draft = Object.assign(addClick(live.draft, out.click), { lastAt: Date.now() });
      const next = Object.assign({}, live, { draft, rev: (live.rev || 0) + 1 });
      liveCache = next;
      store.writeLiveNow(next);
      say("Recorded: " + describeStep(draft.steps[draft.steps.length - 1], draft.steps.length - 1, draft.steps));
      render(next, recCache, ledgerCache);
    } catch (error) {
      say("Couldn't record that click: " + (error && error.message ? error.message : String(error)));
    }
  }

  function listenForClicks() {
    if (listening) return;
    listening = true;
    win.addEventListener("click", onRecordClick, true);
  }

  function stopListening() {
    if (!listening) return;
    listening = false;
    win.removeEventListener("click", onRecordClick, true);
  }

  async function noteBack() {
    const live = store.readLiveNow() || await store.readLive();
    if (live.mode !== "recording" || !live.draft) return;
    const mine = me();
    const backed = addBack(live.draft, { tab: mine.token, origin: mine.origin, visit: mine.visit });
    if (backed === live.draft) return;
    const draft = Object.assign(backed, { lastAt: Date.now() });
    await writeFresh(Object.assign({}, live, { draft }));
    say("Recorded: Go back");
  }

  function navType() {
    try {
      const entry = win.performance.getEntriesByType("navigation")[0];
      return entry ? String(entry.type) : "";
    } catch { return ""; }
  }

  const cameBack = () => navType() === "back_forward";

  async function record() {
    const live = await store.readLive();
    if (live.mode === "running" || live.mode === "paused") { say("Stop the run first."); return; }
    if (live.mode === "recording") { await stopRecording(live); return; }
    const token = readToken() || keepToken(newId());
    recRowNode = null;
    clearRowPaint();
    await writeFresh({
      mode: "recording", closing: live.closing, note: "",
      draft: Object.assign(newDraft({ origin: win.location.origin, listUrl: win.location.href, homeTab: token, visit }), { lastAt: Date.now() }),
    });
    listenForClicks();
    startLoop();
    selected = -1;
    say("Recording: do one item by hand, starting with its button in the list.");
  }

  async function stopRecording(live) {
    stopListening();
    const origin = live.draft.origin;
    const previous = await store.readRecording(origin);
    const out = finishRecording(live.draft, previous, { now: Date.now() });
    if (out.problem) {
      await writeFresh({ mode: "idle", closing: live.closing, note: out.problem });
      say(out.problem);
      return;
    }
    await store.writeRecording(origin, out.recording);
    if (out.recording.firstRow) {
      const ledger = markRow(await store.readLedger(origin), out.recording.firstRow.id,
        { status: "done", title: out.recording.firstRow.title, note: "done by hand", at: new Date().toISOString(), page: 1 });
      await store.writeLedger(origin, ledger);
    }
    await writeFresh({ mode: "idle", closing: live.closing, note: `Recorded ${out.recording.steps.length} steps. Play repeats them for every item.` });
    selected = -1;
  }

  // ---- buttons ----

  async function play() {
    const live = await store.readLive();
    if (live.mode === "recording") { say("Stop recording first."); return; }
    if (live.mode === "running") { await writeFresh(Object.assign({}, live, { mode: "paused" })); say("Paused."); return; }
    if (live.mode === "paused" && live.run) {
      await writeFresh(Object.assign({}, live, { mode: "running", run: resumed(live.run, Date.now()) }));
      if (live.run.home === readToken()) beat(live.run.home);
      startLoop();
      return;
    }
    const rec = await store.readRecording(win.location.origin);
    if (!rec) { say("Record one item first."); return; }
    const token = readToken() || keepToken(newId());
    const ledger = forgetFailed(await store.readLedger(rec.origin));
    await store.writeLedger(rec.origin, ledger);
    const run = startRun(rec, Object.assign(me(), { token }), Date.now());
    await writeFresh({ mode: "running", run, closing: live.closing, note: "" });
    beat(token);
    startLoop();
    say("Playing.");
  }

  async function stop() {
    const live = await store.readLive();
    if (live.mode === "recording") { await stopRecording(live); return; }
    if (live.mode === "idle") { say("Nothing is running."); return; }
    closeHandles();
    await writeFresh(stopRun(live, "Stopped."));
    say("Stopped.");
  }

  async function reset() {
    const live = await store.readLive();
    if (live.mode !== "idle") { say("Stop first."); return; }
    const origin = recOriginOf(live);
    const count = Object.keys((await store.readLedger(origin)).rows).length;
    if (!count) { say("The ledger is already empty."); return; }
    if (Date.now() > resetArmed) {
      resetArmed = Date.now() + 4000;
      if (view) view.setReset("Confirm reset?");
      say(`Press again to forget ${count} item(s) on this site.`);
      setTimeout(() => { if (view && Date.now() > resetArmed) view.setReset("↺ Reset"); }, 4100);
      return;
    }
    resetArmed = 0;
    if (view) view.setReset("↺ Reset");
    await store.writeLedger(origin, { rows: {} });
    ledgerCache = { rows: {} };
    clearRowPaint();
    say("Forgot every item; Play starts from the first.");
  }

  // Item back: the last item marked done or skipped is done again at the next
  // Play (one marked done though no file came, say). Each press goes one
  // further back.
  async function backOne() {
    const live = await store.readLive();
    if (live.mode === "running") { say("Pause first, then Item back."); return; }
    if (live.mode === "recording") { say("Stop recording first."); return; }
    const origin = recOriginOf(live);
    const out = undoLast(await store.readLedger(origin));
    if (!out.row) { say("Nothing done or skipped to take back."); return; }
    await store.writeLedger(origin, out.ledger);
    ledgerCache = out.ledger;
    say(`Item back: "${String(out.row.title).slice(0, 70)}" will be done again.`);
  }

  // Step back: the item under way goes back one step (engine.js stepBack),
  // running or paused; tabs opened after that step close themselves.
  async function stepBackNow() {
    const live = await store.readLive();
    if ((live.mode !== "running" && live.mode !== "paused") || !live.run) { say("Nothing is running."); return; }
    const rec = await store.readRecording(live.run.origin);
    if (!rec) { say("The recording is missing."); return; }
    const out = stepBack(live.run, rec, Date.now());
    if (out.refused) { say(out.refused); return; }
    const closing = live.closing.slice();
    for (const token of out.closing) if (closing.indexOf(token) < 0) closing.push(token);
    await writeFresh(Object.assign({}, live, { run: out.run, closing }));
    say(`Step back: step ${out.run.at + 1} again, ${describeStep(rec.steps[out.run.at], out.run.at, rec.steps)}.`);
  }

  async function editRecording(change) {
    const live = await store.readLive();
    if (live.mode !== "idle") { say(live.mode === "recording" ? "Stop recording first." : "Stop the run first."); return; }
    const origin = recOriginOf(live);
    const rec = await store.readRecording(origin);
    if (!rec) { say("Record one item first."); return; }
    const next = change(rec);
    if (next === rec) return;
    await store.writeRecording(origin, next);
    recCache = next;
    render(live, next, ledgerCache);
    refreshHighlights(next, true);
  }

  function saveExport() {
    const now = new Date();
    const out = { script: `popup-zapper ${version} step recorder`, at: now.toISOString(), recording: recCache, ledger: ledgerCache, live: liveCache };
    const link = doc.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    link.download = `step-recorder-${win.location.hostname || "page"}-${fileStamp(now)}.json`;
    link.style.display = "none";
    (doc.body || doc.documentElement).appendChild(link);
    link.click();
    link.remove();
    const made = link.href;
    setTimeout(() => { try { URL.revokeObjectURL(made); } catch { /* nothing */ } }, 30000);
    say("Saved " + link.download);
  }

  const run = (work) => () => { Promise.resolve().then(work).catch((error) => say("Recorder fault: " + (error && error.message))); };

  // ---- opening and closing ----

  function readPosition() {
    try {
      const held = JSON.parse(win.localStorage.getItem(POSITION_KEY) || "null");
      if (held && Number.isFinite(held.left) && Number.isFinite(held.top)
        && held.left < win.innerWidth - 40 && held.top < win.innerHeight - 30) return held;
    } catch { /* default spot */ }
    return null;
  }

  function build() {
    view = createRecorderPanel({
      position: readPosition(),
      onClose: () => close(),
      onRecord: run(record),
      onPlay: run(play),
      onStop: run(stop),
      onReset: run(reset),
      onBack: run(backOne),
      onStepBack: run(stepBackNow),
      onExport: saveExport,
      onSelectStep: (index) => { selected = index === selected ? -1 : index; render(liveCache, recCache, ledgerCache); },
      onRemoveStep: (index) => run(() => editRecording((rec) => removeStep(rec, index)))(),
      onWaitSeconds: (index, value) => run(() => editRecording((rec) => setWait(rec, index, value)))(),
      onAddWait: run(() => editRecording((rec) => insertWait(rec, selected >= 0 ? selected : rec.steps.length - 1))),
      onAddCheck: (text) => run(() => {
        if (selected <= 0) { say("Choose the step whose page to check, then add the words."); return null; }
        return editRecording((rec) => insertCheck(rec, selected, text));
      })(),
      onSkipText: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { skipText: String(value) })))(),
      onOnlyText: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { onlyText: String(value) })))(),
      onHighlight: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { highlight: String(value) })))(),
      onPages: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { pages: readSetting(value, 0, 0, 10000, true) })))(),
      onTimeout: (value) => run(() => editRecording((rec) => Object.assign({}, rec, { timeout: readSetting(value, 30, 5, 600, true) })))(),
    });
    (doc.body || doc.documentElement).appendChild(view.el);
    makeDraggable(view.el, view.head, (spot) => {
      try { win.localStorage.setItem(POSITION_KEY, JSON.stringify(spot)); } catch { /* nothing */ }
    });
    shown = { steps: "", fields: "" };
    render(liveCache, recCache, ledgerCache);
  }

  function open() {
    if (opened) return;
    opened = true;
    build();
    startLoop();
    tick();
  }

  function close() {
    if (!opened) return true;
    opened = false;
    if (view) view.el.remove();
    view = null;
    if (liveCache.mode === "idle") { clearRowPaint(); clearHighlights(doc); }
    return true;
  }

  function repaint() {
    if (!opened) return;
    if (view) view.el.remove();
    build();
  }

  // At load: carry on a recording or a run this tab takes part in, or close
  // a tab the run is done with. A tab with no part in it is left alone.
  async function resume() {
    const live = await store.readLive();
    liveCache = live;
    const token = readToken();
    if (token && live.closing.indexOf(token) >= 0) { closeSelf(); return true; }
    if (live.mode === "idle") return false;
    // A tab opened from another with its opener kept starts with a copy of
    // that tab's sessionStorage, token and all; it is a new tab all the same.
    let opener = false;
    try { opener = !!win.opener; } catch { opener = true; }
    const cloned = !!token && win.history.length === 1 && opener && navType() === "navigate";
    const adopted = !token || cloned ? await adoptable(live) : null;
    const alive = beatFresh(await store.readBeat(), Date.now());
    const plan = tokenPlan(live, {
      token, cloned, adopted, historyLength: win.history.length, startedAt, now: Date.now(), beatFresh: alive,
    });
    if (plan === "none") return false;
    if (plan === "adopt") keepToken(adopted);
    if (plan === "new") keepToken(newId());
    // Landed: a note that this tab was leaving is no longer for anyone.
    const leaving = await store.readLeaving();
    if (leaving && leaving.token === readToken()) store.writeLeavingNow(null);
    // The run's own tab back after a long absence (a browser restart brings
    // sessionStorage back) pauses rather than clicking on unasked.
    if (live.mode === "running" && live.run && live.run.home === readToken() && !alive) {
      await writeFresh(Object.assign({}, live, { mode: "paused", note: "" }));
      say("Paused: this tab was away from the run. Press Resume to carry on.");
    }
    if (live.mode === "recording") {
      listenForClicks();
      if (cameBack()) await noteBack();
      open();
    }
    startLoop();
    tick();
    return true;
  }

  // Each page load, and each return from the back-forward cache, is a visit.
  win.addEventListener("pageshow", (event) => {
    if (!event || !event.persisted) return;
    visit = newId();
    startedAt = Date.now();
    completeAt = startedAt;
    holdUntil = 0;
    navigatedAt = 0;
    if (readToken() && liveCache.mode === "recording") noteBack().catch(() => {});
    if (readToken() && liveCache.mode !== "idle") startLoop();
  });
  win.addEventListener("pagehide", () => {
    const token = readToken();
    if (!token || liveCache.mode === "idle") return;
    try { store.writeLeavingNow({ token, at: Date.now(), origin: win.location.origin }); } catch { /* best effort */ }
  });

  return {
    open,
    close,
    toggle: () => (opened ? close() : (open(), true)),
    isOpen: () => opened,
    repaint,
    resume,
    dispose() { stopLoop(); stopListening(); },
  };
}
