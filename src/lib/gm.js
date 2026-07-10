// Normalizes userscript-manager API differences behind one interface.
// Tampermonkey/Violentmonkey expose synchronous GM_* AND async GM.*; the Safari
// Userscripts app exposes async GM.* only (no sync storage, no menu commands).
// Fallback order is chosen per method, not uniform: storage (get/set) prefers
// async GM.* because it is the only form the Safari app offers; the action
// methods (xhr/clipboard/openTab) prefer the callback GM_* form for reliable
// onload semantics, then GM.*, then a plain web-API shim. All degrade gracefully.
export function createGm(env = globalThis) {
  const has = (name) => typeof env[name] === "function";
  const gmNs = env.GM && typeof env.GM === "object" ? env.GM : null;

  async function get(key, dflt) {
    if (gmNs && typeof gmNs.getValue === "function") return gmNs.getValue(key, dflt);
    if (has("GM_getValue")) {
      const v = env.GM_getValue(key);
      return v === undefined ? dflt : v;
    }
    if (env.localStorage) {
      const v = env.localStorage.getItem(key);
      return v === null || v === undefined ? dflt : v;
    }
    return dflt;
  }

  async function set(key, val) {
    if (gmNs && typeof gmNs.setValue === "function") return void (await gmNs.setValue(key, val));
    if (has("GM_setValue")) return void env.GM_setValue(key, val);
    if (env.localStorage) return void env.localStorage.setItem(key, val);
  }

  function xhr(details) {
    if (has("GM_xmlhttpRequest")) return env.GM_xmlhttpRequest(details);
    if (gmNs && typeof gmNs.xmlHttpRequest === "function") return gmNs.xmlHttpRequest(details);
    // Last-resort fetch shim (same-origin or CORS-permitted only).
    if (typeof env.fetch === "function") {
      env.fetch(details.url, { method: details.method || "GET" })
        .then((r) => r.text().then((t) => details.onload && details.onload({ responseText: t, status: r.status })))
        .catch(() => details.onerror && details.onerror());
    } else if (details.onerror) details.onerror();
  }

  async function clipboard(text) {
    if (has("GM_setClipboard")) return void env.GM_setClipboard(text);
    if (gmNs && typeof gmNs.setClipboard === "function") return void (await gmNs.setClipboard(text));
    if (env.navigator && env.navigator.clipboard) return env.navigator.clipboard.writeText(text);
  }

  function openTab(url) {
    if (has("GM_openInTab")) return void env.GM_openInTab(url, { active: true });
    if (gmNs && typeof gmNs.openInTab === "function") return void gmNs.openInTab(url, false);
    if (typeof env.open === "function") { const w = env.open(url, "_blank"); if (!w && env.location) env.location.href = url; return; }
    if (env.location) env.location.href = url;
  }

  return { get, set, xhr, clipboard, openTab };
}