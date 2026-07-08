// Aggressive content restore. NOT run automatically — it can expand legitimate
// collapsed sections and reveal hidden menus, so it runs only on the user's
// "Reveal (deeper)" action, surfaced when hasResidualGating() is true.
const MIN_TEXT = 600;
const MAX_CLAMP = 2000; // ignore very tall max-heights (likely legit layout)

function clamped(cs) {
  const mh = parseFloat(cs.maxHeight);
  const hidden = /hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY);
  return !Number.isNaN(mh) && cs.maxHeight !== "none" && mh < MAX_CLAMP && hidden;
}

export function hasResidualGating(doc) {
  const win = doc.defaultView || window;
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    let cs; try { cs = win.getComputedStyle(el); } catch { continue; }
    const long = (el.textContent || "").length > MIN_TEXT;
    if (long && clamped(cs)) return true;
    if (long && parseFloat(cs.opacity || "1") <= 0.05) return true;
  }
  return false;
}

export function revealDeep(doc, skip) {
  const win = doc.defaultView || window;
  let changes = 0;
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    if (skip && skip(el)) continue;
    let cs; try { cs = win.getComputedStyle(el); } catch { continue; }
    const long = (el.textContent || "").length > MIN_TEXT;

    if (long && clamped(cs)) {
      el.style.setProperty("max-height", "none", "important");
      el.style.setProperty("overflow", "visible", "important");
      changes++;
    }
    const inline = (el.getAttribute && el.getAttribute("style")) || "";
    if (/pointer-events\s*:\s*none|opacity\s*:\s*0(?!\.)/i.test(inline)) {
      el.style.setProperty("pointer-events", "auto", "important");
      el.style.setProperty("opacity", "1", "important");
      changes++;
    }
    if (/blur\(/i.test(cs.filter || "") || /blur\(/i.test(cs.backdropFilter || "")) {
      el.style.setProperty("filter", "none", "important");
      el.style.setProperty("backdrop-filter", "none", "important");
      changes++;
    }
  }
  return changes;
}