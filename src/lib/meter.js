// Storage/cookie keys that look like a registration/metering counter. Deleting
// these resets the "you've read N free articles" gate so each load is a fresh visit.
export const METER_KEYS =
  /paywall|meter|reg-?wall|hard-?wall|soft-?wall|freemium|article.?(count|views?|read)|(page|view|read|visit|article).?count|free.?(article|view|read)|content.?gate/i;

// Keys we must NEVER delete — clearing these would log the user out or break
// their session / cart / consent choices.
export const AUTH_KEYS =
  /auth|session|token|login|logged|jwt|csrf|xsrf|\bsid\b|\buid\b|guid|remember|credential|oauth|sso|account|cart|checkout|consent|gdpr/i;

export function shouldClear(key) {
  if (!key) return false;
  if (AUTH_KEYS.test(key)) return false;
  return METER_KEYS.test(key);
}

function clearStorage(storage) {
  if (!storage) return [];
  const doomed = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (shouldClear(k)) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
  } catch { /* storage may be blocked */ }
  return doomed;
}

function clearCookies(doc) {
  if (!doc || !doc.cookie) return [];
  const cleared = [];
  for (const pair of doc.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (shouldClear(name)) {
      doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      cleared.push(name);
    }
  }
  return cleared;
}

// Clear metering counters from cookies + storage. Returns the cleared key names.
export function resetMeter(doc, win) {
  const cleared = [];
  if (win) {
    cleared.push(...clearStorage(win.localStorage));
    cleared.push(...clearStorage(win.sessionStorage));
  }
  cleared.push(...clearCookies(doc));
  return cleared;
}