const WALL_TEXT = /sign ?in|log ?in|subscribe|sign ?up|register|cookie|consent|create (an )?account|continue reading/i;
const MIN_SCORE = 3;
// Other browser extensions inject their own roots; never treat them as popups.
const EXT_ROOTS = /protonpass|1password|onepassword|bitwarden|lastpass|dashlane|grammarly|honey-|metamask|__crx/i;
// Site chrome (header/nav/footer) is never a popup; removing it breaks the page.
const CHROME_SEL = "header,nav,footer,[role=banner],[role=navigation],[role=contentinfo]";

export function scorePopupCandidate(el) {
  if (!el || el.nodeType !== 1) return 0;
  const view = el.ownerDocument.defaultView || window;
  const cs = view.getComputedStyle(el);
  let score = 0;

  const pos = el.style.position || cs.position;
  if (pos === "fixed" || pos === "sticky") score += 3;
  if (pos === "absolute") score += 1;

  const z = parseInt(el.style.zIndex || cs.zIndex, 10);
  if (!Number.isNaN(z)) {
    if (z >= 1000) score += 3;
    else if (z > 0) score += 1;
  }

  const filter = el.style.filter || cs.filter || "";
  if (/blur\(/i.test(filter)) score += 1;

  if (WALL_TEXT.test(el.textContent || "")) score += 2;

  return score;
}

// requireText (used by auto-zap): only consider modal-sized elements whose text
// reads like a wall, so we never auto-remove empty overlays or legit site UI.
export function findBestGuess(doc, opts = {}) {
  const requireText = !!opts.requireText;
  let best = null;
  let bestScore = MIN_SCORE - 1;
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue; // never target our own UI
    if (el.id && EXT_ROOTS.test(el.id)) continue; // skip other extensions' roots
    if (el.closest && el.closest(CHROME_SEL)) continue; // skip site header/nav/footer
    if (requireText) {
      const text = (el.textContent || "").trim();
      if (!text || text.length > 800 || !WALL_TEXT.test(text)) continue;
    }
    const s = scorePopupCandidate(el);
    if (s > bestScore) { bestScore = s; best = el; }
  }
  return bestScore >= MIN_SCORE ? best : null;
}