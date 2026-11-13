// Whether the Instagram viewer should act, and how it should look.
//
// `mode` is "auto" by default: act only when signed out, so a signed-in visit is
// left completely alone. "on" acts regardless, "off" never acts.
//
// Signed-in is read from the `ds_user_id` cookie, NOT `sessionid`: Instagram sets
// sessionid HttpOnly, so no userscript can see it.

export const DEFAULT_INSTAGRAM = { mode: "auto", view: "ours" };

const HOST = "instagram.com";

export function readPrefs(library) {
  const stored = library && typeof library.instagram === "object" && library.instagram
    ? library.instagram
    : {};
  return { ...DEFAULT_INSTAGRAM, ...stored };
}

export function writePrefs(library, patch) {
  if (!library) return library;
  library.instagram = { ...readPrefs(library), ...patch };
  return library;
}

export function isSignedIn(cookie) {
  if (typeof cookie !== "string" || !cookie) return false;
  // Anchored at the start or after a separator, so not_ds_user_id and a value
  // that happens to contain the name are both ignored.
  return /(?:^|;\s*)ds_user_id=([^;]+)/.test(cookie);
}

export function isActive({ library, hostname, cookie }) {
  if (!library || library.enabled === false) return false;
  if (hostname !== HOST) return false;
  if ((library.disabledDomains || []).includes(HOST)) return false;

  const { mode } = readPrefs(library);
  if (mode === "off") return false;
  if (mode === "on") return true;
  return !isSignedIn(cookie);
}
