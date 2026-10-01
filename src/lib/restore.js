function styleOf(el) {
  const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
  return {
    filter: el.style.filter || cs.filter || "",
    backdrop: el.style.backdropFilter || cs.backdropFilter || "",
    opacity: el.style.opacity || cs.opacity || "1",
    pointerEvents: el.style.pointerEvents || cs.pointerEvents || "auto",
    userSelect: el.style.userSelect || cs.userSelect || "auto",
    maxHeight: el.style.maxHeight || cs.maxHeight || "none",
  };
}

export function detectDegradation(el) {
  const s = styleOf(el);
  const blur = /blur\(/i.test(s.filter) || /blur\(/i.test(s.backdrop);
  const opacity = parseFloat(s.opacity) <= 0.05;
  const pointerEvents = s.pointerEvents === "none";
  const userSelect = s.userSelect === "none";
  const maxHeight = /\d/.test(s.maxHeight) && s.maxHeight !== "none";
  return { blur, opacity, pointerEvents, userSelect, maxHeight };
}

export function restoreElement(el) {
  if (!el || el.nodeType !== 1) return;
  el.style.setProperty("filter", "none", "important");
  el.style.setProperty("backdrop-filter", "none", "important");
  el.style.setProperty("opacity", "1", "important");
  el.style.setProperty("pointer-events", "auto", "important");
  el.style.setProperty("user-select", "auto", "important");
  el.style.removeProperty("max-height");
}

// Strip blur wherever it appears, including blur applied via a stylesheet class
// (the ArchDaily case). Only touches the filter properties, so it is safe to run
// page-wide — unlike opacity/pointer-events, legitimate full-element blur is rare.
export function restoreBlur(doc, isWhitelisted) {
  const win = doc.defaultView || window;
  let count = 0;
  for (const el of doc.body.querySelectorAll("*")) {
    if (isWhitelisted && isWhitelisted(el)) continue;
    let cs;
    try { cs = win.getComputedStyle(el); } catch { continue; }
    const f = cs.filter || "";
    const b = cs.backdropFilter || cs.webkitBackdropFilter || "";
    if (/blur\(/i.test(f) || /blur\(/i.test(b)) {
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("backdrop-filter", "none", "important");
      el.style.setProperty("-webkit-backdrop-filter", "none", "important");
      count++;
    }
  }
  return count;
}

// The vertical overflow, which is what a scroll lock hides. jsdom keeps the
// `overflow` shorthand without its longhands, whose last word is the y value.
function overflowY(cs) {
  return cs.overflowY || (cs.overflow || "").trim().split(/\s+/).pop() || "";
}

// Undo a scroll lock on html or body, and touch nothing on a page that has
// none. A lock is overflow hidden or clip in y, or body fixed in place.
// Unlocked to `visible`, never `auto`: with html and body both non-visible,
// body's overflow stops passing to the viewport and body becomes a scroll
// container that never scrolls, and every position:sticky element on the page
// then sticks to it and scrolls away.
export function restorePage(doc) {
  const win = doc.defaultView || window;
  for (const node of [doc.documentElement, doc.body]) {
    if (!node) continue;
    let cs;
    try { cs = win.getComputedStyle(node); } catch { continue; }
    const hidden = /^(hidden|clip)$/.test(overflowY(cs));
    const fixed = node === doc.body && cs.position === "fixed";
    if (hidden) node.style.setProperty("overflow", "visible", "important");
    if (fixed) node.style.setProperty("position", "static", "important");
    if (hidden || fixed) node.style.removeProperty("height");
  }
}