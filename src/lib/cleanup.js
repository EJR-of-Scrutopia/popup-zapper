export const ANALYTICS_KEYS = [
  /^_ga/, /^_gid/, /^_gat/, /^__utm/, /^_fbp$/, /^_fbc$/,
  /^_hj/, /^amplitude/, /^mp_/, /^ajs_/, /^optimizely/,
];

function isTrackingKey(key) {
  return ANALYTICS_KEYS.some((re) => re.test(key));
}

export function clearTrackingStorage(storage) {
  if (!storage) return;
  const doomed = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isTrackingKey(k)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
}

export function clearTrackingCookies(doc) {
  if (!doc || !doc.cookie) return;
  for (const pair of doc.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (name && isTrackingKey(name)) {
      doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  }
}

export function neutralizeBeacon(nav) {
  if (!nav) return;
  try { nav.sendBeacon = () => true; } catch { /* read-only in some envs */ }
}

export function runCleanup(doc, win) {
  clearTrackingCookies(doc);
  if (win) {
    clearTrackingStorage(win.localStorage);
    clearTrackingStorage(win.sessionStorage);
    neutralizeBeacon(win.navigator);
  }
}