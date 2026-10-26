// Things the person points at: the page's download button, and the item to
// click many of. Each is remembered by its words and a short path of tags and
// classes, which survive a page redrawing itself where a held element does not.

import { collapse } from "./rows.js";

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
// Classes that come and go with an element's state, left out of a learned
// item's path so a ticked box still matches an unticked one.
const STATE_CLASS = /(^|[-_])(is|has)[-_]|active|checked|selected|disabled|hover|focus|open|added|current|loading|ticked|visited/i;

export function labelOf(node) {
  if (!node) return "";
  const named = typeof node.getAttribute === "function"
    ? node.getAttribute("aria-label") || node.getAttribute("title") : "";
  const shown = typeof node.innerText === "string" ? node.innerText : node.textContent;
  return collapse(shown || node.value || named || "");
}

// A button's words without its count: "Download (0)" and "Download (10)" are
// one button.
export function buttonWords(text) {
  return collapse(String(text == null ? "" : text).replace(/[\d()[\]{}:]+/g, " ")).toLowerCase();
}

function classesOf(node) {
  const raw = typeof node.className === "string" ? node.className
    : (typeof node.getAttribute === "function" ? node.getAttribute("class") || "" : "");
  return raw.split(/\s+/).filter((name) => SAFE_NAME.test(name) && !/\d/.test(name));
}

// An id or class with a digit in it is a name the page made up as it drew
// itself, and is left out.
export function segmentOf(node, dropState = false) {
  const tag = String(node.tagName || "").toLowerCase();
  const id = typeof node.id === "string" && SAFE_NAME.test(node.id) && !/\d/.test(node.id) ? node.id : "";
  let classes = classesOf(node);
  if (dropState) classes = classes.filter((name) => !STATE_CLASS.test(name));
  return { tag, id, classes: classes.slice(0, 3) };
}

// The element and up to three ancestors below the body, stopping early at
// one with an id of its own.
export function chainOf(node, dropState = false) {
  const chain = [];
  for (let at = node; at && chain.length < 4; at = at.parentElement) {
    const segment = segmentOf(at, dropState);
    if (!segment.tag || segment.tag === "body" || segment.tag === "html") break;
    chain.push(segment);
    if (segment.id) break;
  }
  return chain;
}

export function pathOf(chain) {
  return chain.slice().reverse().map((segment) =>
    segment.tag + (segment.id ? "#" + segment.id : "") + segment.classes.map((name) => "." + name).join(""),
  ).join(" > ");
}

// ---- the download button ----

export function describeButton(node) {
  const text = labelOf(node);
  const chain = chainOf(node);
  return { words: buttonWords(text), text: text.slice(0, 60), path: pathOf(chain), chain };
}

// How well a candidate stands where the selected button stood: its own tag
// must agree; each agreeing ancestor and shared class adds to the score.
export function chainScore(node, chain) {
  let score = 0;
  let at = node;
  for (let level = 0; level < chain.length && at; level++) {
    const want = chain[level];
    const have = segmentOf(at);
    if (have.tag !== want.tag || (want.id && have.id !== want.id)) return level === 0 ? -1 : score;
    score += 1 + have.classes.filter((name) => want.classes.indexOf(name) >= 0).length;
    at = at.parentElement;
  }
  return score;
}

// Found again on every press by its words (which must agree), then by how
// much of its path it shares; among equals the first wins.
export function locateButton(record, candidates, usable) {
  if (!record || !record.words || !Array.isArray(record.chain) || !record.chain.length) return null;
  let best = null;
  let bestScore = -1;
  for (const node of candidates || []) {
    if (!node || (typeof usable === "function" && !usable(node))) continue;
    if (buttonWords(labelOf(node)) !== record.words) continue;
    const score = chainScore(node, record.chain);
    if (score > bestScore) { best = node; bestScore = score; }
  }
  return best;
}

// The selected button when it can be found, else the automatic one.
export function pickButton(record, locate, automatic) {
  if (record) {
    const found = locate(record);
    if (found) return { button: found, source: "selected", lost: false };
  }
  const fallback = automatic() || null;
  return { button: fallback, source: fallback ? "automatic" : "none", lost: !!record };
}

export function describeUse(use, text) {
  const named = text ? ' "' + collapse(text).slice(0, 30) + '"' : "";
  if (use && use.source === "selected") return "Download button: yours" + named + ".";
  if (use && use.source === "automatic") {
    return (use.lost ? "Your download button isn't here; using" : "Download button: found") + named + ".";
  }
  return (use && use.lost ? "Your download button isn't here." : "No download button found.")
    + " Pick it with ⬇.";
}

// ---- the item to click many of ----

export const BOX_LIKE = 'input[type="checkbox"], [role="checkbox"], [role="switch"], [aria-checked]';
const BUTTON_LIKE = 'button, a[href], [role="button"], input[type="button"], input[type="submit"]';
const LOOSE_CLICKABLE = '[onclick], [class*="btn"], [class*="button"]';
const BOX_CLASS = '[class*="check"], [class*="tick"], [class*="toggle"], [class*="switch"]';

// From the element clicked to the thing meant: a label's checkbox, a box, a
// real button or link, a styled wrapper around one checkbox, or whatever
// looks clickable.
export function resolveTarget(el) {
  if (!el || el.nodeType !== 1 || typeof el.closest !== "function") return null;
  const label = el.closest("label");
  const control = label && label.control;
  if (control && String(control.type).toLowerCase() === "checkbox") return { node: control, kind: "box" };
  const box = el.closest(BOX_LIKE);
  if (box) return { node: box, kind: "box" };
  const button = el.closest(BUTTON_LIKE);
  if (button) return { node: button, kind: "button" };
  for (let at = el, step = 0; at && step < 3; at = at.parentElement, step++) {
    const inside = typeof at.querySelectorAll === "function" ? at.querySelectorAll('input[type="checkbox"]') : [];
    if (inside.length === 1) return { node: inside[0], kind: "box" };
    if (inside.length > 1) break;
  }
  // A box drawn from a plain element, known by its class and its few words.
  const drawn = el.closest(BOX_CLASS);
  if (drawn && collapse(drawn.textContent).length <= 40) return { node: drawn, kind: "box" };
  return { node: el.closest(LOOSE_CLICKABLE) || el, kind: "button" };
}

export function describeTarget(node, kind) {
  const tag = String(node.tagName || "").toLowerCase();
  const type = tag === "input" ? String(node.type || "").toLowerCase() : "";
  const role = typeof node.getAttribute === "function" ? node.getAttribute("role") || "" : "";
  const href = tag === "a" && typeof node.getAttribute === "function" ? node.getAttribute("href") || "" : "";
  return {
    kind,
    tag,
    type,
    role,
    chain: chainOf(node, true),
    words: kind === "button" ? buttonWords(labelOf(node)) : "",
    // A plain link with no download attribute may take the page away.
    link: kind === "button" && !!href && !/^(#|javascript:)/i.test(href)
      && node.getAttribute("download") === null && node.getAttribute("target") !== "_blank",
  };
}

// ---- the kind among look-alikes ----

// A picked item's path of tags and classes matches every look-alike: on a
// card with a PDF, a DWG and an RVT icon, all three. What tells them apart is
// read here: its own classes, the classes, pictures and drawings inside it,
// its words and labels, data- values, and the kind of file it links to.

// data- names that hold an id, a position or a tracker's tag, never a kind.
const NOT_A_KIND = /(^|-)(id|key|index|idx|row|pos|position|track|tracking|gtm|ga|analytics|event|testid|test)(-|$)/i;
const INSIDE_DEPTH = 4;
const INSIDE_MOST = 40;

function attr(node, name) {
  try { return typeof node.getAttribute === "function" ? node.getAttribute(name) : null; } catch { return null; }
}

function classes(node) {
  return classesOf(node).filter((name) => !STATE_CLASS.test(name));
}

function basename(url) {
  const clean = String(url || "").split(/[?#]/)[0].split(/\s/)[0];
  return clean.slice(clean.lastIndexOf("/") + 1).toLowerCase();
}

// A short fingerprint of an SVG's drawing, so two icons drawn alike agree.
function shape(svg) {
  let text = "";
  try {
    for (const part of svg.querySelectorAll("path, polygon, polyline, circle, rect, line")) {
      text += (attr(part, "d") || attr(part, "points") || part.nodeName) + "|";
      if (text.length > 400) break;
    }
  } catch { return ""; }
  let hash = 0;
  for (let at = 0; at < text.length; at++) hash = (hash * 31 + text.charCodeAt(at)) | 0;
  return text ? (hash >>> 0).toString(36) : "";
}

function labelTrait(value) {
  const words = buttonWords(value);
  return words && words.length <= 40 ? words : "";
}

// What a node shows of itself and of what is inside it.
export function traitsOf(node) {
  const out = new Set();
  if (!node || node.nodeType !== 1) return out;
  for (const name of classes(node)) out.add("c:" + name);
  const words = buttonWords(labelOf(node));
  if (words && words.length <= 40) out.add("w:" + words);
  const seen = [node];
  const walk = (at, depth) => {
    if (depth > INSIDE_DEPTH) return;
    for (let child = at.firstElementChild; child && seen.length < INSIDE_MOST; child = child.nextElementSibling) {
      seen.push(child);
      for (const name of classes(child)) out.add("i:" + name);
      walk(child, depth + 1);
    }
  };
  walk(node, 1);
  for (const each of seen) {
    const tag = String(each.nodeName || "").toLowerCase();
    for (const name of ["aria-label", "title", "alt"]) {
      const said = labelTrait(attr(each, name));
      if (said) out.add("l:" + said);
    }
    for (const item of Array.from(each.attributes || [])) {
      const name = String(item.name || "");
      if (!/^data-/.test(name) || /\d/.test(name) || NOT_A_KIND.test(name.slice(5))) continue;
      const value = collapse(item.value).toLowerCase();
      if (value.length > 30 || /\d{3,}/.test(value)) continue;
      out.add("d:" + name + "=" + value);
    }
    if (tag === "img" || tag === "source") {
      const file = basename(attr(each, "src") || attr(each, "srcset"));
      if (file) out.add("img:" + file);
    }
    if (tag === "use") {
      const ref = attr(each, "href") || attr(each, "xlink:href");
      if (ref) out.add("use:" + ref.slice(ref.indexOf("#")));
    }
    if (tag === "svg") {
      const drawn = shape(each);
      if (drawn) out.add("svg:" + drawn);
    }
  }
  // The kind of file it links to.
  let link = null;
  try { link = node.closest ? node.closest("a[href]") || (node.querySelector ? node.querySelector("a[href]") : null) : null; } catch { link = null; }
  const file = link ? basename(attr(link, "href")) : "";
  const ext = /\.([a-z0-9]{2,5})$/i.exec(file);
  if (ext && !/^(html?|php|aspx?|jsp)$/i.test(ext[1])) out.add("ext:" + ext[1].toLowerCase());
  return out;
}

// Whether a node is of a picked variant (variant.js): none of its ruled-out
// traits, and every trait of one of its kinds. Places in a card are judged
// over the whole set, in variant.js.
export function hasTraits(node, variant, traits = traitsOf(node)) {
  if (!variant) return true;
  for (const trait of variant.none || []) if (traits.has(trait)) return false;
  const kinds = variant.kinds || [];
  return !kinds.length || kinds.some((kind) => (kind.all || []).every((trait) => traits.has(trait)));
}

// Same tag (and type and role), and at every level of the remembered path
// the same tag, the same id, and at least one shared class where any were
// remembered.
export function matchesTarget(node, record) {
  if (!node || !record || node.nodeType !== 1) return false;
  if (String(node.tagName || "").toLowerCase() !== record.tag) return false;
  if (record.type && String(node.type || "").toLowerCase() !== record.type) return false;
  if (record.role && (node.getAttribute("role") || "") !== record.role) return false;
  let at = node;
  for (const want of record.chain) {
    if (!at) return false;
    const tag = String(at.tagName || "").toLowerCase();
    if (tag !== want.tag) return false;
    if (want.id && at.id !== want.id) return false;
    if (want.classes.length) {
      const have = classesOf(at);
      if (!want.classes.some((name) => have.indexOf(name) >= 0)) return false;
    }
    at = at.parentElement;
  }
  // The kind, once worked out (variant.js), unless the person chose all alike.
  if (record.variant && record.variantOn !== false && !hasTraits(node, record.variant)) return false;
  return true;
}

// ---- catching the next click ----

// The next click a person makes (event.isTrusted) is caught on its way down
// and kept from the page; the presses and releases around it are kept back
// too, for pages that act on mousedown. Clicks on our own UI pass through.
const SWALLOWED = ["pointerdown", "mousedown", "pointerup", "mouseup"];

export function armCapture(target, isOurs, picked) {
  let armed = true;
  const ours = (event) => {
    try { return !!isOurs(event.target); } catch { return false; }
  };
  const hold = (event) => {
    if (!event) return;
    try { event.preventDefault(); } catch { /* nothing */ }
    try { event.stopPropagation(); } catch { /* nothing */ }
    try { if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation(); } catch { /* nothing */ }
  };
  function swallow(event) {
    if (!armed || !event || event.isTrusted !== true || ours(event)) return;
    hold(event);
  }
  function listener(event) {
    if (!armed || !event || event.isTrusted !== true || ours(event)) return;
    disarm();
    hold(event);
    picked(event.target);
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    try {
      target.removeEventListener("click", listener, true);
      for (const type of SWALLOWED) target.removeEventListener(type, swallow, true);
    } catch { /* gone either way */ }
  }
  target.addEventListener("click", listener, true);
  for (const type of SWALLOWED) target.addEventListener(type, swallow, true);
  return disarm;
}
