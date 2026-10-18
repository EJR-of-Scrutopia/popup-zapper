// What a recorded click was on, found again later: on another item's row of
// the list, or on a page reached after it. Built on the batch clicker's own
// way of remembering an element (its words and a short path of tags and
// classes), so a page redrawing itself does not lose it.

import { describeTarget, matchesTarget, labelOf, buttonWords, chainScore } from "../batch/target.js";
import { collapse, normaliseText, numberIdentities, rowText, ROW_DEPTH } from "../batch/rows.js";
import { shortUrl } from "../batch/evidence.js";

const owns = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);

// The batch clicker's record, plus the words even on a link (a link's words
// are how "Read online" is told from "Buy now"), the link's full address and
// whether it opens a tab.
export function describeStepTarget(node, kind) {
  const record = describeTarget(node, kind);
  const label = labelOf(node);
  let link = null;
  try { link = typeof node.closest === "function" ? node.closest("a[href]") : null; } catch { link = null; }
  return Object.assign(record, {
    words: buttonWords(label),
    text: label.slice(0, 60),
    href: link ? String(link.href || "") : "",
    blank: !!link && String(link.getAttribute("target") || "").toLowerCase() === "_blank",
  });
}

// Words count only when most matches share them: per-item links each read
// differently, and a list's buttons all read alike.
export function refineWords(target, matches) {
  if (!target || !target.words) return target;
  const same = (matches || []).filter((node) => buttonWords(labelOf(node)) === target.words).length;
  return same < Math.max(2, Math.ceil((matches || []).length / 2)) ? Object.assign({}, target, { words: "" }) : target;
}

function sameWords(node, target) {
  return !target.words || buttonWords(labelOf(node)) === target.words;
}

function matchesOf(doc, target, isOurs) {
  return Array.from(doc.getElementsByTagName(target.tag)).filter((node) =>
    !isOurs(node) && matchesTarget(node, target) && sameWords(node, target));
}

function firstOtherLink(row, control) {
  try {
    for (const link of row.querySelectorAll("a[href]")) {
      if (link !== control && !link.contains(control) && !/^javascript:/i.test(link.href)) return link;
    }
  } catch { /* none */ }
  return null;
}

// Every item on the page: each match of the target, with its row (the
// largest element above it holding no other match), a title to read and an
// identity that reads the same on another day.
export function rowsFor(doc, target, isOurs = () => false) {
  if (!doc || !target || !target.tag) return [];
  const controls = matchesOf(doc, target, isOurs);
  const raw = controls.map((control) => {
    let node = control;
    for (let step = 0; step < ROW_DEPTH; step++) {
      const up = node.parentElement;
      if (!up || up === doc.body || up === doc.documentElement) break;
      if (controls.filter((each) => up.contains(each)).length > 1) break;
      node = up;
    }
    const own = collapse(control.textContent || "");
    let title = collapse(rowText(node));
    if (own) title = collapse(title.replace(own, " "));
    title = title.slice(0, 200) || "(no title)";
    const link = firstOtherLink(node, control);
    let href = "";
    try { href = link ? shortUrl(link.href, doc.location ? doc.location.href : "") : ""; } catch { href = ""; }
    return { node, control, title, id: normaliseText(title) + (href ? " | " + href : "") };
  });
  const ids = numberIdentities(raw.map((each) => ({ id: each.id })));
  return raw.map((each, at) => Object.assign(each, { id: ids[at].id }));
}

export function rowOf(rows, node) {
  if (!node) return null;
  return (rows || []).find((row) => row.node === node || row.node.contains(node)) || null;
}

export function findInRow(rowNode, target) {
  if (!rowNode || !target) return null;
  const inside = [rowNode].concat(Array.from(rowNode.getElementsByTagName(target.tag)));
  return inside.find((node) => String(node.tagName || "").toLowerCase() === target.tag
    && matchesTarget(node, target) && sameWords(node, target)) || null;
}

// On a page reached later: by its words, the best placed of those that share
// them; never a button with other words (on a paid item, "Buy now" stands
// where "Read online" stood). With no words, by its path alone.
export function findOnPage(doc, target, { isOurs = () => false, onScreen = () => true } = {}) {
  if (!doc || !target || !target.tag) return null;
  const all = Array.from(doc.getElementsByTagName(target.tag)).filter((node) => {
    try { return !isOurs(node) && onScreen(node); } catch { return false; }
  });
  if (target.words) {
    let best = null;
    let bestScore = -1;
    for (const node of all) {
      if (buttonWords(labelOf(node)) !== target.words) continue;
      const score = chainScore(node, target.chain || []);
      if (score > bestScore) { best = node; bestScore = score; }
    }
    return best;
  }
  return all.find((node) => matchesTarget(node, target)) || null;
}

export function parseWords(text) {
  return String(text == null ? "" : text).split(/[,\r\n]+/).map((word) => word.trim().toLowerCase()).filter(Boolean);
}

export function rowFilter(title, skipText, onlyText) {
  const text = normaliseText(title);
  const hit = parseWords(skipText).find((word) => text.indexOf(word) >= 0);
  if (hit) return { take: false, why: `skipped: has "${hit}"` };
  const only = parseWords(onlyText);
  if (only.length && !only.some((word) => text.indexOf(word) >= 0)) {
    return { take: false, why: "skipped: lacks any of " + only.map((word) => `"${word}"`).join(", ") };
  }
  return { take: true, why: "" };
}

// Items still to do, in page order: not in the ledger under any status, and
// let through by the filters.
export function wantedRows(rows, ledger, rec) {
  const held = ledger && ledger.rows;
  const settings = rec || {};
  return (rows || []).filter((row) => !owns(held, row.id) && rowFilter(row.title, settings.skipText, settings.onlyText).take);
}
