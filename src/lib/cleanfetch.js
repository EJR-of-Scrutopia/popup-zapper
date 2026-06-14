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

// Build a self-contained cleaned HTML document from fetched markup: strip all
// scripts (so no gate logic runs), remove obvious gate overlays, add a <base> so
// relative images/CSS still resolve against the original site, and unfreeze
// scroll. Returned string is meant to be served via a blob: URL.
export function buildCleanDocument(htmlString, baseUrl) {
  if (!htmlString) return null;
  let doc;
  try { doc = new DOMParser().parseFromString(htmlString, "text/html"); } catch { return null; }
  if (!doc || !doc.documentElement) return null;

  doc.querySelectorAll("script,noscript").forEach((n) => n.remove());
  doc.querySelectorAll(
    '[class*="paywall" i],[class*="regwall" i],[class*="gate" i],[id*="paywall" i],[id*="regwall" i]'
  ).forEach((n) => n.remove());

  if (baseUrl && doc.head) {
    let base = doc.querySelector("base");
    if (!base) { base = doc.createElement("base"); doc.head.insertBefore(base, doc.head.firstChild); }
    base.setAttribute("href", baseUrl);
  }
  if (doc.body) { doc.body.style.overflow = "auto"; doc.body.style.position = "static"; }
  doc.documentElement.style.overflow = "auto";

  return "<!DOCTYPE html>" + doc.documentElement.outerHTML;
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