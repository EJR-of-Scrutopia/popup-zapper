const KEY = "popupZapper.reloads";

export function createReloadGuard({
  now, sessionStorage, hadRecentInteraction,
  maxReloads = 3, windowMs = 5000,
}) {
  function readStamps() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); }
    catch { return []; }
  }
  function writeStamps(stamps) {
    sessionStorage.setItem(KEY, JSON.stringify(stamps));
  }
  function recent() {
    const cutoff = now() - windowMs;
    return readStamps().filter((t) => t >= cutoff);
  }

  return {
    recordReload() {
      const stamps = recent();
      stamps.push(now());
      writeStamps(stamps);
    },
    isTripped() {
      return recent().length >= maxReloads;
    },
    allowReload() {
      if (this.isTripped()) return false;
      return !!hadRecentInteraction();
    },
  };
}