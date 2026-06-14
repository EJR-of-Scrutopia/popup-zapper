const WALL_TEXT = /sign ?in|log ?in|subscribe|sign ?up|register|cookie|consent|create (an )?account|continue reading/i;
const MIN_SCORE = 3;

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

export function findBestGuess(doc) {
  let best = null;
  let bestScore = MIN_SCORE - 1;
  for (const el of doc.body.querySelectorAll("*")) {
    const s = scorePopupCandidate(el);
    if (s > bestScore) { bestScore = s; best = el; }
  }
  return bestScore >= MIN_SCORE ? best : null;
}