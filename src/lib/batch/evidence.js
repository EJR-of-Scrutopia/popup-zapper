// Whether a pressed batch's file was handed over: the page's answers, the
// browser's own timings, the Save window round trip, and the watch that turns
// a stream of events into confirmed or unconfirmed.

import { collapse } from "./rows.js";

// Beyond zip, octet-stream and pdf, the variants servers really send count too,
// and so do force-download and x-download, which exist only to mean "download".
const FILE_TYPES = [
  "application/zip", "application/x-zip", "application/x-zip-compressed",
  "application/octet-stream", "binary/octet-stream",
  "application/pdf", "application/x-pdf",
  "application/force-download", "application/x-download",
];

export function headersFromRaw(raw) {
  const out = { contentType: "", disposition: "" };
  for (const line of String(raw == null ? "" : raw).split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "content-type" && !out.contentType) out.contentType = value;
    if (name === "content-disposition" && !out.disposition) out.disposition = value;
  }
  return out;
}

// A response hands over a file when it succeeded and calls itself an
// attachment or carries a file's type.
export function isFileResponse(response) {
  const head = response || {};
  const status = typeof head.status === "number" ? head.status : Number(head.status);
  if (!(Number.isInteger(status) && status >= 200 && status <= 299)) return false;
  if (/^attachment\b/i.test(collapse(head.disposition))) return true;
  const type = collapse(String(head.contentType == null ? "" : head.contentType).split(";")[0]).toLowerCase();
  return FILE_TYPES.indexOf(type) >= 0;
}

// A file arriving (headers in) or arrived (last byte in). A HEAD request never
// counts: it asks about a file without fetching it.
export function isFileEvidence(event) {
  return !!event && (event.kind === "response" || event.kind === "incoming")
    && event.failed !== true && event.method !== "HEAD" && isFileResponse(event);
}

export function countFromButtonText(text) {
  const words = collapse(text);
  const bracketed = words.match(/\(\s*(\d+)\s*\)/);
  if (bracketed) return Number(bracketed[1]);
  const bare = words.match(/\b(\d+)\b/);
  return bare ? Number(bare[1]) : null;
}

export function readSetting(text, fallback, least, most, whole) {
  const value = parseFloat(String(text == null ? "" : text).trim());
  if (!Number.isFinite(value)) return fallback;
  const kept = whole ? Math.floor(value) : value;
  return Math.min(most, Math.max(least, kept));
}

// An address keeps its host and path and loses its query and fragment: a
// signed download link carries its token there, and the ledger is handed on.
export function shortUrl(url, base) {
  const text = String(url == null ? "" : url);
  if (/^blob:/i.test(text)) {
    const inner = text.slice(5);
    return "blob " + inner.slice(inner.lastIndexOf("/") + 1);
  }
  if (/^data:/i.test(text)) return "data";
  let home = "";
  try { home = base ? new URL(String(base)).origin : ""; } catch { home = ""; }
  try {
    const where = base ? new URL(text, String(base)) : new URL(text);
    return ((where.origin === home ? "" : where.host) + where.pathname).slice(0, 120);
  } catch {
    return text.split(/[?#]/)[0].slice(0, 120);
  }
}

// How long after the last batch this one was pressed, and why.
export function sinceLast(timing) {
  if (!timing || typeof timing.gapSeconds !== "number") return "";
  return timing.gapSeconds.toFixed(2) + "s after batch " + timing.after
    + (timing.handedOver ? " was handed over" : " ended");
}

export function describeEvent(event, base) {
  if (!event) return "";
  if (event.kind === "response" || event.kind === "incoming") {
    const said = [event.kind === "incoming" ? "arriving:" : "done:",
      event.via || "request", event.method || "GET",
      shortUrl(event.url, base), String(event.status),
      collapse(String(event.contentType || "").split(";")[0]) || "no type"];
    if (/^attachment\b/i.test(collapse(event.disposition))) said.push("attachment");
    if (event.failed) said.push("FAILED");
    return said.join(" ");
  }
  if (event.kind === "blob") {
    return "blob made, " + (event.type || "no type")
      + (typeof event.size === "number" ? ", " + event.size + " bytes" : "");
  }
  if (event.kind === "anchor") {
    return "link clicked" + (event.via === "event" ? " (a click event)" : "") + ", "
      + shortUrl(event.href, base) + (event.download ? ", saving as " + event.download : "");
  }
  if (event.kind === "resource") {
    const size = Math.max(Number(event.encodedBodySize) || 0, Number(event.transferSize) || 0);
    return "resource: " + (event.initiatorType || "other") + " " + shortUrl(event.name, base) + ", "
      + (size ? size + " bytes" : "size unknown")
      + (event.contentType ? ", " + event.contentType : "")
      + (event.responseStatus ? ", status " + event.responseStatus : "");
  }
  if (event.kind === "blur") {
    return "blur, the window lost focus" + (event.visible === false ? " (page hidden)" : "");
  }
  if (event.kind === "focus") {
    return "focus, the window has it back" + (event.hasFocus === true ? "" : " (but document.hasFocus() says no)");
  }
  if (event.kind === "visibility") return "the page was " + (event.visible === false ? "hidden" : "shown again");
  if (event.kind === "open") return "window.open " + shortUrl(event.url, base);
  if (event.kind === "submit") {
    return "form submitted, " + (event.method || "GET") + " " + shortUrl(event.url, base)
      + (event.via ? " (" + event.via + ")" : "");
  }
  if (event.kind === "iframe") return "frame given the address " + shortUrl(event.url, base);
  if (event.kind === "unload") return "the page is about to unload";
  if (event.kind === "button") {
    return "button " + (event.disabled ? "disabled" : "enabled") + ', reads "'
      + collapse(event.text).slice(0, 40) + '"' + (event.attached === false ? ", no longer on the page" : "");
  }
  if (event.kind === "stop") return "Stop pressed";
  if (event.kind === "timing") {
    const parts = [];
    const since = sinceLast(event);
    if (since) parts.push("pressed " + since);
    for (const [key, label] of [["settleMs", "settled for"], ["untickMs", "unticked in"],
      ["refreshMs", "counts redrawn in"], ["readMs", "rows read in"],
      ["takeMs", "ticked and checked in"], ["quietMs", "page went quiet in"]]) {
      if (typeof event[key] === "number") parts.push(label + " " + Math.round(event[key]) + " ms");
    }
    return "timing: " + parts.join(", ");
  }
  return "";
}

// ---- resources the browser itself timed ----

const RESOURCE_KINDS = ["fetch", "xmlhttprequest"];
const BIG_BODY = 100000;
const SMALLEST_FILE = 10000;
const NAMES_A_FILE = /download|archive|zip|pdf/i;
const NOT_A_FILE_TYPE = /json|html|xml|javascript|text\//i;

// A fetch or XHR timing entry read as a file: began after the press, did not
// fail, and is over 100 kB or has an address naming a download. An entry that
// names its type as JSON/HTML/XML/script/text never counts, and an address
// alone does not count under 10 kB (Knauf's API path says "download").
export function isFileResource(event, pressedAt) {
  if (!event || RESOURCE_KINDS.indexOf(String(event.initiatorType)) < 0) return false;
  if (typeof event.started !== "number" || !(event.started >= pressedAt)) return false;
  const status = Number(event.responseStatus) || 0;
  if (status && !(status >= 200 && status <= 299)) return false;
  if (NOT_A_FILE_TYPE.test(String(event.contentType || ""))) return false;
  const body = Math.max(Number(event.encodedBodySize) || 0, Number(event.transferSize) || 0);
  if (body > BIG_BODY) return true;
  if (body > 0 && body < SMALLEST_FILE) return false;
  return NAMES_A_FILE.test(String(event.name || ""));
}

// A timing entry turned into an event on the press's own clock.
export function resourceEvent(entry, pressPerf, pressedAt) {
  const place = (time) => {
    const number = Number(time);
    return Number.isFinite(number) ? pressedAt + (number - pressPerf) : NaN;
  };
  const end = Number(entry.responseEnd) > 0 ? entry.responseEnd : Number(entry.startTime) + Number(entry.duration);
  return {
    kind: "resource",
    name: String(entry.name || ""),
    initiatorType: String(entry.initiatorType || ""),
    started: place(entry.startTime),
    at: place(end),
    encodedBodySize: Number(entry.encodedBodySize) || 0,
    transferSize: Number(entry.transferSize) || 0,
    contentType: String(entry.contentType || ""),
    responseStatus: Number(entry.responseStatus) || 0,
  };
}

// ---- the trace: everything seen after each press, for the saved list ----

function traceLine(event, start) {
  const text = describeEvent(event);
  if (!text) return "";
  if (!Number.isFinite(event.at) || !Number.isFinite(start)) return "+?ms " + text;
  const ms = Math.round(event.at - start);
  return (ms >= 0 ? "+" : "") + ms + "ms " + text;
}

// A batch's trace runs from its press to the next, capped; held in memory
// for the page's life, never in storage, whose room the ledger needs.
export function createTracer(limit) {
  const asked = Math.floor(Number(limit));
  const cap = Number.isFinite(asked) && asked >= 1 ? asked : 300;
  const traces = {};
  let batch = null;
  let start = NaN;
  return {
    start(number, at) { batch = String(number); start = at; traces[batch] = []; },
    note(event) {
      if (batch === null || !event || event.kind === "clock") return;
      const list = traces[batch];
      if (list.length >= cap) return;
      const line = traceLine(event, start);
      if (line) list.push(line);
    },
    all() {
      const copy = {};
      for (const key of Object.keys(traces)) copy[key] = traces[key].slice();
      return copy;
    },
  };
}

// ---- Load more, and the page going quiet ----

export function isLoadMoreText(text) {
  const words = collapse(text);
  return words.length > 0 && words.length <= 40 && /^(load|show|view|see)\s+more\b/i.test(words);
}

// After Load more: the rows growing is the evidence, the ceiling a ceiling.
export async function waitForGrowth(count, before, sleep, now, ceilingMs, halted) {
  const until = now() + ceilingMs;
  for (;;) {
    const seen = count();
    if (seen > before) return { grew: true, after: seen };
    if (now() >= until || (typeof halted === "function" && halted())) return { grew: false, after: seen };
    await sleep(0.25);
  }
}

// The page is quiet once nothing outside the panel has changed for quietMs,
// counted from the later of its last change and `since` (the end of ticking).
// On Knauf, pressing before the page had taken the last tick lost that row
// from every zip; capMs is the ceiling for a page that never stops moving.
export const QUIET_MS = 1000;
export const QUIET_CAP_MS = 6000;
const QUIET_POLL = 0.05;

export async function waitForQuiet(lastChange, since, now, sleep, quietMs, capMs, halted) {
  const start = now();
  for (;;) {
    const at = now();
    if (typeof halted === "function" && halted()) return { quiet: false, halted: true, waitedMs: at - start };
    const last = Math.max(Number(lastChange()) || 0, since);
    if (at - last >= quietMs) return { quiet: true, halted: false, waitedMs: at - start };
    if (at - start >= capMs) return { quiet: false, halted: false, waitedMs: at - start };
    await sleep(QUIET_POLL);
  }
}

// ---- the watch: confirmed or unconfirmed, from events and a clock ----

export function newWatch(batch, pressedAt, timeoutMs) {
  return {
    batch, pressedAt, deadline: pressedAt + timeoutMs, status: "waiting",
    blobs: [], ambiguous: false, away: false, evidence: "", reason: "", decidedAt: null,
  };
}

function decide(watch, status, reason, evidence, at) {
  return Object.assign({}, watch, { status, reason, evidence, decidedAt: at });
}

// One event at a time, each carrying its own time, so a sequence always gives
// the same answer. A request belongs to the batch pressed most recently when
// it was SENT; once an earlier batch's file starts arriving, a blob and link
// click cannot be told apart from its hand-over, so only this batch's own
// request counts after that. The window losing focus and getting it back
// (page not hidden in between) is a Save window opening and closing.
export function observe(watch, event) {
  if (!watch || watch.status !== "waiting" || !event) return watch;
  if (event.kind === "stop") return decide(watch, "unconfirmed", "stopped", "", event.at);
  const at = event.at;
  if (typeof at !== "number" || !Number.isFinite(at)) return watch;
  // The clock first: whatever arrives at or after the deadline is too late.
  if (at >= watch.deadline) return decide(watch, "unconfirmed", "timeout", "", watch.deadline);
  if (at < watch.pressedAt) return watch;
  if (event.kind === "response" || event.kind === "incoming") {
    if (!isFileEvidence(event)) return watch;
    if (event.batch === watch.batch) {
      return event.kind === "response" ? decide(watch, "confirmed", "", describeEvent(event), at) : watch;
    }
    if (event.batch !== null && event.batch !== undefined) return Object.assign({}, watch, { ambiguous: true });
    return watch;
  }
  if (event.kind === "blob") {
    if (watch.ambiguous || typeof event.url !== "string") return watch;
    return Object.assign({}, watch, { blobs: watch.blobs.concat([event.url]) });
  }
  if (event.kind === "blur") return event.visible === false ? watch : Object.assign({}, watch, { away: true });
  if (event.kind === "visibility") return event.visible === false ? Object.assign({}, watch, { away: false }) : watch;
  if (event.kind === "focus") {
    if (watch.away && event.hasFocus === true) {
      return decide(watch, "confirmed", "", "the browser window lost focus and got it back after the press: "
        + "a Save window opened and closed", at);
    }
    return watch;
  }
  if (event.kind === "resource") {
    return isFileResource(event, watch.pressedAt) ? decide(watch, "confirmed", "", describeEvent(event), at) : watch;
  }
  if (event.kind === "anchor") {
    if (!watch.ambiguous && watch.blobs.indexOf(String(event.href)) >= 0) {
      return decide(watch, "confirmed", "", "a blob was made and a link to it clicked"
        + (event.download ? ", saving as " + event.download : ""), at);
    }
    return watch;
  }
  return watch;
}
