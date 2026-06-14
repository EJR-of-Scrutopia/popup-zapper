// Known third-party paywall / metering vendors that serve their gate inside a
// cross-origin iframe (we cannot reach inside it, but we can remove the iframe
// and the overlay container it sits in).
export const PAYWALL_FRAME_HOSTS = [
  /(^|\.|\/)piano\.io/i,
  /tinypass\.com/i,
  /poool\.(fr|tech)/i,
  /qiota\./i,
  /leakypaywall/i,
  /pelcro\./i,
];

const OVERLAY_SEL = [
  '[class*="piano" i]', '[class*="paywall" i]', '[class*="gate" i]',
  '[class*="overlay" i]', '[class*="modal" i]',
  '[id*="piano" i]', '[id*="paywall" i]',
].join(",");

// Remove paywall-vendor iframes and their nearest overlay container. Returns the
// list of removed container labels (for logging).
export function removePaywallFrames(doc) {
  const removed = [];
  for (const frame of doc.querySelectorAll("iframe")) {
    const src = frame.getAttribute("src") || "";
    if (!PAYWALL_FRAME_HOSTS.some((re) => re.test(src))) continue;
    let target = frame;
    try { target = frame.closest(OVERLAY_SEL) || frame.parentElement || frame; } catch { /* ignore */ }
    const label = (target.className && typeof target.className === "string")
      ? `.${target.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : target.tagName.toLowerCase();
    try { target.remove(); removed.push(label); }
    catch { try { frame.remove(); removed.push("iframe"); } catch { /* ignore */ } }
  }
  return removed;
}