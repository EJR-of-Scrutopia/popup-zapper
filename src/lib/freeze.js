// "Keep content": snapshot the fullest version of an article while it is visible,
// and restore it if the page later reloads into a gated/smaller version. The full
// content was already delivered to the browser; this just preserves it across the
// gating refresh (sessionStorage survives same-tab reloads).
const PREFIX = "pzFreeze:";
const MIN_TEXT = 400;

const CONTENT_SELECTORS = [
  "article", "main", "[role=main]",
  ".article-body", ".article__body", ".post-content", ".entry-content",
  "#content", "#main",
];

function keyFor(doc) {
  return PREFIX + ((doc.location && doc.location.pathname) || "/");
}

// Choose the main content element: the longest-text match of a known content
// selector, else the body. Returns { el, sel } or null.
export function pickContent(doc) {
  for (const sel of CONTENT_SELECTORS) {
    let best = null, bestLen = 0;
    for (const el of doc.querySelectorAll(sel)) {
      const len = (el.textContent || "").trim().length;
      if (len > bestLen) { bestLen = len; best = el; }
    }
    if (best && bestLen >= MIN_TEXT) return { el: best, sel };
  }
  if (doc.body) return { el: doc.body, sel: "body" };
  return null;
}

// Save the current content if it is the fullest seen so far (or force=true).
export function captureSnapshot(doc, store, force) {
  const picked = pickContent(doc);
  if (!picked) return false;
  const text = (picked.el.textContent || "").trim();
  if (!force && text.length < MIN_TEXT) return false;
  const key = keyFor(doc);
  if (!force) {
    let prev = 0;
    try { const p = JSON.parse(store.getItem(key) || "null"); prev = p ? p.len : 0; } catch { /* ignore */ }
    if (text.length <= prev) return false; // keep only the largest version
  }
  try {
    store.setItem(key, JSON.stringify({ sel: picked.sel, html: picked.el.innerHTML, len: text.length }));
    return true;
  } catch { return false; }
}

// Restore the saved snapshot if the live content is much smaller (gated), or force.
export function restoreSnapshot(doc, store, force) {
  const key = keyFor(doc);
  let snap;
  try { snap = JSON.parse(store.getItem(key) || "null"); } catch { return false; }
  if (!snap || !snap.html) return false;
  let el;
  try { el = doc.querySelector(snap.sel); } catch { el = null; }
  if (!el) el = doc.body;
  if (!el) return false;
  const curLen = (el.textContent || "").trim().length;
  if (!force && curLen >= snap.len * 0.6) return false; // looks complete already
  el.innerHTML = snap.html;
  return true;
}