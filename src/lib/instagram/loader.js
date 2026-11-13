// Getting a post by letting Instagram paint it for us.
//
// The embed page is a boot script: its served HTML holds no media, so there is
// nothing to fetch and parse. Instead we put the embed in a frame parked off
// the side of the window, let Instagram's own code run, and read the painted
// DOM out of it. The frame is same-origin with the page the userscript runs on
// (both www.instagram.com), which is the whole reason this is allowed to work.
//
// The frame is always taken away again, on every path.

import { embedUrl } from "./shortcode.js";
import { readEmbedDoc } from "./embed.js";

// A frame reports no status code, so a 429, a 404 and a private post all look
// the same from here: nothing painted. The wording says that honestly rather
// than asserting a cause we cannot know.
const REASONS = {
  login: "Instagram asked that one to log in. Its own view may still show it.",
  blank: "That post did not come through. It may be private, removed, or Instagram may be rate limiting us. Its own view sometimes works.",
  unreadable: "Could not read that post's frame. Try Instagram's own view.",
  empty: "No post to open.",
};

export async function loadPost(shortcode, { doc, timeoutMs = 15000, graceMs = 5000, pollMs = 150 } = {}) {
  if (!shortcode || !doc) return { ok: false, reason: REASONS.empty };

  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  // Parked off the side rather than display:none, because a hidden frame is
  // allowed to skip layout and some browsers then never paint its images.
  Object.assign(frame.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "1000px",
    height: "1400px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  // Once only. Setting both the attribute and the property navigates twice,
  // which doubles our requests against the rate limit we are trying to avoid.
  frame.src = embedUrl(shortcode);

  // Once the frame has loaded, the post paints within a second or so if it is
  // going to at all. Shortening the wait at that point means a private or
  // removed post says so quickly instead of after the full timeout.
  let loadedAt = 0;
  if (typeof frame.addEventListener === "function") {
    frame.addEventListener("load", () => { loadedAt = Date.now(); }, { once: true });
  }

  const mount = doc.body || doc.documentElement;
  mount.appendChild(frame);

  try {
    const hardDeadline = Date.now() + timeoutMs;
    let sawLogin = false;

    for (;;) {
      let post = null;
      try {
        if (atLogin(frame)) sawLogin = true;
        const inner = frame.contentDocument;
        if (inner) post = readEmbedDoc(inner);
      } catch {
        return { ok: false, reason: REASONS.unreadable };
      }

      if (post) return { ok: true, post };

      const deadline = loadedAt ? Math.min(hardDeadline, loadedAt + graceMs) : hardDeadline;
      if (Date.now() >= deadline) {
        return { ok: false, reason: sawLogin ? REASONS.login : REASONS.blank };
      }
      await wait(pollMs);
    }
  } finally {
    try { frame.remove(); } catch { /* already gone */ }
  }
}

function atLogin(frame) {
  const href = frame.contentWindow && frame.contentWindow.location && frame.contentWindow.location.href;
  return typeof href === "string" && /\/accounts\/login/.test(href);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
