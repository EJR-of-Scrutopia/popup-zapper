// Per-site settings, kept in the site's localStorage per origin: the start
// row, the file types switched on, the click-each limit and auto mark, and the
// download button and item the person picked. Keys match the standalone
// downloader's, so its settings carry over.

import { LOOKS_LIKE_A_FILE } from "./rows.js";
import { wholeNumber } from "./ledger.js";

function origin(href) {
  return new URL(String(href)).origin;
}

function readRaw(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

function writeRaw(storage, key, value) {
  try {
    if (!storage) return false;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readJson(storage, key) {
  const raw = readRaw(storage, key);
  try { return typeof raw === "string" && raw ? JSON.parse(raw) : null; } catch { return null; }
}

// ---- start at row: rows above it are left alone for the run ----

export const START_PREFIX = "qs-intelligence start row ";
export const startKey = (href) => START_PREFIX + origin(href);

export function readStart(storage, key) {
  const raw = readRaw(storage, key);
  return wholeNumber(raw === null || raw === "" ? NaN : raw, 1);
}

export function writeStart(storage, key, value) {
  return writeRaw(storage, key, String(wholeNumber(value, 1)));
}

// ---- file types: null means every type, including ones not seen yet; once
// one is switched off, a type seen for the first time starts off ----

export const FORMATS_PREFIX = "qs-intelligence file types ";
const ONE_FORMAT = new RegExp("^" + LOOKS_LIKE_A_FILE.source + "$", "i");
export const formatsKey = (href) => FORMATS_PREFIX + origin(href);

export function wantsFormat(chosen, format) {
  if (!Array.isArray(chosen)) return true;
  return chosen.indexOf(String(format == null ? "" : format).toUpperCase()) >= 0;
}

// The types the rows offer, most rows first, then by name.
export function formatCounts(identities) {
  const counts = new Map();
  for (const each of identities || []) {
    const format = String((each && each.format) || "").toUpperCase();
    if (format) counts.set(format, (counts.get(format) || 0) + 1);
  }
  return Array.from(counts, ([format, rows]) => ({ format, rows }))
    .sort((a, b) => (b.rows - a.rows) || (a.format < b.format ? -1 : a.format > b.format ? 1 : 0));
}

// One switch flipped; `shown` is the types the page offers now.
export function toggleFormat(chosen, format, shown) {
  const name = String(format == null ? "" : format).toUpperCase();
  const types = (shown || []).map((each) => String(each).toUpperCase());
  const next = Array.isArray(chosen) ? chosen.slice() : types.slice();
  const at = next.indexOf(name);
  if (at >= 0) next.splice(at, 1);
  else next.push(name);
  const every = types.length > 0 && types.every((each) => next.indexOf(each) >= 0);
  return every ? null : next;
}

export function andList(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}

export function describeFormats(chosen) {
  if (!Array.isArray(chosen)) return "Every file type.";
  if (!chosen.length) return "No file type switched on.";
  return "Only " + andList(chosen) + ".";
}

export function readFormats(storage, key) {
  const held = readJson(storage, key);
  if (!Array.isArray(held)) return null;
  const out = [];
  for (const each of held) {
    if (typeof each !== "string" || !ONE_FORMAT.test(each)) continue;
    const name = each.toUpperCase();
    if (out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

export function writeFormats(storage, key, chosen) {
  return writeRaw(storage, key, Array.isArray(chosen) ? JSON.stringify(chosen) : null);
}

// ---- click each: carries on across pages and reloads for two hours from
// the last page, so a run left on does not press anything the next day ----

export const ZIP_AUTO_PREFIX = "qs-intelligence zip auto ";
const ZIP_AUTO_HOURS = 2;
export const zipAutoKey = (href) => ZIP_AUTO_PREFIX + origin(href);

export function readZipAuto(storage, key, now) {
  const raw = readRaw(storage, key);
  const since = Number(raw);
  return raw !== null && Number.isFinite(since) && since > 0 && now >= since
    && now - since < ZIP_AUTO_HOURS * 3600000;
}

export function writeZipAuto(storage, key, on, now) {
  return writeRaw(storage, key, on ? String(now) : null);
}

// ---- click each: stop once this many are added (Tarmac's zip of 141 would
// not download and took the page with it) ----

export const ZIP_LIMIT_PREFIX = "qs-intelligence zip limit ";
export const DEFAULT_ZIP_LIMIT = 50;
export const zipLimitKey = (href) => ZIP_LIMIT_PREFIX + origin(href);

export function readZipLimit(storage, key) {
  const raw = readRaw(storage, key);
  return wholeNumber(raw === null || raw === "" ? NaN : raw, DEFAULT_ZIP_LIMIT);
}

export function writeZipLimit(storage, key, value) {
  return writeRaw(storage, key, String(wholeNumber(value, DEFAULT_ZIP_LIMIT)));
}

// ---- the download button and the item the person picked ----

export const BUTTON_PREFIX = "qs-intelligence download button ";
export const buttonKey = (href) => BUTTON_PREFIX + origin(href);

const wholeChain = (chain) => Array.isArray(chain) && chain.length > 0 && chain.every((segment) =>
  segment && typeof segment.tag === "string" && segment.tag && Array.isArray(segment.classes));

export function readButtonRecord(storage, key) {
  const held = readJson(storage, key);
  if (!held || typeof held !== "object" || Array.isArray(held)
    || typeof held.words !== "string" || !held.words || !wholeChain(held.chain)) {
    return null;
  }
  return held;
}

export function writeButtonRecord(storage, key, record) {
  return writeRaw(storage, key, record ? JSON.stringify(record) : null);
}

export const TARGET_PREFIX = "pz-batch item ";
export const targetKey = (href) => TARGET_PREFIX + origin(href);

export function readTargetRecord(storage, key) {
  const held = readJson(storage, key);
  if (!held || typeof held !== "object" || Array.isArray(held)
    || (held.kind !== "box" && held.kind !== "button")
    || typeof held.tag !== "string" || !held.tag || !wholeChain(held.chain)) {
    return null;
  }
  return held;
}

export function writeTargetRecord(storage, key, record) {
  return writeRaw(storage, key, record ? JSON.stringify(record) : null);
}
