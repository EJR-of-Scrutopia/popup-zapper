// The overlay a post opens in.
//
// Lives in a shadow root so Instagram's stylesheet cannot reach into it, and on
// a host carrying data-pz so Zapper's own blocker and cleanup passes skip it.
//
// It renders and nothing else: no fetching, no preferences, no knowledge of the
// grid. Everything it learns, it learns through showPost / showMessage, and
// everything it wants done, it asks for through the four callbacks.

import { embedUrl } from "./shortcode.js";

const CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  background: rgba(0,0,0,.92);
  display: flex; align-items: center; justify-content: center;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #f2f2f2;
}
.sheet {
  display: flex; flex-direction: column; align-items: center;
  max-width: 96vw; max-height: 96vh; gap: 10px;
}
.stage {
  display: flex; align-items: center; justify-content: center;
  max-width: 96vw; max-height: 78vh; overflow: auto;
}
img[data-pz-media], video { max-width: 96vw; max-height: 78vh; display: block; border-radius: 4px; }
img[data-pz-zoom="1"] { max-width: none; max-height: none; cursor: zoom-out; }
img[data-pz-zoom="0"] { cursor: zoom-in; }
iframe { width: min(96vw, 500px); height: min(90vh, 860px); border: 0; background: #fff; border-radius: 4px; }
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.meta { max-width: min(96vw, 680px); text-align: center; }
.who { font-weight: 600; }
.caption { color: #cfcfcf; margin-top: 3px; max-height: 5.5em; overflow: auto; }
.note { color: #ffd479; margin-top: 4px; }
button, a.btn {
  border: 1px solid #4a4a4a; background: #222; color: #f2f2f2;
  border-radius: 5px; padding: 4px 10px; cursor: pointer;
  font: 12px sans-serif; text-decoration: none;
}
button:hover, a.btn:hover { background: #333; }
.msg { font-size: 14px; text-align: center; max-width: 60ch; }
`;

export function createLightbox({ doc, shortcode, onClose, onStep, onSave, onViewChange }) {
  let host = null;
  let rootEl = null;
  let body = null;
  let zoom = false;

  function onKey(e) {
    if (e.key === "Escape") { call(onClose); return; }
    if (e.key === "ArrowRight") { call(onStep, 1); return; }
    if (e.key === "ArrowLeft") { call(onStep, -1); }
  }

  function open() {
    if (host) return api;
    host = doc.createElement("div");
    host.setAttribute("data-pz", "instagram-viewer");
    rootEl = host.attachShadow({ mode: "open" });

    const style = doc.createElement("style");
    style.textContent = CSS;
    rootEl.appendChild(style);

    const backdrop = doc.createElement("div");
    backdrop.className = "backdrop";
    backdrop.setAttribute("data-pz-backdrop", "");
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) call(onClose); });

    body = doc.createElement("div");
    body.className = "sheet";
    backdrop.appendChild(body);
    rootEl.appendChild(backdrop);

    (doc.body || doc.documentElement).appendChild(host);
    doc.addEventListener("keydown", onKey, true);
    return api;
  }

  function close() {
    if (!host) return;
    doc.removeEventListener("keydown", onKey, true);
    try { host.remove(); } catch { /* already gone */ }
    host = null; rootEl = null; body = null; zoom = false;
  }

  function clear() {
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function el(tag, props = {}, parent = null) {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined) continue;
      if (k === "class" || k === "text") continue;
      n.setAttribute(k, v);
    }
    if (props.class) n.className = props.class;
    if (props.text) n.textContent = props.text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function viewBar(parent, current) {
    const bar = el("div", { class: "bar" }, parent);
    const other = current === "ours" ? "embed" : "ours";
    el("button", {
      "data-pz-view-toggle": "",
      text: current === "ours" ? "Instagram's own view" : "Our view",
    }, bar).addEventListener("click", () => call(onViewChange, other));
    el("a", {
      class: "btn",
      href: `https://www.instagram.com/p/${shortcode}/`,
      target: "_blank",
      rel: "noopener",
      text: "Open on Instagram",
    }, bar);
    return bar;
  }

  function showFrame(parent) {
    el("iframe", { src: embedUrl(shortcode), loading: "eager" }, parent);
  }

  function showPost(post, { view = "ours" } = {}) {
    if (!host) open();
    clear();
    zoom = false;

    // A carousel's later pictures live behind Instagram's own arrows, and the
    // embed only ever paints the first, so send a carousel there by default.
    const useFrame = view === "embed" || post.kind === "carousel";
    const stage = el("div", { class: "stage" }, body);

    if (useFrame) {
      showFrame(stage);
    } else {
      const item = post.media[0];
      if (item.type === "video" && item.url) {
        el("video", { src: item.url, poster: item.poster, controls: "", playsinline: "", autoplay: "" }, stage);
      } else {
        const src = item.type === "video" ? item.poster : item.url;
        const image = el("img", { "data-pz-media": "", "data-pz-zoom": "0", src, alt: post.caption || "Instagram post" }, stage);
        image.addEventListener("click", () => {
          zoom = !zoom;
          image.setAttribute("data-pz-zoom", zoom ? "1" : "0");
        });
      }
    }

    const meta = el("div", { class: "meta" }, body);
    if (post.author && post.author.username) el("div", { class: "who", text: post.author.username }, meta);
    if (post.caption) el("div", { class: "caption", text: post.caption }, meta);

    if (post.kind === "carousel") {
      el("div", { class: "note", text: "This post has more pictures. Instagram's own arrows step through them." }, meta);
    }
    if (post.kind === "video" && !post.media[0].url) {
      el("div", { class: "note", text: "The video itself is not available without an account. This is its cover frame." }, meta);
      el("button", { "data-pz-show-frame": "", text: "Show Instagram's own view" }, meta)
        .addEventListener("click", () => { clear(); showFrame(el("div", { class: "stage" }, body)); viewBar(body, "embed"); });
    }

    const bar = viewBar(body, useFrame ? "embed" : "ours");
    if (!useFrame && post.media[0].url) {
      el("button", { "data-pz-save": "", text: "Save" }, bar)
        .addEventListener("click", () => call(onSave, post.media[0]));
    }
  }

  function showMessage(reason) {
    if (!host) open();
    clear();
    el("div", { class: "msg", text: reason }, body);
    const bar = el("div", { class: "bar" }, body);
    el("button", { "data-pz-show-frame": "", text: "Show Instagram's own view" }, bar)
      .addEventListener("click", () => { clear(); showFrame(el("div", { class: "stage" }, body)); viewBar(body, "embed"); });
    el("a", {
      class: "btn",
      href: `https://www.instagram.com/p/${shortcode}/`,
      target: "_blank",
      rel: "noopener",
      text: "Open on Instagram",
    }, bar);
  }

  const api = {
    open,
    close,
    showPost,
    showMessage,
    isOpen: () => !!host,
    get el() { return host; },
  };
  return api;
}

function call(fn, arg) {
  if (typeof fn === "function") fn(arg);
}
