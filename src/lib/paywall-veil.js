// Full-viewport fixed overlays that veil/blur the page behind a metering gate
// (e.g. ArchDaily's Piano ".piano-meter-overlay"). De-blurring alone leaves the
// semi-opaque background, so we remove the whole overlay.
const VENDOR_SEL = [
  '[class*="piano-meter" i]', '[class*="tp-modal" i]', '[class*="tp-backdrop" i]',
  '[class*="poool" i]', '[class*="pelcro" i]', '[class*="zephr" i]',
  '[class*="paywall" i]', '[class*="regwall" i]',
].join(",");

function safeMatches(el, sel) { try { return el.matches(sel); } catch { return false; } }

export function isVeilOverlay(el, win) {
  if (!el || el.nodeType !== 1) return false;
  let cs; try { cs = win.getComputedStyle(el); } catch { return false; }
  if (cs.position !== "fixed") return false;

  // Covers ~the whole viewport (skip the size test when layout is unavailable,
  // e.g. jsdom returns 0x0).
  let rect; try { rect = el.getBoundingClientRect(); } catch { rect = null; }
  const vw = win.innerWidth || 1024, vh = win.innerHeight || 768;
  if (rect && rect.width * rect.height > 0) {
    if (rect.width < vw * 0.9 || rect.height < vh * 0.9) return false;
  }

  if (safeMatches(el, VENDOR_SEL)) return true; // known metering veil

  const z = parseInt(cs.zIndex, 10);
  const highZ = !Number.isNaN(z) && z >= 1000;
  // jsdom drops backdrop-filter from CSSOM, so also read the raw inline style.
  const rawStyle = (el.getAttribute && el.getAttribute("style")) || "";
  const blur = /blur\(/i.test(cs.backdropFilter || cs.webkitBackdropFilter || "") ||
               /blur\(/i.test(cs.filter || "") ||
               /blur\(/i.test(rawStyle);
  return highZ && blur; // generic full-screen blur veil
}

export function removeVeils(doc, skip) {
  const win = doc.defaultView || window;
  const removed = [];
  for (const el of doc.body.querySelectorAll("div,section,aside")) {
    if (skip && skip(el)) continue;
    if (!isVeilOverlay(el, win)) continue;
    const label = el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : el.tagName.toLowerCase();
    try { el.remove(); removed.push(label); } catch { /* ignore */ }
  }
  return removed;
}