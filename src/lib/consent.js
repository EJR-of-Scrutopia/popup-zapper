export const CMP_SELECTORS = [
  "#onetrust-banner-sdk",
  ".qc-cmp2-container",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  ".cc-window",
  "[id*='cookie' i][class*='banner' i]",
];

const REJECT_PATTERNS = [
  /reject all/i, /reject/i, /decline/i, /refuse/i,
  /necessary only/i, /only necessary/i, /essential only/i,
  /do not (accept|consent)/i, /deny/i,
];

const CLICKABLE = "button, a, [role='button'], input[type='button'], input[type='submit']";

export function findRejectButton(root) {
  if (!root) return null;
  const candidates = root.matches && root.matches(CLICKABLE)
    ? [root, ...root.querySelectorAll(CLICKABLE)]
    : [...root.querySelectorAll(CLICKABLE)];
  for (const node of candidates) {
    const label = (node.textContent || node.value || "").trim();
    if (!label) continue;
    if (REJECT_PATTERNS.some((re) => re.test(label))) return node;
  }
  return null;
}