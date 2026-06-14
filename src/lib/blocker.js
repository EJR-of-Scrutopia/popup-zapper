import { getActiveRules, findMatches, matchesRule } from "./rules.js";
import { restoreElement, restorePage, restoreBlur } from "./restore.js";
import { findRejectButton, CMP_SELECTORS } from "./consent.js";
import { findBestGuess } from "./learner.js";
import { runCleanup } from "./cleanup.js";

function isWhitelisted(el, whitelist) {
  return (whitelist || []).some((rule) => matchesRule(el, rule));
}

function describe(el) {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList && el.classList.length
    ? "." + [...el.classList].slice(0, 2).join(".")
    : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

function consentPass(doc, log) {
  for (const sel of CMP_SELECTORS) {
    let banner;
    try { banner = doc.querySelector(sel); } catch { banner = null; }
    if (!banner) continue;
    const reject = findRejectButton(banner);
    if (reject) {
      safe(() => reject.click());
      log("consent", `clicked reject in ${describe(banner)}`);
      return;
    }
    safe(() => banner.remove());
    log("consent", `hid banner ${describe(banner)}`);
  }
}

function popupPass(doc, rules, whitelist, log) {
  const matches = findMatches(doc.body, rules);
  for (const el of matches) {
    if (isWhitelisted(el, whitelist)) continue;
    const desc = describe(el);
    safe(() => el.remove());
    log("popup", `removed ${desc} (matched rule)`);
  }
}

// Auto-zap: remove the single highest-scoring popup/overlay even without a
// learned rule. Opt-in per site because it is heuristic and can misfire.
function autozapPass(doc, whitelist, log) {
  const guess = findBestGuess(doc);
  if (!guess) return;
  if (isWhitelisted(guess, whitelist)) return;
  const desc = describe(guess);
  safe(() => guess.remove());
  log("autozap", `auto-removed ${desc}`);
}

function restorePass(doc, whitelist, log) {
  restorePage(doc);
  // Conservative inline restore for opacity / pointer-events locks.
  for (const el of doc.body.querySelectorAll("*")) {
    if (isWhitelisted(el, whitelist)) continue;
    const style = el.getAttribute && el.getAttribute("style");
    if (style && /pointer-events\s*:\s*none|opacity\s*:\s*0/i.test(style)) {
      safe(() => restoreElement(el));
    }
  }
  // Page-wide blur removal (catches stylesheet-class blur).
  const n = safeVal(() => restoreBlur(doc, (el) => isWhitelisted(el, whitelist)), 0);
  if (n) log("deblur", `removed blur from ${n} element(s)`);
}

export function runBlocker({ doc, library, hostname, log = () => {} }) {
  if (!library.enabled) return;
  if ((library.disabledDomains || []).includes(hostname)) return;
  const rules = getActiveRules(library, hostname);
  const domain = (library.domains || {})[hostname];
  safe(() => consentPass(doc, log));
  if (domain && domain.cleanup) {
    safe(() => runCleanup(doc, doc.defaultView));
    log("cleanup", "cleared tracking cookies/storage");
  }
  safe(() => popupPass(doc, rules, library.whitelist, log));
  if (domain && domain.autozap) {
    safe(() => autozapPass(doc, library.whitelist, log));
  }
  safe(() => restorePass(doc, library.whitelist, log));
}

function safe(fn) {
  try { fn(); } catch { /* never let one failure break the page */ }
}

function safeVal(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}