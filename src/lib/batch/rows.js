// Reading the rows a batch run ticks: a checkbox (native or custom) and the
// document beside it. Pure apart from the DOM it is handed, so tests drive it
// with fakes and with jsdom.

// A results row shows a format and a size; a filter row shows neither, which
// keeps the run off a filter panel's own checkboxes. Drawings, models and
// images are documents too (Knauf lists technical drawings as DWG).
export const LOOKS_LIKE_A_FILE = /\b(PDF|DOCX?|XLSX?|XLSM|PPTX?|ZIP|RAR|7Z|DWG|DXF|DWFX?|DGN|RVT|RFA|RTE|IFC|SKP|STP|STEP|IGS|IGES|3DS|3DM|OBJ|FBX|GSM|PLN|VWX|NWD|NWC|JPE?G|PNG|TIFF?|GIF|SVG|EPS|PSD|MP4|MOV|TXT|CSV|KMZ)\b/i;
export const LOOKS_LIKE_A_SIZE = /\b\d+([.,]\d+)?\s?(kB|KB|MB|GB)\b/i;
const LOOKS_LIKE_A_MIME = /\b(application|image|video|audio|text|model)\/[a-z0-9][a-z0-9.+-]*/i;

const EVERY_FORMAT = new RegExp(LOOKS_LIKE_A_FILE.source, "gi");
const EVERY_SIZE = new RegExp(LOOKS_LIKE_A_SIZE.source, "gi");
const EVERY_MIME = new RegExp(LOOKS_LIKE_A_MIME.source, "gi");
const A_LETTER = /\p{L}/gu;
export const TITLE_LETTERS = 15;

// Document kinds an icon, link or class may name. Never pictures, SVG or
// "step": thumbnails, chevrons and step numbers are everywhere, filters too.
const SIGNAL_FORMAT = /(?:^|[^a-z0-9])(pdf|docx?|xlsx?|xlsm|pptx?|zip|rar|7z|dwg|dxf|dwfx?|rvt|rfa|ifc|skp|3dm|gsm|pln)(?:[^a-z0-9]|$)/i;
const SIGNAL_ATTRIBUTES = ["href", "src", "alt", "title", "class", "aria-label", "data-type", "xlink:href"];

export function collapse(text) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
}

export function normaliseText(text) {
  return collapse(text).toLowerCase();
}

// A format plus a size, or a format plus a media type and a title of its own
// ("application/pdf (22)" in a filter has no title, so it stays out).
export function isDocumentRowText(text) {
  const raw = String(text == null ? "" : text);
  if (!LOOKS_LIKE_A_FILE.test(raw)) return false;
  if (LOOKS_LIKE_A_SIZE.test(raw)) return true;
  if (!LOOKS_LIKE_A_MIME.test(raw)) return false;
  const rest = raw.replace(EVERY_MIME, " ").replace(EVERY_FORMAT, " ");
  return (rest.match(A_LETTER) || []).length >= TITLE_LETTERS;
}

export function titleLetters(text) {
  const rest = String(text == null ? "" : text).replace(EVERY_MIME, " ")
    .replace(EVERY_FORMAT, " ").replace(EVERY_SIZE, " ");
  return (rest.match(A_LETTER) || []).length;
}

// What a row's own elements say of themselves: its tag, its links, links
// that carry a download attribute, and attributes that may name a document.
export function rowFacts(node) {
  const facts = {
    tag: String((node && node.nodeName) || "").toUpperCase(), links: 0, downloads: 0, signals: [],
  };
  const walk = (at, depth) => {
    if (depth > 40 || facts.signals.length > 200) return;
    for (let child = at.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      if (typeof child.getAttribute === "function") {
        if (String(child.nodeName).toUpperCase() === "A" && child.getAttribute("href")) {
          facts.links += 1;
          if (child.getAttribute("download") !== null) facts.downloads += 1;
        }
        for (const name of SIGNAL_ATTRIBUTES) {
          const value = child.getAttribute(name);
          if (value) facts.signals.push(String(value));
        }
      }
      walk(child, depth + 1);
    }
  };
  if (node) walk(node, 0);
  return facts;
}

export function formatFromSignals(signals) {
  for (const signal of signals || []) {
    const found = SIGNAL_FORMAT.exec(String(signal));
    if (found) return found[1].toUpperCase();
  }
  return "";
}

// A row whose text names no file still counts when it has a title and an
// icon, link or class naming a document, a download link, a "pdf" word of its
// own beside a link, or it is a table row holding a link.
export function isDocumentRow(text, facts) {
  if (isDocumentRowText(text)) return true;
  if (titleLetters(text) < TITLE_LETTERS || !facts) return false;
  if (formatFromSignals(facts.signals)) return true;
  if (facts.downloads > 0) return true;
  if (facts.links > 0 && SIGNAL_FORMAT.test(String(text))) return true;
  return facts.tag === "TR" && facts.links > 0;
}

function lastMatch(text, every) {
  const all = String(text).match(every);
  return all ? all[all.length - 1] : "";
}

// A row's identity is its whole text, collapsed and lower case, so it reads
// the same after a reload or on another day. Title, format and size are taken
// out beside it for a person to read.
export function rowIdentity(text) {
  const raw = String(text == null ? "" : text);
  const lines = raw.split(/[\r\n]+/).map(collapse).filter((line) => {
    const rest = line.replace(EVERY_MIME, " ").replace(EVERY_FORMAT, " ").replace(EVERY_SIZE, " ");
    return (rest.match(A_LETTER) || []).length >= 3;
  });
  return {
    id: normaliseText(raw),
    title: (lines.length ? lines.join(" / ") : collapse(raw)).slice(0, 240),
    format: lastMatch(raw, EVERY_FORMAT).toUpperCase(),
    size: collapse(lastMatch(raw, EVERY_SIZE)),
  };
}

// Rows that read exactly alike are numbered in page order ("#2"), so each is
// fetched: a second copy costs nothing, two documents merged loses one.
export function numberIdentities(identities) {
  const times = new Map();
  return identities.map((identity) => {
    const one = Object.assign({}, identity);
    const nth = (times.get(one.id) || 0) + 1;
    times.set(one.id, nth);
    if (nth > 1) one.id = one.id + " #" + nth;
    return one;
  });
}

export function identitiesFor(texts) {
  return numberIdentities(texts.map(rowIdentity));
}

// The row's own text, with a break wherever a block starts or ends. Read from
// the nodes, not innerText, which changes with the window and the hover.
const BLOCKS = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL)$/;
const SILENT = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/;

export function rowText(row) {
  const parts = [];
  const walk = (node, depth) => {
    if (depth > 40) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        parts.push(child.nodeValue);
      } else if (child.nodeType === 1) {
        const name = String(child.nodeName).toUpperCase();
        if (SILENT.test(name)) continue;
        const block = BLOCKS.test(name);
        if (block) parts.push("\n");
        walk(child, depth + 1);
        if (block) parts.push("\n");
      }
    }
  };
  walk(row, 0);
  return parts.join("");
}

// ---- box state: native, ARIA, a hidden input inside, or a class ----

// Boxes whose state the page does not show are tracked by our own clicks.
const assumed = new WeakMap();

function attr(node, name) {
  return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
}

// true / false when the page shows it, null when it does not.
export function boxState(box) {
  if (!box) return null;
  if (typeof box.checked === "boolean") return box.checked;
  for (const name of ["aria-checked", "aria-pressed", "aria-selected"]) {
    const said = attr(box, name);
    if (said !== null) return said === "true" || said === "mixed";
  }
  try {
    const control = box.control || (typeof box.querySelector === "function"
      ? box.querySelector('input[type="checkbox"]') : null);
    if (control && typeof control.checked === "boolean") return control.checked;
  } catch { /* fall through to the class */ }
  const cls = String(attr(box, "class") || "");
  if (/(^|[\s_-])(is-)?(checked|selected|ticked)([\s_-]|$)/i.test(cls)) return true;
  return null;
}

export function isTicked(box) {
  const shown = boxState(box);
  if (shown !== null) return shown;
  return assumed.get(box) === true;
}

// CLICK, never box.checked = true: a framework hears only a click.
export function clickBox(box) {
  const before = boxState(box);
  box.click();
  if (before === null && boxState(box) === null) assumed.set(box, !assumed.get(box));
}

// ---- sources: which elements count as boxes ----

const NATIVE = 'input[type="checkbox"]';
const AUTO = 'input[type="checkbox"], [role="checkbox"]';

// What version 3 read: native checkboxes only.
export function nativeSource(doc) {
  return {
    learned: false,
    boxes: () => Array.from(doc.querySelectorAll(NATIVE)),
    within: (node) => {
      try { return node.querySelectorAll(NATIVE).length; } catch { return 1; }
    },
    checked: () => {
      try { return Array.from(doc.querySelectorAll(NATIVE + ":checked")); } catch { return []; }
    },
  };
}

// Native checkboxes and custom ones (role="checkbox"). A native box inside a
// custom one is the same control, so only the custom one counts.
export function autoSource(doc, isOurs = () => false) {
  const keep = (el) => {
    if (isOurs(el)) return false;
    if (String(el.nodeName).toUpperCase() !== "INPUT") return true;
    const up = el.parentElement;
    return !(up && typeof up.closest === "function" && up.closest('[role="checkbox"]'));
  };
  return {
    learned: false,
    boxes: () => Array.from(doc.querySelectorAll(AUTO)).filter(keep),
    within: (node, cap = 2) => {
      let n = 0;
      try {
        for (const el of node.querySelectorAll(AUTO)) {
          if (keep(el) && ++n >= cap) break;
        }
      } catch { return 1; }
      return n;
    },
    checked() { return this.boxes().filter(isTicked); },
  };
}

// The boxes a learned record matches (see target.js). A learned row is the
// largest element above a box that holds no other match.
export function learnedSource(doc, record, matches, isOurs = () => false) {
  const tag = record && record.tag ? record.tag : "*";
  const fits = (el) => !isOurs(el) && matches(el, record);
  return {
    learned: true,
    boxes: () => Array.from(doc.getElementsByTagName(tag)).filter(fits),
    within: (node, cap = 2) => {
      let n = 0;
      try {
        for (const el of node.getElementsByTagName(tag)) {
          if (fits(el) && ++n >= cap) break;
        }
      } catch { return 1; }
      return n;
    },
    checked() { return this.boxes().filter(isTicked); },
  };
}

// ---- the row reader ----

// How far up from a box to look for the rest of its row.
export const ROW_DEPTH = 8;
// A box whose climb found no row is tried again after five seconds, in case
// the page drew its text after its box.
const MISS_AGAIN = 5000;

// Each box's row is found once and kept, and each row's identity is worked
// out again only when its textContent (one cheap read) changes: a thousand
// rows cost a thousand text reads, not a thousand layouts.
//
// The climb stops at the first ancestor holding more than one box: that is a
// list or a filter panel, and no row lies above it.
export function createRowReader(doc, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const source = options.source || nativeSource(doc);
  const found = new WeakMap();
  const known = new WeakMap();
  const rowSet = new WeakSet();
  let last = [];

  function climbDocument(box) {
    let node = box;
    for (let step = 0; step < ROW_DEPTH && node; step++) {
      node = node.parentElement;
      if (!node || source.within(node) > 1) return null;
      const text = rowText(node);
      if (isDocumentRowText(text)) return { row: node, text, format: "" };
      // Links, icons and shape are read only when the text carries a title.
      if (titleLetters(text) >= TITLE_LETTERS) {
        const facts = rowFacts(node);
        if (isDocumentRow(text, facts)) return { row: node, text, format: formatFromSignals(facts.signals) };
      }
    }
    return null;
  }

  // A learned box needs no document test: the person said this is the thing.
  function climbLearned(box) {
    let row = null;
    let node = box;
    for (let step = 0; step < ROW_DEPTH; step++) {
      const up = node.parentElement;
      if (!up || up === doc.body || up === doc.documentElement || source.within(up) > 1) break;
      row = node = up;
    }
    if (!row) row = box.parentElement || box;
    return { row, text: rowText(row), format: formatFromSignals(rowFacts(row).signals) };
  }

  function climb(box) {
    return source.learned ? climbLearned(box) : climbDocument(box);
  }

  function rowFor(box) {
    const held = found.get(box);
    if (held && held.row) {
      if (held.row.isConnected !== false && held.row.contains(box)) {
        return { row: held.row, text: null, format: held.format || "" };
      }
    } else if (held && now() - held.at < MISS_AGAIN) {
      return null;
    }
    const fresh = climb(box);
    found.set(box, fresh ? { row: fresh.row, format: fresh.format || "" } : { row: null, at: now() });
    return fresh;
  }

  function identityOf(row, content, walked) {
    let seen = known.get(row);
    if (!seen || seen.content !== content) {
      seen = { content, identity: rowIdentity(walked !== null ? walked : rowText(row)) };
      known.set(row, seen);
    }
    return seen.identity;
  }

  function read(box) {
    const hit = rowFor(box);
    if (!hit) return null;
    const row = hit.row;
    if (box.hidden === true || row.hidden === true) return null;
    rowSet.add(row);
    const base = identityOf(row, row.textContent || "", hit.text);
    return {
      box, row,
      base: !base.format && hit.format ? Object.assign({}, base, { format: hit.format }) : base,
    };
  }

  // Every row on the page, in page order, numbered.
  function rows() {
    const out = [];
    for (const box of source.boxes()) {
      const one = read(box);
      if (one) out.push(one);
    }
    const numbered = numberIdentities(out.map((each) => each.base));
    last = out.map((each, at) => ({ box: each.box, row: each.row, identity: numbered[at], base: each.base.id }));
    return last;
  }

  // A chosen row as the page holds it now, found the quick way: the same box,
  // in the same row, naming the same document. Else null.
  function locate(chosen) {
    const box = chosen && chosen.box;
    if (!box || box.isConnected === false) return null;
    const held = found.get(box);
    if (!held || held.row !== chosen.row || !chosen.row.contains(box)) return null;
    const identity = identityOf(chosen.row, chosen.row.textContent || "", null);
    return identity.id === chosen.base ? chosen : null;
  }

  // Ticked boxes that belong to rows, for strays. A ticked filter is left alone.
  function checked() {
    const out = [];
    for (const box of source.checked()) {
      const hit = rowFor(box);
      if (hit) out.push({ box, row: hit.row });
    }
    return out;
  }

  function insideRow(node) {
    for (let at = node, step = 0; at && step < 40; at = at.parentElement, step++) {
      if (rowSet.has(at)) return true;
    }
    return false;
  }

  // Why a box is not read as a row: each level the climb looks at.
  function explain(box) {
    const said = [];
    let node = box;
    for (let step = 0; step < ROW_DEPTH && node; step++) {
      node = node.parentElement;
      if (!node) break;
      const name = String(node.nodeName || "?").toUpperCase();
      const boxes = source.within(node, 99);
      if (boxes > 1) { said.push(`${name} holds ${boxes} boxes, so the climb stops`); break; }
      const text = rowText(node);
      const facts = rowFacts(node);
      said.push(`${name} "${collapse(text).slice(0, 60)}": ${titleLetters(text)} letters, ` +
        `${facts.links} link(s), ${formatFromSignals(facts.signals) || "no file named"}`);
    }
    return said.join("; ");
  }

  return { rows, locate, checked, insideRow, explain, last: () => last, source };
}
