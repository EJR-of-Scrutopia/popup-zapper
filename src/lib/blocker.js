import { getActiveRules, findMatches, matchesRule } from "./rules.js";
import { restoreElement, restorePage } from "./restore.js";
import { findRejectButton, CMP_SELECTORS } from "./consent.js";

function isWhitelisted(el, whitelist) {
  return (whitelist || []).some((rule) => matchesRule(el, rule));
}

function consentPass(doc) {
  for (const sel of CMP_SELECTORS) {
    let banner;
    try { banner = doc.querySelector(sel); } catch { banner = null; }
    if (!banner) continue;
    const reject = findRejectButton(banner);
    if (reject) { safe(() => reject.click()); return; }
    safe(() => banner.remove());
  }
}

function popupPass(doc, rules, whitelist) {
  const matches = findMatches(doc.body, rules);
  for (const el of matches) {
    if (isWhitelisted(el, whitelist)) continue;
    safe(() => el.remove());
  }
}

function restorePass(doc, rules, whitelist) {
  restorePage(doc);
  for (const el of doc.body.querySelectorAll("*")) {
    if (isWhitelisted(el, whitelist)) continue;
    const style = el.getAttribute && el.getAttribute("style");
    if (style && /blur\(|pointer-events\s*:\s*none|opacity\s*:\s*0/i.test(style)) {
      safe(() => restoreElement(el));
    }
  }
}

export function runBlocker({ doc, library, hostname }) {
  if (!library.enabled) return;
  if ((library.disabledDomains || []).includes(hostname)) return;
  const rules = getActiveRules(library, hostname);
  safe(() => consentPass(doc));
  safe(() => popupPass(doc, rules, library.whitelist));
  safe(() => restorePass(doc, rules, library.whitelist));
}

function safe(fn) {
  try { fn(); } catch { /* never let one failure break the page */ }
}