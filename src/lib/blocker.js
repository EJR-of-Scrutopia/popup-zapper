import { getActiveRules, findMatches, matchesRule } from "./rules.js";
import { restoreElement, restorePage, restoreBlur } from "./restore.js";
import { findRejectButton, CMP_SELECTORS } from "./consent.js";
import { findBestGuess } from "./learner.js";
import { removePaywallFrames } from "./frames.js";
import { runCleanup } from "./cleanup.js";

function isWhitelisted(el, whitelist) {
  return (whitelist || []).some((rule) => matchesRule(el, rule));
}

// The zapper's own injected UI is marked with [data-pz]; never act on it.
function isOwnUI(el) {
  return !!(el.closest && el.closest("[data-pz]"));
}

function skip(el, whitelist) {
  return isOwnUI(el) || isWhitelisted(el, whitelist);
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
    if (skip(el, whitelist)) continue;
    const desc = describe(el);
    safe(() => el.remove());
    log("popup", `removed ${desc} (matched rule)`);
  }
}

// Auto-zap: remove the single highest-scoring popup/overlay even without a
// learned rule. Opt-in per site because it is heuristic and can misfire.
function autozapPass(doc, whitelist, log) {
  const guess = findBestGuess(doc, { requireText: true });
  if (!guess) return;
  if (skip(guess, whitelist)) return;
  const desc = describe(guess);
  safe(() => guess.remove());
  log("autozap", `auto-removed ${desc}`);
}

// Text used by forced sign-up / "register to keep reading" gates (not paywalls
// per se — these gate otherwise-free content to capture you).
const GATE_TEXT =
  /register|sign ?up|create (a )?(free )?account|continue reading|keep reading|to continue|unlock( this)? (article|content)|to read (the|this|more)|log ?in to (read|view|continue)|free account to/i;

// Undo client-side content gating: remove "register to continue" overlays and
// clear max-height truncation, so content the site loaded then hid stays visible.
// Re-runs via the observer, so it survives the site re-applying the gate.
function unlockContent(doc, whitelist, log) {
  const win = doc.defaultView || window;
  let changes = 0;

  // 1. Remove positioned gate overlays whose (short) text is a sign-up prompt.
  for (const el of doc.body.querySelectorAll("div,section,aside,dialog,form")) {
    if (skip(el, whitelist)) continue;
    let cs; try { cs = win.getComputedStyle(el); } catch { continue; }
    if (!/^(fixed|absolute|sticky)$/.test(cs.position)) continue;
    const text = (el.textContent || "").trim();
    if (text.length > 0 && text.length < 600 && GATE_TEXT.test(text)) {
      safe(() => el.remove());
      changes++;
    }
  }

  // 2. Clear max-height truncation on long-text containers (the "read more" clamp).
  for (const el of doc.body.querySelectorAll("*")) {
    if (skip(el, whitelist)) continue;
    let cs; try { cs = win.getComputedStyle(el); } catch { continue; }
    const mh = parseFloat(cs.maxHeight);
    const clipped = /hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY);
    if (!Number.isNaN(mh) && cs.maxHeight !== "none" && mh < 2000 && clipped) {
      if ((el.textContent || "").length > 600) {
        el.style.setProperty("max-height", "none", "important");
        el.style.setProperty("overflow", "visible", "important");
        changes++;
      }
    }
  }

  if (changes) log("unlock", `unlocked gated content (${changes} change(s))`);
}

function restorePass(doc, whitelist, log) {
  restorePage(doc);
  // Conservative inline restore for opacity / pointer-events locks.
  for (const el of doc.body.querySelectorAll("*")) {
    if (skip(el, whitelist)) continue;
    const style = el.getAttribute && el.getAttribute("style");
    if (style && /pointer-events\s*:\s*none|opacity\s*:\s*0/i.test(style)) {
      safe(() => restoreElement(el));
    }
  }
  // Page-wide blur removal (catches stylesheet-class blur).
  const n = safeVal(() => restoreBlur(doc, (el) => skip(el, whitelist)), 0);
  if (n) log("deblur", `removed blur from ${n} element(s)`);
}

export function runBlocker({ doc, library, hostname, log = () => {} }) {
  if (!library.enabled) return;
  if ((library.disabledDomains || []).includes(hostname)) return;
  const rules = getActiveRules(library, hostname);
  const domain = (library.domains || {})[hostname];
  safe(() => consentPass(doc, log));
  const frames = safeVal(() => removePaywallFrames(doc), []);
  if (frames.length) log("paywall", `removed ${frames.length} paywall overlay(s): ${frames.join(", ")}`);
  if (domain && domain.cleanup) {
    safe(() => runCleanup(doc, doc.defaultView));
    log("cleanup", "cleared tracking cookies/storage");
  }
  safe(() => popupPass(doc, rules, library.whitelist, log));
  if (domain && domain.autozap) {
    safe(() => autozapPass(doc, library.whitelist, log));
    safe(() => unlockContent(doc, library.whitelist, log));
  }
  safe(() => restorePass(doc, library.whitelist, log));
}

function safe(fn) {
  try { fn(); } catch { /* never let one failure break the page */ }
}

function safeVal(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}