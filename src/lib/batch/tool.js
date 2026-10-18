// The batch clicker on the page. Opened from the zapper's menu, it reads the
// rows or items, drives the runners and draws the panel. Until it is opened
// it changes nothing on a page, and closing it stops every watcher.
//
// Two modes, chosen from what the page offers or what the person picked:
//   tick   rows with a checkbox: tick a batch, press the page's download
//          button, wait for evidence of the file, untick, next batch.
//   click  items with their own button (Add to zip and the like): press each
//          once, page by page, up to a limit.

import { collapse, normaliseText, numberIdentities, createRowReader, autoSource, learnedSource, isTicked, ROW_DEPTH } from "./rows.js";
import { LEDGER_PREFIX, ledgerKey, openStore, heldRow, pageCounts, ledgerCounts, siteLedgers, siteTotals, forgetSite, buildExport, owns } from "./ledger.js";
import { describeEvent, isFileEvidence, readSetting, shortUrl, resourceEvent, createTracer, isLoadMoreText, waitForGrowth, waitForQuiet, newWatch, observe, sinceLast, QUIET_MS, QUIET_CAP_MS } from "./evidence.js";
import { installWrappers, installStartWrappers } from "./wrappers.js";
import {
  startKey, readStart, writeStart, START_PREFIX, formatsKey, FORMATS_PREFIX, readFormats, writeFormats,
  wantsFormat, formatCounts, toggleFormat, describeFormats, zipAutoKey, ZIP_AUTO_PREFIX, readZipAuto, writeZipAuto,
  zipLimitKey, ZIP_LIMIT_PREFIX, readZipLimit, writeZipLimit, DEFAULT_ZIP_LIMIT, buttonKey, BUTTON_PREFIX,
  readButtonRecord, writeButtonRecord, targetKey, TARGET_PREFIX, readTargetRecord, writeTargetRecord,
} from "./settings.js";
import { labelOf, buttonWords, describeButton, locateButton, pickButton, describeUse, resolveTarget, describeTarget, matchesTarget, armCapture } from "./target.js";
import { wordsOf, isReady, untickChosen, takeSelection, rowsToSelect, selectAllLabel, tickAll, selectAllReport } from "./selection.js";
import {
  createRunner, createClickRunner, DEFAULT_BATCH, DEFAULT_TIMEOUT, DEFAULT_SETTLE, DEFAULT_RETRY_BATCH,
  isAddText, isInZipText, zipLedgerKey, openZipStore, zipCounts, zipAddedCount, zipSummary,
} from "./runner.js";
import { createBatchPanel, makeDraggable } from "./panel.js";
import { findNextControls } from "./pager.js";

// The mark left on a row once the ledger knows it, and on an item once handled.
const MARK = "data-qs-ledger";
const ZIP_MARK = "data-qs-zip";
const POSITION_KEY = "pz-batch position";

// Anything clickable-looking: a site may build its button from an anchor
// with a class or a div with a handler.
const CLICKABLE = 'button, a, input[type="submit"], [role="button"], [class*="button"], [class*="btn"]';
const LOAD_MORE_WAIT = 15;

// Click mode: one press every 0.3 s on add buttons (0.8 s on a picked item,
// whose site is unknown), up to 1.5 s for the page to show it took.
const ZIP_GAP = 0.3;
const PICKED_GAP = 0.8;
const ZIP_RESPONSE_MS = 1500;
const ZIP_LOOKS = 'button, a, [role="button"], input[type="button"], input[type="submit"], span, div, label, li';
const NEXT_WAIT_MS = 12000;
// The site's own count of its zip: "Zip download (16)", "16 items in your zip".
const HOLDS_TEXT = /zip[^()\d]{0,30}\(\s*(\d+)\s*\)|(\d+)\s*(items?|documents?|files?)?\s*in\s+(your\s+|the\s+)?zip/i;
const ZIP_LOOK = {
  added: ["3px solid #2e7d32", "Done"],
  refused: ["3px dashed #c62828", "Not clickable: do it by hand"],
  silent: ["3px dashed #e08a00", "Pressed, but nothing on the page changed"],
};
const TIMED_KINDS = ["fetch", "xmlhttprequest", "iframe", "frame", "other", "beacon", "navigation", ""];

function sleep(seconds) {
  return new Promise((done) => setTimeout(done, Math.round(seconds * 1000)));
}

function fileStamp(date) {
  const two = (number) => (number < 10 ? "0" : "") + number;
  return date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + "-"
    + two(date.getHours()) + two(date.getMinutes()) + two(date.getSeconds());
}

// An element counts as on the page unless truly hidden (display none, or
// inside something closed). Measuring boxes loses rows a long list leaves
// undrawn until scrolled to.
function onScreen(node) {
  if (!node) return false;
  if (typeof node.checkVisibility === "function") {
    try { return node.checkVisibility() === true; } catch { /* fall through */ }
  }
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0;
}

export function createBatchTool({ version = "0.0.0", pageWindow = window } = {}) {
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }

  const keyFor = (make, fallback) => { try { return make(location.href); } catch { return fallback; } };
  const isOurs = (node) => {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return !!(el && typeof el.closest === "function" && el.closest("[data-pz]"));
  };

  let opened = false;
  let view = null;
  let mode = "tick";
  let statusText = "Ready.";
  let detailsText = "";
  let batchSize = DEFAULT_BATCH;
  let resetArmed = 0;

  // ---- the item the person picked, and the reader built on it ----

  let targetRecord = readTargetRecord(storage, keyFor(targetKey, TARGET_PREFIX + "this site"));
  // A picked item is remembered for the whole site but takes over only on a
  // page where it matches something; elsewhere items are found automatically.
  let learnedHere = false;
  let reader = null;
  function makeReader() {
    learnedHere = !!targetRecord && learnedMatches().length > 0;
    const source = learnedHere && targetRecord.kind === "box"
      ? learnedSource(document, targetRecord, matchesTarget, isOurs)
      : autoSource(document, isOurs);
    reader = createRowReader(document, { now: () => Date.now(), source });
  }

  const liveRows = () => reader.rows();
  const insideRows = (node) => reader.insideRow(node);

  function learnedMatches() {
    if (!targetRecord) return [];
    return Array.from(document.getElementsByTagName(targetRecord.tag))
      .filter((el) => !isOurs(el) && matchesTarget(el, targetRecord));
  }
  makeReader();

  // ---- the ledger for the address on screen now ----

  const stores = new Map();
  function storeHere() {
    const key = keyFor(ledgerKey, LEDGER_PREFIX + "this page");
    if (!stores.has(key)) stores.set(key, openStore(storage, key));
    return stores.get(key);
  }
  let runStore = null;

  // ---- the page's download button and Load more ----

  function downloadCandidates() {
    return Array.from(document.querySelectorAll(CLICKABLE)).filter((each) => {
      if (!/download/i.test(each.textContent || each.value || "")) return false;
      if (isOurs(each) || insideRows(each) || !onScreen(each)) return false;
      const words = wordsOf(each);
      // "Download Centre" is navigation; "Download (10)" is the button.
      if (!/^download\b/i.test(words) || words.length > 24) return false;
      return !/centre|center/i.test(words);
    });
  }

  // The innermost: a button is often wrapped in a div with the same class.
  function downloadButton() {
    const all = downloadCandidates();
    const innermost = all.filter((each) => !all.some((other) => other !== each && each.contains(other)));
    return innermost[0] || all[0] || null;
  }

  // Only a control AFTER the last row: a list's own Load more sits below it,
  // a filter panel's "Show more" beside or above it.
  function loadMoreControl(live) {
    const last = live.length ? live[live.length - 1].row : null;
    if (!last || typeof last.compareDocumentPosition !== "function") return null;
    const all = Array.from(document.querySelectorAll(CLICKABLE)).filter((each) =>
      /more/i.test(each.textContent || each.value || "")
      && (last.compareDocumentPosition(each) & 4) !== 0
      && !isOurs(each) && !insideRows(each) && onScreen(each) && isLoadMoreText(wordsOf(each)));
    const innermost = all.filter((each) => !all.some((other) => other !== each && each.contains(other)));
    return innermost[0] || null;
  }

  let buttonRecord = readButtonRecord(storage, keyFor(buttonKey, BUTTON_PREFIX + "this site"));
  let buttonCache = null;

  function stillUsable(use) {
    const node = use && use.button;
    try {
      if (!node || node.isConnected === false || insideRows(node)) return false;
      if (use.source === "selected") return !!buttonRecord && buttonWords(labelOf(node)) === buttonRecord.words;
      return /^download\b/i.test(wordsOf(node));
    } catch {
      return false;
    }
  }

  // Kept and checked with one read while it stays on the page; searched for
  // afresh only when replaced, or after half a minute.
  function buttonInUse() {
    if (buttonCache && Date.now() - buttonCache.at < 30000 && stillUsable(buttonCache.use)) return buttonCache.use;
    const use = pickButton(buttonRecord, (record) => {
      const first = record.words.split(" ")[0];
      let candidates = [];
      try {
        candidates = Array.from(document.getElementsByTagName(record.chain[0].tag)).filter((node) => {
          const named = typeof node.getAttribute === "function"
            ? (node.getAttribute("aria-label") || "") + " " + (node.getAttribute("title") || "") : "";
          return normaliseText(String(node.textContent || node.value || "") + " " + named).indexOf(first) >= 0;
        });
      } catch { candidates = []; }
      return locateButton(record, candidates, (node) => !isOurs(node) && !insideRows(node) && onScreen(node));
    }, downloadButton);
    buttonCache = { use, at: Date.now() };
    return use;
  }

  function sayButtonInUse(lead = "") {
    const use = buttonInUse();
    say(lead + describeUse(use, use.button ? labelOf(use.button) : ""));
  }

  // ---- status, details, counts ----

  function say(words) {
    statusText = words;
    if (view) view.setStatus(words);
  }

  function setDetails(text, openIt = false) {
    detailsText = text || "";
    if (view) view.setDetails(detailsText, openIt);
  }

  function startAtNow() {
    return view && view.inputs.start ? readSetting(view.inputs.start.value, 1, 1, 1000000, true)
      : readStart(storage, keyFor(startKey, START_PREFIX + "this site"));
  }

  let formatChoice = readFormats(storage, keyFor(formatsKey, FORMATS_PREFIX + "this site"));

  function paintRows(rows, ledger) {
    for (const each of rows) {
      const held = heldRow(ledger, each.identity.id);
      const status = held ? held.status : "";
      if (each.row.getAttribute(MARK) === (status || null)) continue;
      if (!status) {
        each.row.style.opacity = "";
        each.row.style.outline = "";
        each.row.removeAttribute(MARK);
        continue;
      }
      each.row.style.opacity = status === "confirmed" ? "0.45" : "";
      each.row.style.outline = status === "confirmed" ? "" : "2px dashed #c40";
      each.row.setAttribute(MARK, status);
    }
  }

  function clearRowPaint() {
    for (const node of document.querySelectorAll("[" + MARK + "]")) {
      node.style.opacity = "";
      node.style.outline = "";
      node.removeAttribute(MARK);
    }
  }

  let countsAt = 0;
  let countsTimer = null;
  function countsSoon() {
    if (countsTimer || !opened) return;
    const wait = Math.max(0, countsAt + 1000 - Date.now());
    countsTimer = setTimeout(() => {
      countsTimer = null;
      try { showCounts(); } catch { /* the next change retries */ }
    }, wait);
  }

  // Confirmed and unconfirmed are for the whole ledger of this address (the
  // number to hold against the site's total); "to do" is for this page.
  function showCounts(rows) {
    if (!opened || !view) return;
    if (mode === "click") { zipShowCounts(); return; }
    countsAt = Date.now();
    const live = rows || liveRows();
    const store = runStore || storeHere();
    const ledger = store.read();
    const start = startAtNow();
    const scope = start > 1 ? live.slice(start - 1) : live;
    const ofType = scope.filter((each) => wantsFormat(formatChoice, each.identity.format));
    const counts = pageCounts(ofType.map((each) => each.identity), ledger);
    const all = ledgerCounts(ledger);
    const alone = scope.length - ofType.length;
    view.setCounts(`${live.length} rows · ${counts.todo} to do · ${all.confirmed} confirmed`
      + (all.unconfirmed ? ` · ${all.unconfirmed} unconfirmed` : "")
      + (alone ? ` · ${alone} other types` : "")
      + (storage && store.saved() ? "" : " · ⚠ not saving (storage blocked)"));
    paintRows(live, ledger);
    const shown = formatCounts(live.map((each) => each.identity));
    view.setTypes(shown.length > 1 || Array.isArray(formatChoice)
      ? shown.map((each) => ({ format: each.format, rows: each.rows, on: wantsFormat(formatChoice, each.format) }))
      : []);
    view.setSelectAll(selectAllLabel(rowsToSelect(live, formatChoice, start)));
  }

  // ---- watching the page while the panel is open ----

  let countWatch = null;
  function touchesBoxes(records) {
    const selector = learnedHere && targetRecord.kind === "box" ? targetRecord.tag
      : 'input[type="checkbox"], [role="checkbox"]';
    return records.some((record) => {
      if (isOurs(record.target)) return false;
      return [record.addedNodes, record.removedNodes].some((nodes) =>
        Array.prototype.some.call(nodes || [], (node) => {
          if (!node || node.nodeType !== 1) return false;
          try {
            return (typeof node.matches === "function" && node.matches(selector))
              || (typeof node.querySelector === "function" && node.querySelector(selector) !== null);
          } catch { return false; }
        }));
    });
  }

  function watchCounts() {
    if (countWatch || typeof MutationObserver !== "function") return;
    try {
      countWatch = new MutationObserver((records) => {
        try {
          noticeFrames(records);
          if (mode === "tick" && touchesBoxes(records)) countsSoon();
        } catch { /* the page is not to feel it */ }
      });
      countWatch.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch { countWatch = null; }
  }

  // ---- watching for the file ----

  let activeTag = null;   // the batch pressed most recently, while a run lasts
  let lastPress = null;   // that batch and when it was pressed
  let lastUse = null;     // the button the last selection check settled on
  let pressTiming = null; // the timings handed in with the last press
  let ownSave = false;    // true while the tool saves its own list
  let current = null;     // the batch whose file is being waited for
  let wrapped = null;     // what installWrappers managed, once it has run
  const seen = [];        // what the page did since the last press
  const tracer = createTracer(300);

  const sink = {
    tag: () => (ownSave ? null : activeTag),
    now: () => Date.now(),
    base: () => location.href,
    note: (event) => feed(event),
  };

  function noticeFrames(records) {
    if (activeTag === null) return;
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (node && node.nodeName === "IFRAME") {
          feed({ kind: "iframe", at: Date.now(), batch: activeTag, url: String(node.src || ""), via: "added" });
        }
      }
    }
  }

  function remember(event) {
    const line = describeEvent(event, location.href);
    if (!line) return;
    let stamp = "";
    if (lastPress && Number.isFinite(event.at)) stamp = "+" + Math.max(0, Math.round((event.at - lastPress.at) / 1000)) + "s ";
    const other = event.batch !== null && event.batch !== undefined && lastPress && event.batch !== lastPress.batch
      ? "(batch " + event.batch + ") " : "";
    seen.push(stamp + other + line);
    if (seen.length > 40) seen.splice(0, seen.length - 40);
  }

  // A file arriving for an EARLIER batch is noted against it as late and
  // never upgrades it: a second copy costs nothing, a wrong "confirmed"
  // costs the document.
  function feed(event) {
    if (!event) return;
    if (event.kind !== "clock") remember(event);
    if (activeTag !== null) tracer.note(event);
    if (event.kind === "response" && isFileEvidence(event) && event.batch !== null && event.batch !== undefined
      && !(current && current.watch.batch === event.batch)) {
      (runStore || storeHere()).noteLate(event.batch, describeEvent(event, location.href), new Date().toISOString());
    }
    if (current && current.watch.status === "waiting") {
      current.watch = observe(current.watch, event);
      if (current.watch.status !== "waiting") endWait();
    }
  }

  function endWait() {
    const finished = current;
    current = null;
    clearInterval(finished.timer);
    clearTimeout(finished.backstop);
    finished.resolve(finished.watch);
  }

  function showWaiting(watch) {
    const gone = Math.round((Date.now() - watch.pressedAt) / 1000);
    const allowed = Math.round((watch.deadline - watch.pressedAt) / 1000);
    say(`Batch ${watch.batch}: waiting for the file · ${gone}s of ${allowed}s`
      + (document.hidden ? " · tab in background, bring it to the front" : ""));
  }

  let resourceWatch = null;
  function watchResources(pressedAt) {
    stopResourceWatch();
    if (typeof PerformanceObserver !== "function" || typeof performance === "undefined") return;
    try {
      const pressPerf = performance.now();
      resourceWatch = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          try {
            if (TIMED_KINDS.indexOf(String(entry.initiatorType || "")) < 0) continue;
            feed(resourceEvent(entry, pressPerf, pressedAt));
          } catch { /* one odd entry is no reason to stop */ }
        }
      });
      resourceWatch.observe({ type: "resource", buffered: false });
    } catch { resourceWatch = null; }
  }

  function stopResourceWatch() {
    if (!resourceWatch) return;
    try { resourceWatch.disconnect(); } catch { /* nothing */ }
    resourceWatch = null;
  }

  function buttonState(node) {
    const state = { disabled: false, text: "", attached: true };
    try {
      state.disabled = !isReady(node);
      state.text = labelOf(node);
      state.attached = document.documentElement.contains(node);
    } catch { /* whatever could be read is kept */ }
    return state;
  }

  function pressAndWatch(node, batch, timeoutSeconds, timing) {
    return new Promise((resolve) => {
      seen.length = 0;
      activeTag = batch;
      lastPress = { batch, at: Date.now() };
      pressTiming = timing || null;
      tracer.start(batch, lastPress.at);
      if (timing) feed(Object.assign({ kind: "timing", at: lastPress.at, batch }, timing));
      watchResources(lastPress.at);
      let lastState = buttonState(node);
      feed(Object.assign({ kind: "button", at: lastPress.at, batch }, lastState));
      const limit = timeoutSeconds * 1000;
      const mine = {
        watch: newWatch(batch, lastPress.at, limit),
        // What the page did is shown only once a batch ends unconfirmed,
        // which is when it is worth reading.
        resolve(watch) {
          if (watch.status === "unconfirmed" && seen.length) {
            setDetails(`What the page did after batch ${batch} was pressed`
              + (pressTiming && sinceLast(pressTiming) ? ` (${sinceLast(pressTiming)})` : "") + ":\n"
              + seen.slice(-12).join("\n"));
          }
          resolve(watch);
        },
        timer: null,
        backstop: null,
      };
      current = mine;
      mine.timer = setInterval(() => {
        try {
          const state = buttonState(node);
          if (state.disabled !== lastState.disabled || state.text !== lastState.text || state.attached !== lastState.attached) {
            lastState = state;
            feed(Object.assign({ kind: "button", at: Date.now(), batch }, state));
          }
          feed({ kind: "clock", at: Date.now() });
          if (current === mine) showWaiting(mine.watch);
        } catch { /* the backstop still ends the wait */ }
      }, 500);
      // Should the bookkeeping ever fail to decide, the batch still ends,
      // unconfirmed.
      mine.backstop = setTimeout(() => {
        if (current === mine) {
          mine.watch = Object.assign({}, mine.watch, { status: "unconfirmed", reason: "timeout" });
          endWait();
        }
      }, limit + 5000);
      try {
        node.click();
      } catch (error) {
        if (current === mine) {
          mine.watch = Object.assign({}, mine.watch, { status: "unconfirmed", reason: "the press failed: " + (error && error.message) });
          endWait();
        }
      }
    });
  }

  // Put on at the first Play: focus round trips, visibility, link clicks by
  // event, form submits and unloads. Each only reports; none stops an event.
  let listening = false;
  function listenForHandOver() {
    if (listening) return;
    listening = true;
    const shown = () => document.visibilityState !== "hidden";
    const quietly = (work) => (event) => { try { work(event); } catch { /* the page is not to feel it */ } };
    window.addEventListener("blur", quietly((event) => {
      if (event && event.target !== window) return;
      feed({ kind: "blur", at: Date.now(), visible: shown() });
    }));
    window.addEventListener("focus", quietly((event) => {
      if (event && event.target !== window) return;
      let has = false;
      try { has = document.hasFocus() === true; } catch { has = false; }
      feed({ kind: "focus", at: Date.now(), hasFocus: has, visible: shown() });
    }));
    document.addEventListener("visibilitychange", quietly(() => feed({ kind: "visibility", at: Date.now(), visible: shown() })));
    window.addEventListener("beforeunload", quietly(() => feed({ kind: "unload", at: Date.now() })));
    document.addEventListener("click", quietly((event) => {
      if (activeTag === null || ownSave || !event || !event.target || typeof event.target.closest !== "function") return;
      const link = event.target.closest("a[href]");
      if (!link || isOurs(link)) return;
      feed({ kind: "anchor", at: Date.now(), batch: activeTag, href: String(link.href || ""),
        download: String(link.getAttribute("download") || ""), via: "event" });
    }), true);
    document.addEventListener("submit", quietly((event) => {
      if (activeTag === null || !event) return;
      const form = event.target || {};
      feed({ kind: "submit", at: Date.now(), batch: activeTag, url: String(form.action || ""),
        method: String(form.method || "get").toUpperCase(), via: "submit event" });
    }), true);
  }

  // The page's last change, for the quiet before a press. Our own marks and
  // UI are not counted.
  let pageChangedAt = 0;
  let quietWatch = null;
  function watchQuiet() {
    if (quietWatch || typeof MutationObserver !== "function") return;
    try {
      quietWatch = new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target;
          if (!target || isOurs(target)) continue;
          if (record.type === "attributes" && (record.attributeName === MARK
            || (record.attributeName === "style" && typeof target.hasAttribute === "function" && target.hasAttribute(MARK)))) {
            continue;
          }
          pageChangedAt = Date.now();
          return;
        }
      });
      quietWatch.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch { quietWatch = null; }
  }

  function stopQuietWatch() {
    if (!quietWatch) return;
    try { quietWatch.disconnect(); } catch { /* nothing */ }
    quietWatch = null;
  }

  // What a page with no rows holds, for Details: its boxes, any element
  // acting as one, and why a few boxes were not read as rows.
  function explainNoRows() {
    const boxes = Array.prototype.filter.call(document.querySelectorAll('input[type="checkbox"]'), (box) => !isOurs(box));
    const acting = Array.prototype.filter.call(document.querySelectorAll('[role="checkbox"], [aria-checked]'),
      (node) => !isOurs(node) && node.nodeName !== "INPUT");
    const lines = [`The page has ${boxes.length} checkbox(es)`
      + (acting.length ? ` and ${acting.length} other element(s) acting as checkboxes` : "") + "."];
    const picked = [0, 1, Math.floor(boxes.length / 2), boxes.length - 1]
      .filter((at, index, all) => at >= 0 && at < boxes.length && all.indexOf(at) === index);
    for (const at of picked) lines.push(`Box ${at + 1}: ${reader.explain(boxes[at])}`);
    if (acting.length) {
      lines.push(`First acting checkbox: <${String(acting[0].nodeName).toLowerCase()} class="`
        + String(acting[0].getAttribute("class") || "").slice(0, 60) + '">');
    }
    lines.push("If the rows are there, use Pick item and click one of their checkboxes.");
    setDetails(lines.join("\n"));
    return "Use Pick item, or see Details.";
  }

  const page = {
    rows: liveRows,
    take: (chosen, halted) => takeSelection(chosen, {
      rows: liveRows,
      locate: reader.locate,
      checked: reader.checked,
      button: () => { lastUse = buttonInUse(); return lastUse.button; },
      sleep,
      now: () => Date.now(),
      halted,
    }),
    press: pressAndWatch,
    abortWait: () => { if (current) feed({ kind: "stop", at: Date.now() }); },
    untick: (chosen) => untickChosen(chosen, { rows: liveRows }),
    // A styled checkbox may be hidden behind its label: the row showing is enough.
    usable: (row) => row.box.disabled !== true && (onScreen(row.box) || onScreen(row.row)),
    quiet: (halted) => waitForQuiet(() => pageChangedAt, Date.now(), () => Date.now(), sleep, QUIET_MS, QUIET_CAP_MS, halted),
    explainNoRows,
    async loadMore(halted) {
      const live = reader.last().length ? reader.last() : liveRows();
      const control = loadMoreControl(live);
      if (!control || !isReady(control)) return { pressed: false, grew: false, before: live.length, after: live.length };
      // Growth is judged by the page's boxes, counted without reading a row.
      const boxCount = () => reader.source.boxes().length;
      const before = boxCount();
      say(`Pressing "${wordsOf(control).slice(0, 30)}"…`);
      control.click();
      const grown = await waitForGrowth(boxCount, before, sleep, () => Date.now(), LOAD_MORE_WAIT * 1000, halted);
      countsSoon();
      return { pressed: true, grew: grown.grew, before, after: grown.after };
    },
  };

  function saveText(text, name) {
    // Our own file is not a page's download: the wrappers look away.
    ownSave = true;
    try {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      link.download = name;
      link.style.display = "none";
      (document.body || document.documentElement).appendChild(link);
      link.click();
      link.remove();
      const made = link.href;
      setTimeout(() => { try { URL.revokeObjectURL(made); } catch { /* nothing */ } }, 30000);
    } finally {
      ownSave = false;
    }
  }

  // Every ledger kept for the site, not only the one on screen.
  function saveExport() {
    storeHere();
    const ledgers = siteLedgers(storage, stores, LEDGER_PREFIX);
    const now = new Date();
    const out = buildExport(ledgers, {
      at: now.toISOString(), origin: location.origin, script: `popup-zapper ${version} batch clicker`, traces: tracer.all(),
    });
    if (!out.totals.confirmed && !out.totals.unconfirmed) return "";
    const name = `document-ledger-${location.hostname || "page"}-${fileStamp(now)}.json`;
    saveText(JSON.stringify(out, null, 2), name);
    return name;
  }

  const runner = createRunner({
    store: () => { runStore = storeHere(); return runStore; },
    page,
    settings: () => ({
      size: view && view.inputs.size ? readSetting(view.inputs.size.value, DEFAULT_BATCH, 1, 50, true) : batchSize,
      startAt: startAtNow(),
      retrySize: DEFAULT_RETRY_BATCH,
      timeout: DEFAULT_TIMEOUT,
      settle: DEFAULT_SETTLE,
    }),
    sleep,
    now: () => Date.now(),
    iso: () => new Date().toISOString(),
    where: () => (location.search + location.hash).slice(0, 200),
    say,
    showState: (state) => { if (view) view.setPlay(state); },
    refresh: countsSoon,
    siteDocuments: () => { storeHere(); return siteTotals(storage, stores, LEDGER_PREFIX).documents; },
    saveExport,
    forgetSite: () => { storeHere(); return forgetSite(storage, stores, LEDGER_PREFIX); },
    confirm: () => true,
    formats: () => formatChoice,
    // The wrappers go on at the first Play, never at load: until a run
    // begins, the tool changes nothing on any site.
    begin() {
      setDetails("");
      if (!wrapped) {
        wrapped = installWrappers(pageWindow, sink);
        installStartWrappers(pageWindow, sink);
      }
      listenForHandOver();
      watchCounts();
      watchQuiet();
    },
    end() {
      activeTag = null;
      runStore = null;
      stopResourceWatch();
      stopQuietWatch();
      if (current) {
        clearInterval(current.timer);
        clearTimeout(current.backstop);
        current = null;
      }
    },
  });

  // ---- click mode ----

  // Controls: by their words on automatic (an add control or a done one),
  // or every match of the picked item.
  function clickControls() {
    if (learnedHere && targetRecord.kind === "button") return learnedMatches();
    let nodes = [];
    try { nodes = document.querySelectorAll(ZIP_LOOKS); } catch { nodes = []; }
    const found = [];
    for (const node of nodes) {
      const raw = String(node.textContent || node.value || "");
      if (raw.length > 60 || isOurs(node)) continue;
      if (!isAddText(raw) && !isInZipText(raw)) continue;
      const control = typeof node.closest === "function" ? node.closest('button, a, [role="button"], input') || node : node;
      if (found.indexOf(control) < 0 && !isOurs(control)) found.push(control);
    }
    return found.filter((each) => !found.some((other) => other !== each && each.contains(other)));
  }

  // A card is the largest element above a control that holds no other; its
  // identity is its title with the address of its own link.
  function zipCards() {
    const controls = clickControls();
    const raw = controls.map((control) => {
      let node = control;
      for (let step = 0; step < ROW_DEPTH; step++) {
        const up = node.parentElement;
        if (!up || up === document.body || up === document.documentElement) break;
        if (controls.filter((each) => up.contains(each)).length > 1) break;
        node = up;
      }
      const title = collapse(String(node.textContent || "").replace(String(control.textContent || ""), " ")) || "(no title)";
      let href = "";
      try {
        const link = node.querySelector("a[href]");
        href = link && link !== control && !/^javascript:/i.test(link.href) ? shortUrl(link.href, location.href) : "";
      } catch { href = ""; }
      return { node, control, title: title.slice(0, 200), id: normaliseText(title) + (href ? " | " + href : "") };
    });
    const ids = numberIdentities(raw.map((each) => ({ id: each.id })));
    return raw.map((each, at) => {
      const card = { id: ids[at].id, title: each.title, node: each.node, control: each.control };
      card.words = () => {
        const live = liveControl(card);
        return live ? labelOf(live) || String(live.textContent || "") : "";
      };
      card.clickable = () => zipClickable(liveControl(card));
      return card;
    });
  }

  function liveControl(card) {
    if (card.control && card.control.isConnected !== false) return card.control;
    if (card.node && card.node.isConnected !== false) {
      const inside = clickControls().filter((each) => card.node.contains(each));
      if (inside.length) { card.control = inside[0]; return card.control; }
    }
    const again = zipCards().filter((each) => each.id === card.id)[0];
    if (again) { card.node = again.node; card.control = again.control; return card.control; }
    return null;
  }

  function zipClickable(control) {
    if (!control || control.isConnected === false || !isReady(control)) return false;
    if (/(^|\s)(is-)?disabled(\s|$)/i.test(String(control.getAttribute ? control.getAttribute("class") || "" : ""))) return false;
    try {
      const style = window.getComputedStyle(control);
      if (style.pointerEvents === "none" || style.visibility === "hidden") return false;
    } catch { /* fall through */ }
    return onScreen(control);
  }

  // Whether an item is still to click, already done, or neither. A picked
  // item is ready while it reads as it did when picked (when its siblings
  // shared those words), done once pressed or reading as done.
  function itemState(card) {
    const live = liveControl(card);
    if (!live) return "other";
    const words = labelOf(live) || String(live.textContent || "");
    if (isInZipText(words)) return "in";
    if (!learnedHere || targetRecord.kind !== "button") return isAddText(words) ? "ready" : "other";
    const said = live.getAttribute && (live.getAttribute("aria-pressed") || live.getAttribute("aria-checked"));
    if (said === "true") return "in";
    return !targetRecord.words || buttonWords(words) === targetRecord.words ? "ready" : "other";
  }

  // Anything outside the cards naming a zip or basket with a number in it.
  function zipCounter() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[class*="zip"], [class*="basket"], [class*="count"], [class*="badge"], [id*="zip"], [id*="basket"]');
    } catch { nodes = []; }
    return Array.prototype.filter.call(nodes, (node) => {
      const text = String(node.textContent || "");
      return !isOurs(node) && text.length <= 40 && /\d/.test(text);
    }).map((node) => collapse(node.textContent)).join(" | ");
  }

  // A press took when, within 1.5 s, the button reads as done, the card
  // changed, or the page's own count changed. Else it was silent.
  function pressZip(card) {
    return new Promise((resolve) => {
      const control = liveControl(card);
      const before = { inner: card.node.innerHTML, cls: String(card.node.className), counter: zipCounter() };
      try {
        control.click();
      } catch (error) {
        resolve({ added: false, why: "the press failed: " + (error && error.message) });
        return;
      }
      const start = Date.now();
      const look = () => {
        try {
          if (itemState(card) === "in") { resolve({ added: true, why: `now reads "${collapse(card.words())}"` }); return; }
          if (card.node.isConnected !== false && (card.node.innerHTML !== before.inner || String(card.node.className) !== before.cls)) {
            resolve({ added: true, why: "the item changed when pressed" });
            return;
          }
          const counter = zipCounter();
          if (counter !== before.counter) { resolve({ added: true, why: "the count changed: " + counter.slice(0, 60) }); return; }
        } catch { /* looked at again below */ }
        if (Date.now() - start >= ZIP_RESPONSE_MS) { resolve({ added: false, why: "nothing on the page changed" }); return; }
        setTimeout(look, 50);
      };
      setTimeout(look, 50);
    });
  }

  function paintZip(card, status) {
    const node = card && card.node;
    const look = ZIP_LOOK[status];
    if (!node || !node.style || !look || node.getAttribute(ZIP_MARK) === status) return;
    node.style.outline = look[0];
    node.style.outlineOffset = "-3px";
    node.setAttribute(ZIP_MARK, status);
    node.setAttribute("title", look[1]);
  }

  function clearZipPaint() {
    for (const node of document.querySelectorAll("[" + ZIP_MARK + "]")) {
      node.style.outline = "";
      node.style.outlineOffset = "";
      node.removeAttribute(ZIP_MARK);
      node.removeAttribute("title");
    }
  }

  const zipStores = new Map();
  function zipStoreHere() {
    const key = keyFor(zipLedgerKey, "qs-intelligence zip ledger this page");
    if (!zipStores.has(key)) zipStores.set(key, openZipStore(storage, key));
    return zipStores.get(key);
  }

  function zipShowCounts() {
    if (!opened || !view || mode !== "click") return;
    const cards = zipCards();
    const store = zipStoreHere();
    const ledger = store.read();
    for (const card of cards) {
      const held = owns(ledger.cards, card.id) ? ledger.cards[card.id] : null;
      if (held) paintZip(card, held.status);
      else if (itemState(card) === "in") paintZip(card, "added");
    }
    view.setCounts(zipSummary(zipCounts(cards, ledger, (card) => itemState(card) === "in"), zipAddedCount(ledger))
      + (storage && store.saved() ? "" : " · ⚠ not saving (storage blocked)"));
    // Every item on the site that could not be done, not only this page's,
    // since the run moves on past them.
    const odd = Object.keys(ledger.cards).filter((id) => ledger.cards[id].status !== "added").map((id) => {
      const held = ledger.cards[id];
      return (held.status === "refused" ? "not clickable   " : "no change       ") + String(held.title || id).slice(0, 80);
    });
    if (!odd.length && detailsText.startsWith("Do these by hand")) setDetails("");
    else if (odd.length) setDetails("Do these by hand:\n" + odd.join("\n"));
  }

  // The next page after the last card; see pager.js.
  function nextControls() {
    const cards = zipCards();
    const lastCard = cards.length ? cards[cards.length - 1].node : null;
    return findNextControls(document, lastCard, { isOurs, onScreen, win: window });
  }

  const cardSignature = () => zipCards().map((card) => card.id).join("\n");

  // Press the next page and wait for its cards; a candidate that changes
  // nothing gives way to the next. A page that reloads never answers here:
  // the auto mark carries the run on in the new page.
  function turnPage() {
    const found = nextControls().filter((each) => zipClickable(each.control));
    if (!found.length) {
      return Promise.resolve({ pressed: false, why: nextControls().length ? "the next page button is disabled" : "nothing leads further" });
    }
    const before = cardSignature();
    const tryOne = (at) => new Promise((resolve) => {
      const one = found[at];
      say(`Page done; next page (${one.how})…`);
      try { one.control.click(); } catch { resolve(false); return; }
      const start = Date.now();
      const look = () => {
        let now = "";
        try { now = cardSignature(); } catch { now = ""; }
        if (now && now !== before) { setTimeout(() => resolve(true), 600); return; }
        if (Date.now() - start >= NEXT_WAIT_MS) { resolve(false); return; }
        setTimeout(look, 250);
      };
      setTimeout(look, 250);
    });
    return (async () => {
      for (let at = 0; at < found.length && at < 2; at++) {
        if (await tryOne(at)) return { pressed: true, changed: true, how: found[at].how };
      }
      return { pressed: true, changed: false };
    })();
  }

  function zipHolds() {
    let nodes = [];
    try { nodes = document.querySelectorAll('button, a, [role="button"], span, div'); } catch { nodes = []; }
    for (const node of nodes) {
      const text = String(node.textContent || "");
      if (text.length > 40 || isOurs(node)) continue;
      const found = HOLDS_TEXT.exec(collapse(text));
      if (found) return Number(found[1] || found[2]);
    }
    return null;
  }

  const zipLimitNow = () => (view && view.inputs.limit
    ? readSetting(view.inputs.limit.value, DEFAULT_ZIP_LIMIT, 1, 100000, true)
    : readZipLimit(storage, keyFor(zipLimitKey, ZIP_LIMIT_PREFIX + "this site")));
  const autoKey = () => keyFor(zipAutoKey, ZIP_AUTO_PREFIX + "this site");

  const zipRunner = createClickRunner({
    page: { cards: zipCards, press: pressZip, paint: paintZip, next: turnPage, state: itemState },
    get store() { return zipStoreHere(); },
    sleep,
    get gap() { return learnedHere ? PICKED_GAP : ZIP_GAP; },
    iso: () => new Date().toISOString(),
    where: () => (location.search + location.hash).slice(0, 200),
    say,
    showState: (state) => { if (view) view.setPlay(state); },
    setAuto: (on) => writeZipAuto(storage, autoKey(), on, Date.now()),
    refresh: zipShowCounts,
    confirm: () => true,
    limit: zipLimitNow,
    zipHolds,
  });

  // A change that brings new items (the next page drawn in place) goes to
  // the run; any change redraws the counts, at most every 0.4 s.
  let zipWatch = null;
  let zipSoon = null;
  let zipIds = "";
  function watchZip() {
    if (zipWatch || typeof MutationObserver !== "function") return;
    try {
      zipWatch = new MutationObserver((records) => {
        if (records.every((record) => isOurs(record.target)) || zipSoon) return;
        zipSoon = setTimeout(() => {
          zipSoon = null;
          try {
            if (mode !== "click") return;
            const ids = cardSignature();
            const changed = ids !== zipIds;
            zipIds = ids;
            zipShowCounts();
            if (changed) zipRunner.pageChanged();
          } catch { /* the next change tries again */ }
        }, 400);
      });
      zipWatch.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch { zipWatch = null; }
  }

  // ---- picking: the item to click many of, and the download button ----

  let picking = null;
  let disarmPick = null;
  let hovered = null;

  function unhover() {
    if (hovered) { hovered.el.style.outline = hovered.was; hovered = null; }
  }

  function onHover(event) {
    if (!event || isOurs(event.target)) { unhover(); return; }
    const found = picking === "item" ? resolveTarget(event.target) : null;
    const el = found ? found.node : (event.target && event.target.closest ? event.target.closest(CLICKABLE) || event.target : null);
    if (!el || (hovered && hovered.el === el)) return;
    unhover();
    hovered = { el, was: el.style.outline };
    el.style.outline = "2px dashed #ff3b30";
  }

  function stopPicking() {
    if (disarmPick) { disarmPick(); disarmPick = null; }
    if (picking) document.removeEventListener("mouseover", onHover, true);
    unhover();
    picking = null;
    labelPickers();
  }

  function labelPickers() {
    if (!view) return;
    view.setPickItem(picking === "item" ? "Cancel picking"
      : !targetRecord ? "☐ Pick item"
        : learnedHere ? `☑ Item: ${targetRecord.kind === "box" ? "checkbox" : "button"}` : "☑ Item (not on this page)",
    !!targetRecord && picking !== "item");
    view.setPickButton(picking === "button" ? "Cancel picking" : buttonRecord ? "⬇ Download button ✓" : "⬇ Download button");
  }

  function startPicking(kind, picked) {
    picking = kind;
    labelPickers();
    document.addEventListener("mouseover", onHover, true);
    disarmPick = armCapture(window, isOurs, (target) => {
      stopPicking();
      picked(target);
    });
  }

  function busy() {
    return runner.state() !== "idle" || zipRunner.state() !== "idle" || selectingAll;
  }

  // Outline every match for a moment, so the person sees what was learned.
  function flash(nodes) {
    const held = nodes.slice(0, 500).map((node) => ({ node, was: node.style.outline }));
    for (const each of held) each.node.style.outline = "2px solid #2e7d32";
    setTimeout(() => { for (const each of held) each.node.style.outline = each.was; }, 1600);
  }

  function learnItem(target) {
    const found = resolveTarget(target);
    if (!found) { say("Nothing there to learn."); return; }
    const record = describeTarget(found.node, found.kind);
    if (!record.chain.length) { say("That can't be found again. Pick something inside the page."); return; }
    const matches = Array.from(document.getElementsByTagName(record.tag)).filter((el) => !isOurs(el) && matchesTarget(el, record));
    // Words count only when most matches share them (per-file links differ).
    if (record.kind === "button" && record.words) {
      const same = matches.filter((el) => buttonWords(labelOf(el)) === record.words).length;
      if (same < Math.max(2, Math.ceil(matches.length / 2))) record.words = "";
    }
    targetRecord = record;
    const kept = writeTargetRecord(storage, keyFor(targetKey, TARGET_PREFIX + "this site"), record);
    clearRowPaint();
    clearZipPaint();
    makeReader();
    rebuild();
    flash(matches);
    say(`Learned: ${matches.length} matching ${record.kind === "box" ? "checkbox(es)" : "button(s)"}.`
      + (record.link ? " They are plain links, so clicking each may open pages." : "")
      + (kept ? "" : " Storage refused, so it lasts until reload."));
  }

  function pickItem() {
    if (picking === "item") { stopPicking(); say("Picking cancelled."); return; }
    if (busy()) { say("Stop the run first."); return; }
    stopPicking();
    say("Click one of the things to click many of: a checkbox or a button.");
    startPicking("item", learnItem);
  }

  function setKind(kind) {
    if (busy()) { say("Stop the run first."); return; }
    if (!targetRecord || (kind !== "box" && kind !== "button")) return;
    targetRecord = Object.assign({}, targetRecord, { kind });
    writeTargetRecord(storage, keyFor(targetKey, TARGET_PREFIX + "this site"), targetRecord);
    clearRowPaint();
    clearZipPaint();
    makeReader();
    rebuild();
    say(kind === "box" ? "Ticking these in batches." : "Clicking each of these once.");
  }

  function forgetItem() {
    if (busy()) { say("Stop the run first."); return; }
    stopPicking();
    targetRecord = null;
    writeTargetRecord(storage, keyFor(targetKey, TARGET_PREFIX + "this site"), null);
    clearRowPaint();
    clearZipPaint();
    makeReader();
    rebuild();
    say("Forgot the picked item; finding items automatically.");
  }

  // A click inside a row, or on something with no words, is refused: a
  // row's own icon would fetch one document, not the batch.
  function chosenAsButton(target) {
    if (!target) return;
    const node = typeof target.closest === "function" ? target.closest(CLICKABLE) || target : target;
    liveRows();
    if (insideRows(node)) { say("That is inside a row. Pick the page's own download button."); return; }
    const record = describeButton(node);
    if (!record.words) { say("That has no words to find it by. Pick the download button itself."); return; }
    buttonRecord = record;
    buttonCache = null;
    const kept = writeButtonRecord(storage, keyFor(buttonKey, BUTTON_PREFIX + "this site"), record);
    try { node.style.outline = "3px solid #c40"; } catch { /* nothing */ }
    labelPickers();
    sayButtonInUse(kept ? "" : "Storage refused, so it lasts until reload. ");
  }

  function pickDownloadButton() {
    if (picking === "button") { stopPicking(); sayButtonInUse("Picking cancelled. "); return; }
    if (busy()) { say("Stop the run first."); return; }
    stopPicking();
    say("Click the page's own download button. That click is kept from the page.");
    startPicking("button", chosenAsButton);
  }

  // ---- the panel's own controls ----

  let selectingAll = false;
  function selectAll() {
    stopPicking();
    if (selectingAll) return;
    if (runner.state() !== "idle") { say("Pause or Stop the run first."); return; }
    selectingAll = true;
    (async () => {
      try {
        const done = tickAll(rowsToSelect(liveRows(), formatChoice, startAtNow()), page.usable);
        if (done.changed) await sleep(0.5);
        const live = liveRows();
        const kept = rowsToSelect(live, formatChoice, startAtNow()).filter((each) => isTicked(each.box)).length;
        const use = buttonInUse();
        say(selectAllReport(done, kept, use.button ? labelOf(use.button) : ""));
        showCounts(live);
      } catch (error) {
        say("Select all stopped on a script fault: " + (error && error.message ? error.message : String(error)) + ".");
      } finally {
        selectingAll = false;
      }
    })();
  }

  function play() {
    stopPicking();
    if (mode === "click") { zipRunner.play(); return; }
    if (runner.state() === "running") runner.pause();
    else runner.play();
  }

  function stop() {
    stopPicking();
    if (mode === "click") zipRunner.stop();
    else runner.stop();
  }

  // Reset asks by a second press within four seconds, not a browser dialog.
  function reset() {
    stopPicking();
    const active = mode === "click" ? zipRunner : runner;
    if (active.state() !== "idle") { say("Stop the run before Reset."); return; }
    const count = mode === "click" ? Object.keys(zipStoreHere().read().cards).length
      : (storeHere(), siteTotals(storage, stores, LEDGER_PREFIX).documents);
    if (!count) { say(mode === "click" ? "The click ledger is already empty." : "The ledger is already empty."); return; }
    if (Date.now() > resetArmed) {
      resetArmed = Date.now() + 4000;
      if (view) view.setReset("Confirm reset?");
      say(`Press again to forget ${count} ${mode === "click" ? "item(s)" : "document(s)"} on this site.`);
      setTimeout(() => { if (view && Date.now() > resetArmed) view.setReset("↺ Reset"); }, 4100);
      return;
    }
    resetArmed = 0;
    if (view) view.setReset("↺ Reset");
    if (active.reset()) {
      if (mode === "click") clearZipPaint();
      else clearRowPaint();
    }
    showCounts();
  }

  function setSize(value) {
    batchSize = readSetting(value, DEFAULT_BATCH, 1, 50, true);
    if (view && view.inputs.size) view.inputs.size.value = String(batchSize);
  }

  function setStart(value) {
    const start = readSetting(value, 1, 1, 1000000, true);
    if (view && view.inputs.start) view.inputs.start.value = String(start);
    const kept = writeStart(storage, keyFor(startKey, START_PREFIX + "this site"), start);
    showCounts();
    say((start > 1 ? `Runs start at row ${start}.` : "Runs start at the first row.") + (kept ? "" : " Storage refused; lasts until reload."));
  }

  function setLimit(value) {
    const limit = readSetting(value, DEFAULT_ZIP_LIMIT, 1, 100000, true);
    if (view && view.inputs.limit) view.inputs.limit.value = String(limit);
    const kept = writeZipLimit(storage, keyFor(zipLimitKey, ZIP_LIMIT_PREFIX + "this site"), limit);
    say(`Stops after ${limit}.` + (kept ? "" : " Storage refused; lasts until reload."));
  }

  // A switch flipped mid-run counts from the next batch.
  function flipType(format) {
    const shown = formatCounts(reader.last().map((each) => each.identity)).map((each) => each.format);
    formatChoice = toggleFormat(formatChoice, format, shown);
    const kept = writeFormats(storage, keyFor(formatsKey, FORMATS_PREFIX + "this site"), formatChoice);
    showCounts();
    say(describeFormats(formatChoice) + (runner.state() === "idle" ? "" : " From the next batch.")
      + (kept ? "" : " Storage refused; lasts until reload."));
  }

  // ---- opening, closing, drawing ----

  function readPosition() {
    try {
      const held = JSON.parse((storage && storage.getItem(POSITION_KEY)) || "null");
      if (held && Number.isFinite(held.left) && Number.isFinite(held.top)
        && held.left < window.innerWidth - 40 && held.top < window.innerHeight - 30) {
        return held;
      }
    } catch { /* default spot */ }
    return null;
  }

  function savePosition(spot) {
    try { if (storage) storage.setItem(POSITION_KEY, JSON.stringify(spot)); } catch { /* nothing */ }
  }

  function decideMode() {
    if (learnedHere) return targetRecord.kind === "box" ? "tick" : "click";
    if (liveRows().length) return "tick";
    if (clickControls().length) return "click";
    return "tick";
  }

  function build() {
    view = createBatchPanel({
      mode,
      kind: learnedHere ? targetRecord.kind : null,
      onKind: setKind,
      batchSize,
      startAt: readStart(storage, keyFor(startKey, START_PREFIX + "this site")),
      limit: readZipLimit(storage, keyFor(zipLimitKey, ZIP_LIMIT_PREFIX + "this site")),
      position: readPosition(),
      onClose: close,
      onPlay: play,
      onStop: stop,
      onReset: reset,
      onPickItem: pickItem,
      onForgetItem: forgetItem,
      onPickButton: pickDownloadButton,
      onSelectAll: selectAll,
      onSize: setSize,
      onStart: setStart,
      onLimit: setLimit,
      onType: flipType,
    });
    (document.body || document.documentElement).appendChild(view.el);
    makeDraggable(view.el, view.head, savePosition);
    view.setPlay(mode === "click" ? zipRunner.state() : runner.state());
    view.setStatus(statusText);
    view.setDetails(detailsText);
    labelPickers();
  }

  function rebuild() {
    if (!opened) return;
    makeReader();
    const nextMode = decideMode();
    if (view) view.el.remove();
    mode = nextMode;
    build();
    if (mode === "click") {
      clearRowPaint();
      zipIds = cardSignature();
      watchZip();
    } else {
      clearZipPaint();
      watchCounts();
    }
    showCounts();
  }

  function first() {
    if (mode === "click") {
      const cards = zipCards().length;
      say(cards ? `${cards} item(s) to click. Play clicks each, page by page.` : "No items found. Use Pick item.");
    } else {
      const rows = reader.last().length;
      if (rows) sayButtonInUse(`${rows} row(s). `);
      else say("No rows found yet. Use Pick item, or wait for the page to draw them.");
    }
  }

  let rescans = [];
  function open() {
    if (opened) return;
    opened = true;
    makeReader();
    mode = decideMode();
    statusText = "Ready.";
    detailsText = "";
    build();
    if (mode === "click") { zipIds = cardSignature(); watchZip(); } else watchCounts();
    showCounts();
    first();
    // A page that draws its rows late is looked at again at 1.5, 4 and 8 s.
    rescans = [1500, 4000, 8000].map((wait) => setTimeout(() => {
      try {
        if (!opened || busy() || picking) return;
        const was = { mode, learnedHere };
        makeReader();
        const now = decideMode();
        if (now !== was.mode || learnedHere !== was.learnedHere) { rebuild(); first(); }
        else { showCounts(); if (/^No (rows|items) found/.test(statusText)) first(); }
      } catch { /* the page is not to feel it */ }
    }, wait));
  }

  function close() {
    if (!opened) return true;
    if (busy()) { say("Stop the run first, then close."); return false; }
    stopPicking();
    for (const timer of rescans) clearTimeout(timer);
    rescans = [];
    if (countWatch) { try { countWatch.disconnect(); } catch { /* nothing */ } countWatch = null; }
    if (zipWatch) { try { zipWatch.disconnect(); } catch { /* nothing */ } zipWatch = null; }
    clearTimeout(countsTimer);
    countsTimer = null;
    clearRowPaint();
    clearZipPaint();
    if (view) view.el.remove();
    view = null;
    opened = false;
    return true;
  }

  // Theme changes redraw the panel in place, keeping its status.
  function repaint() {
    if (!opened) return;
    if (view) view.el.remove();
    build();
    showCounts();
  }

  // A click run left on carries on across pages and reloads (two hours from
  // the last page): reopen and press Play once its items are drawn.
  function resume() {
    if (!readZipAuto(storage, autoKey(), Date.now())) return false;
    open();
    const tryPlay = () => {
      if (!opened || zipRunner.state() !== "idle" || !readZipAuto(storage, autoKey(), Date.now())) return;
      if (mode !== "click") { mode = decideMode(); if (mode === "click") rebuild(); }
      if (mode === "click" && zipCards().length) { say("Carrying on from the last page."); zipRunner.play(); }
    };
    tryPlay();
    for (const wait of [1500, 4000, 8000]) setTimeout(tryPlay, wait);
    return true;
  }

  return {
    open,
    close,
    toggle: () => (opened ? close() : (open(), true)),
    isOpen: () => opened,
    repaint,
    resume,
  };
}
