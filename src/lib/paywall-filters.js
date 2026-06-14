// Known metering / paywall vendor host patterns. Matched against the hostname of
// every resource the page loaded, to suggest uBlock Origin network filters.
export const PAYWALL_VENDORS = [
  /piano\.io/i,
  /tinypass\.com/i,
  /npttech\.com/i,      // Piano infra
  /cxense\.com/i,       // Piano/Cxense data
  /cxpublic\.com/i,
  /poool\.(fr|tech)/i,
  /pelcro\.com/i,
  /qiota/i,
  /zephr\.(io|com)/i,
  /evolok/i,
  /blueconic/i,
  /getadmiral\.com/i,
  /leakypaywall/i,
  /sophi\.io/i,
  /mather(economics)?\./i,
];

// Collect the hostnames on this page that belong to known paywall/metering
// vendors. Uses Performance resource entries (catches dynamically injected
// scripts) plus static script/iframe/link tags.
export function findPaywallHosts(doc, perf) {
  const urls = new Set();

  try {
    const entries = perf && perf.getEntriesByType ? perf.getEntriesByType("resource") : [];
    for (const e of entries) if (e && e.name) urls.add(e.name);
  } catch { /* Performance API unavailable */ }

  for (const el of doc.querySelectorAll("script[src],iframe[src],link[href]")) {
    const u = el.getAttribute("src") || el.getAttribute("href");
    if (u) urls.add(u);
  }

  const base = (doc.baseURI) || (doc.location && doc.location.href) || "https://example.com";
  const hosts = new Set();
  for (const u of urls) {
    let host;
    try { host = new URL(u, base).hostname; } catch { continue; }
    if (host && PAYWALL_VENDORS.some((re) => re.test(host))) hosts.add(host);
  }
  return [...hosts].sort();
}

// Turn a list of hosts into uBlock Origin "My filters" lines.
export function buildUblockFilters(hosts) {
  if (!hosts || !hosts.length) return "";
  const lines = ["! Popup Zapper — paywall/metering blockers"];
  for (const h of hosts) lines.push(`||${h}^`);
  return lines.join("\n");
}