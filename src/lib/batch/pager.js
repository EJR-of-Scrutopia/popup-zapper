// Finding a list's next page, shared by the batch clicker and the step
// recorder. Pure apart from the DOM and window it is handed.

import { collapse } from "./rows.js";

const NEXT_TEXT = /^(next(\s+page)?|>|›|»|→|❯|〉|〉)$/i;
const NOT_NEXT = /prev|previous|back|first|last/i;
const PAGE_NUMBER = /^\d{1,3}$/;

function hintsOf(node) {
  if (!node || typeof node.getAttribute !== "function") return "";
  return ["aria-label", "title", "rel", "class", "id"].map((name) => node.getAttribute(name) || "").join(" ");
}

function markedCurrent(node) {
  for (let at = node, step = 0; at && step < 3; at = at.parentElement, step++) {
    if (typeof at.getAttribute !== "function") break;
    const said = at.getAttribute("aria-current");
    if (said && said !== "false") return true;
    if (/(^|[-_\s])(active|current|selected|is-active|is-current)([-_\s]|$)/i.test(at.getAttribute("class") || "")) return true;
  }
  return false;
}

// The next page, best first, only after lastNode (the last item; null for
// anywhere): rel=next, a label or class saying next, or words Next / > / an
// arrow; else the page numbers (no next when the current is the highest),
// the wordless arrow after them, then the number after the current. Never
// prev/back/first/last.
export function findNextControls(doc, lastNode, { isOurs = () => false, onScreen = () => true, win = window } = {}) {
  const after = (node) => {
    if (!lastNode) return true;
    const where = lastNode.compareDocumentPosition(node);
    return (where & 4) !== 0 && (where & 16) === 0;
  };
  const clickables = Array.prototype.filter.call(doc.querySelectorAll('a, button, [role="button"]'),
    (node) => !isOurs(node) && after(node) && onScreen(node) && collapse(node.textContent || "").length <= 12);
  let best = null;
  let bestScore = 0;
  for (const control of clickables) {
    const words = collapse(control.textContent || "");
    if (NOT_NEXT.test(hintsOf(control)) || NOT_NEXT.test(words)) continue;
    const label = (control.getAttribute("aria-label") || "") + " " + (control.getAttribute("title") || "");
    let score = 0;
    if (/(^|\s)next(\s|$)/i.test(control.getAttribute("rel") || "")) score = 5;
    else if (/\bnext\b/i.test(label)) score = 4;
    else if (/next/i.test((control.getAttribute("class") || "") + " " + (control.id || "")) || NEXT_TEXT.test(words)) score = 3;
    if (score > bestScore) { best = control; bestScore = score; }
  }
  if (best) return [{ control: best, how: "the next page button" }];

  let numbers = [];
  for (const node of doc.querySelectorAll('a, button, [role="button"], li, span')) {
    if (isOurs(node) || !after(node)) continue;
    const words = collapse(node.textContent || "");
    if (!PAGE_NUMBER.test(words)) continue;
    numbers.push({ control: node.closest('a, button, [role="button"]') || node, value: Number(words) });
  }
  numbers = numbers.filter((each, at) =>
    numbers.findIndex((other) => other.control === each.control) === at
    && !numbers.some((other) => other.control !== each.control && other.value === each.value && each.control.contains(other.control)));
  if (!numbers.length) return [];
  let currentPage = numbers.filter((each) => markedCurrent(each.control));
  if (currentPage.length !== 1 && numbers.length >= 3) {
    const looks = numbers.map((each) => {
      try {
        const style = win.getComputedStyle(each.control);
        return [style.color, style.fontWeight, style.backgroundColor, style.textDecorationLine].join("|");
      } catch { return ""; }
    });
    const odd = numbers.filter((each, at) => looks.filter((look) => look === looks[at]).length === 1);
    if (odd.length === 1) currentPage = odd;
  }
  const highest = Math.max(...numbers.map((each) => each.value));
  if (currentPage.length === 1 && currentPage[0].value >= highest) return [];
  const out = [];
  const lastNumber = numbers[numbers.length - 1].control;
  const arrow = clickables.filter((control) => !collapse(control.textContent || "")
    && (lastNumber.compareDocumentPosition(control) & 4) !== 0 && !NOT_NEXT.test(hintsOf(control)))[0];
  if (arrow) out.push({ control: arrow, how: "the arrow after the page numbers" });
  if (currentPage.length === 1) {
    const target = numbers.filter((each) => each.value === currentPage[0].value + 1)[0];
    if (target) out.push({ control: target.control, how: "page " + target.value });
  }
  return out;
}
