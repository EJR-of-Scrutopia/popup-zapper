import { scorePopupCandidate } from "./learner.js";

function describe(el) {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList && el.classList.length
    ? "." + [...el.classList].slice(0, 3).join(".")
    : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

// Produce a human-readable report of what the zapper "sees" on the page, so the
// real DOM can be inspected without a DevTools connection. Used by the
// "Copy diagnostics" command.
export function collectDiagnostics(doc) {
  const win = doc.defaultView || window;
  const out = [];
  out.push(`Popup Zapper diagnostics`);
  out.push(`URL: ${(doc.location && doc.location.href) || ""}`);

  const iframes = [...doc.querySelectorAll("iframe")];
  out.push(`iframes: ${iframes.length}`);
  iframes.slice(0, 12).forEach((f) => out.push(`  iframe src=${f.getAttribute("src") || "(none)"}`));

  const scored = [];
  const blurred = [];
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    let cs;
    try { cs = win.getComputedStyle(el); } catch { continue; }

    const score = scorePopupCandidate(el);
    if (score > 0) {
      let w = 0, h = 0;
      try { const r = el.getBoundingClientRect(); w = Math.round(r.width); h = Math.round(r.height); } catch { /* ignore */ }
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
      scored.push({ score, label: describe(el), pos: cs.position, z: cs.zIndex, w, h, text });
    }

    const f = cs.filter || "";
    const b = cs.backdropFilter || cs.webkitBackdropFilter || "";
    if (/blur\(/i.test(f) || /blur\(/i.test(b)) {
      blurred.push(`${describe(el)}  filter=${f || "-"}  backdrop=${b || "-"}`);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  out.push(`\nTop popup candidates (score > 0): ${scored.length}`);
  scored.slice(0, 15).forEach((s) =>
    out.push(`  [${s.score}] ${s.label} pos=${s.pos} z=${s.z} ${s.w}x${s.h} "${s.text}"`));

  out.push(`\nBlurred elements: ${blurred.length}`);
  blurred.slice(0, 15).forEach((b) => out.push(`  ${b}`));

  return out.join("\n");
}