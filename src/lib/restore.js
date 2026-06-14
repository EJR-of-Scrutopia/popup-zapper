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

export function restorePage(doc) {
  const html = doc.documentElement;
  const body = doc.body;
  for (const node of [html, body]) {
    if (!node) continue;
    node.style.setProperty("overflow", "auto", "important");
    node.style.setProperty("position", "static", "important");
    node.style.removeProperty("height");
  }
}