import { scorePopupCandidate } from "./learner.js";

const MAX_CANDIDATES = 8;

function rankCandidates(doc) {
  const scored = [];
  for (const el of doc.body.querySelectorAll("*")) {
    if (el.closest && el.closest("[data-pz]")) continue;
    const s = scorePopupCandidate(el);
    if (s > 0) scored.push({ el, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, MAX_CANDIDATES).map((x) => x.el);
}

export function createPicker(doc) {
  const candidates = rankCandidates(doc);
  let idx = 0;
  let target = candidates[0] || doc.body;

  return {
    current() { return target; },
    candidateCount() { return candidates.length; },
    nextCandidate() {
      if (!candidates.length) return target;
      idx = (idx + 1) % candidates.length;
      target = candidates[idx];
      return target;
    },
    prevCandidate() {
      if (!candidates.length) return target;
      idx = (idx - 1 + candidates.length) % candidates.length;
      target = candidates[idx];
      return target;
    },
    grow() {
      if (target && target.parentElement && target.parentElement !== doc.documentElement
          && target !== doc.body) {
        target = target.parentElement;
      }
      return target;
    },
    shrink() {
      const child = target && target.firstElementChild;
      if (child) target = child;
      return target;
    },
  };
}