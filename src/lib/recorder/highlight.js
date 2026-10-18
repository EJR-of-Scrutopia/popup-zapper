// Words marked on the page with the browser's custom highlights: nothing in
// the page is changed or wrapped, so its own scripts never notice. Where the
// browser lacks them, nothing is marked.

export const MARK = "pz-rec-mark";
export const SKIP = "pz-rec-skip";
const STYLE_ID = "pz-rec-highlight-style";
const MOST = 2000;

export function findWordRanges(text, words) {
  const lower = String(text == null ? "" : text).toLowerCase();
  const list = (words || []).map((word) => String(word).toLowerCase()).filter(Boolean);
  const out = [];
  let at = 0;
  while (at < lower.length) {
    let best = -1;
    let length = 0;
    for (const word of list) {
      const found = lower.indexOf(word, at);
      if (found >= 0 && (best < 0 || found < best || (found === best && word.length > length))) { best = found; length = word.length; }
    }
    if (best < 0) break;
    out.push([best, best + length]);
    at = best + length;
  }
  return out;
}

function registry(doc) {
  const win = doc && doc.defaultView;
  const api = win && win.CSS && win.CSS.highlights;
  return api && typeof win.Highlight === "function" ? { api, Make: win.Highlight, win } : null;
}

function addStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `::highlight(${MARK}){background:#ffeb3b;color:#000}::highlight(${SKIP}){background:#ffcdd2;color:#000}`;
  (doc.head || doc.documentElement).appendChild(style);
}

export function highlightWords(doc, name, words, isOurs = () => false) {
  const found = registry(doc);
  if (!found) return 0;
  const list = (words || []).filter(Boolean);
  if (!list.length || !doc.body) { found.api.delete(name); return 0; }
  addStyle(doc);
  const filter = found.win.NodeFilter;
  const walker = doc.createTreeWalker(doc.body, filter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.nodeName) || isOurs(parent)) return filter.FILTER_REJECT;
      return filter.FILTER_ACCEPT;
    },
  });
  const ranges = [];
  for (let node = walker.nextNode(); node && ranges.length < MOST; node = walker.nextNode()) {
    for (const [start, end] of findWordRanges(node.nodeValue, list)) {
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
      if (ranges.length >= MOST) break;
    }
  }
  found.api.set(name, new found.Make(...ranges));
  return ranges.length;
}

export function clearHighlights(doc) {
  const found = registry(doc);
  if (!found) return;
  found.api.delete(MARK);
  found.api.delete(SKIP);
}
