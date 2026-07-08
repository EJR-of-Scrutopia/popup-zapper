export function parseVersion(headerText) {
  const m = /@version\s+([0-9][0-9A-Za-z.\-]*)/.exec(headerText || "");
  return m ? m[1] : null;
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function updateMessage(current, remote) {
  if (!remote) return "Couldn't check for updates (network blocked).";
  const c = compareVersions(remote, current);
  if (c > 0) return `v${remote} available — your userscript manager will install it.`;
  return "Up to date ✓";
}