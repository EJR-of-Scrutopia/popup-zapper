// Wiring: what the user does, and what the viewer does about it.
//
// The click listener is installed in the capture phase so it runs ahead of
// Instagram's own handler, which is how the login box is never raised at all
// rather than dismissed after the fact.
//
// It installs at document-start, before the stored library has resolved. A
// click landing in that window is held, not swallowed for good: once the answer
// arrives it either opens the viewer or replays the navigation it prevented.

import { shortcodeFromAnchor, shortcodeFromPath } from "./shortcode.js";
import { readPrefs, writePrefs, isActive } from "./prefs.js";
import { loadPost as realLoadPost } from "./loader.js";
import { createLightbox as realCreateLightbox } from "./lightbox.js";
import { saveMedia } from "./save.js";

const TILE = "a[href*='/p/'], a[href*='/reel/'], a[href*='/tv/']";

export function createInstagramTool({
  doc,
  win,
  ready,
  getCookie = () => doc.cookie,
  saveLibrary = () => {},
  gmXhr,
  loadPost = realLoadPost,
  createLightbox = realCreateLightbox,
}) {
  let library = null;
  let resolved = false;
  let box = null;
  let current = null;
  let pending = null;
  let running = false;

  const readyPromise = Promise.resolve(ready).then((lib) => {
    library = lib;
    resolved = true;
    return lib;
  });

  function active() {
    return isActive({
      library,
      hostname: "instagram.com",
      cookie: safeCookie(),
    });
  }

  function safeCookie() {
    try { return getCookie() || ""; } catch { return ""; }
  }

  // A modified or non-primary click means "open in a new tab"; never take it.
  function isPlainLeftClick(e) {
    return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
  }

  function onClick(e) {
    if (!isPlainLeftClick(e)) return;
    const code = shortcodeFromAnchor(e.target);
    if (!code) return;

    if (!resolved) {
      // Hold it: we do not yet know whether we are entitled to it.
      const anchor = e.target.closest && e.target.closest("a[href]");
      const href = anchor && anchor.getAttribute("href");
      e.preventDefault();
      e.stopPropagation();
      pending = { code, href };
      return;
    }

    if (!active()) return;
    e.preventDefault();
    e.stopPropagation();
    openShortcode(code);
  }

  function settlePending() {
    const held = pending;
    pending = null;
    if (!held) return;
    if (active()) openShortcode(held.code);
    else if (held.href) win.location.href = held.href;
  }

  function tiles() {
    // Read fresh every time. Instagram swaps grid nodes out as you scroll, so a
    // list cached when the lightbox opened would be stale by the first step.
    const out = [];
    const seen = new Set();
    for (const a of doc.querySelectorAll(TILE)) {
      const code = shortcodeFromPath(a.getAttribute("href"));
      if (code && !seen.has(code)) { seen.add(code); out.push(code); }
    }
    return out;
  }

  async function step(direction) {
    if (!current) return;
    const all = tiles();
    const at = all.indexOf(current);
    if (at < 0) return;
    const next = all[at + direction];
    if (!next) return;
    await openShortcode(next);
  }

  function ensureBox(code) {
    if (box) box.close();
    box = createLightbox({
      doc,
      shortcode: code,
      onClose: close,
      onStep: step,
      onSave: (item) => saveMedia(item, { shortcode: current, gmXhr, doc }),
      onViewChange: (view) => {
        if (library) { writePrefs(library, { view }); saveLibrary(library); }
        if (box && lastPost) box.showPost(lastPost, { view });
      },
    });
    box.open();
    return box;
  }

  let lastPost = null;

  async function openShortcode(code) {
    if (!code || code === current || running) return;
    running = true;
    current = code;
    lastPost = null;
    try {
      // The stored view must be known before the first paint, or the first post
      // of a session always opens in the default rather than the chosen one.
      await readyPromise;
      const view = readPrefs(library).view;
      ensureBox(code);
      const res = await loadPost(code, { doc });
      if (current !== code) return; // stepped on while loading
      if (res.ok) { lastPost = res.post; box.showPost(res.post, { view }); }
      else box.showMessage(res.reason);
    } finally {
      running = false;
    }
  }

  function close() {
    if (box) box.close();
    box = null;
    current = null;
    lastPost = null;
  }

  let lastPathCode = null;

  function checkLocation() {
    if (!active()) return;
    const code = shortcodeFromPath(win.location.pathname);
    // Only close on an actual move AWAY from a post. At startup there is no
    // previous location, so a profile URL must not shut a viewer that a held
    // click has just opened.
    if (code) openShortcode(code);
    else if (lastPathCode && box) close();
    lastPathCode = code;
  }

  function onPopState() { checkLocation(); }

  // A post URL can resolve before the document has a body to mount into: this
  // runs at document-start, and the viewer needs somewhere to go.
  function whenMountable(fn) {
    if (doc.body) { fn(); return; }
    doc.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  function start() {
    doc.addEventListener("click", onClick, true);
    win.addEventListener("popstate", onPopState);
    readyPromise.then(() => {
      // A click means the document was already there to be clicked.
      settlePending();
      whenMountable(checkLocation);
    });
  }

  function stop() {
    doc.removeEventListener("click", onClick, true);
    win.removeEventListener("popstate", onPopState);
    close();
  }

  return { start, stop, openShortcode, isActive: active, ready: readyPromise };
}
