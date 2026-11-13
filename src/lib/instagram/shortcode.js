// Reading an Instagram post's shortcode out of a link or a location.
//
// Instagram serves the same post under several paths. A profile grid tile is
// often `/<username>/p/<code>/`, the canonical link is `/p/<code>/`, and reels
// and IGTV use `/reel/<code>/` and `/tv/<code>/`. Matching the segment anywhere
// in the path rather than anchoring it at the start is what covers all four.

const SHORTCODE = /\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;

export function shortcodeFromPath(path) {
  if (typeof path !== "string" || !path) return null;
  const m = SHORTCODE.exec(path);
  return m && m[1] ? m[1] : null;
}

export function shortcodeFromAnchor(el) {
  if (!el || el.nodeType !== 1) return null;
  const a = typeof el.closest === "function" ? el.closest("a[href]") : null;
  if (!a) return null;
  // getAttribute, not .href: jsdom resolves a relative href against about:blank.
  return shortcodeFromPath(a.getAttribute("href"));
}

export function embedUrl(shortcode) {
  return `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
}
