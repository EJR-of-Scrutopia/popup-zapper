import { pickContent } from "./freeze.js";

// Parse a fetched HTML string and pull out the main content region.
// Returns { title, sel, html, len } or null.
export function extractCleanContent(htmlString) {
  if (!htmlString) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(htmlString, "text/html"); } catch { return null; }
  if (!doc || !doc.body) return null;
  const picked = pickContent(doc);
  if (!picked) return null;
  const titleEl = doc.querySelector("title");
  return {
    title: (titleEl && titleEl.textContent) || "",
    sel: picked.sel,
    html: picked.el.innerHTML,
    len: (picked.el.textContent || "").trim().length,
  };
}

// Apply extracted content into the live document, into the same content region.
// Inserted markup runs no scripts (innerHTML), so the gate logic does not re-run.
export function applyCleanContent(doc, extracted) {
  if (!extracted || !extracted.html) return false;
  let el;
  try { el = doc.querySelector(extracted.sel); } catch { el = null; }
  if (!el) el = doc.body;
  if (!el) return false;
  el.innerHTML = extracted.html;
  return true;
}