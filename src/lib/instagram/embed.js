// Reading a post out of Instagram's rendered embed page.
//
// The embed is NOT server-rendered: fetching its HTML gives a 500 KB boot script
// and no media whatsoever. It has to be painted by a browser first, which is why
// the viewer loads it in an offscreen frame and hands the live Document here.
//
// Classes used below are the embed's own semantic ones (EmbeddedMediaImage,
// Caption, Username), not the obfuscated utility classes around them, so they
// are the most durable hooks the page offers. Every one is optional: a missing
// piece yields an empty string, and only a missing MEDIA yields null.

const MEDIA_IMG = "img.EmbeddedMediaImage";
const AVATAR = /t51\.2885-19/; // the author's profile picture, never the post

export function readEmbedDoc(doc) {
  if (!doc || !doc.querySelector) return null;

  const media = readMedia(doc);
  if (!media) return null;

  const hasMore = !!doc.querySelector('[aria-label="Next"], [aria-label="Next slide"]');
  // hasMore wins over the media type: a carousel whose first child is a clip is
  // still a carousel, and must be routed like one rather than played as a lone
  // video with no hint that there is anything behind it.
  const kind = hasMore ? "carousel" : media.type === "video" ? "video" : "photo";

  return {
    kind,
    media: [media],
    hasMore,
    caption: readCaption(doc),
    author: readAuthor(doc),
    source: "dom",
  };
}

function readMedia(doc) {
  const video = doc.querySelector("video");
  if (video) {
    const url = video.getAttribute("src") || srcOf(video.querySelector("source")) || null;
    const poster = video.getAttribute("poster") || null;
    if (url || poster) return { type: "video", url, poster, index: 0 };
  }

  const img = doc.querySelector(MEDIA_IMG) || largestOtherImage(doc);
  if (!img) return null;

  const url = srcOf(img);
  if (!url || AVATAR.test(url)) return null;
  return { type: "image", url, poster: null, index: 0 };
}

// Only reached when the embed drops its EmbeddedMediaImage class. Takes the
// biggest image that is not the author's avatar, and takes nothing at all
// unless it is big enough to be a post: this path also runs on wall and error
// pages, where returning a logo or a spacer would dress a failure up as a
// success and hand the user a Save button for a sprite.
const MIN_POST_PX = 240;

function largestOtherImage(doc) {
  let best = null;
  let bestArea = 0;
  for (const img of doc.querySelectorAll("img")) {
    const src = srcOf(img);
    if (!src || AVATAR.test(src)) continue;
    const w = sizeOf(img, "width");
    const h = sizeOf(img, "height");
    if (w < MIN_POST_PX || h < MIN_POST_PX) continue;
    const area = w * h;
    if (area > bestArea) { best = img; bestArea = area; }
  }
  return best;
}

function sizeOf(img, attr) {
  const stated = parseInt(img.getAttribute(attr), 10);
  if (stated > 0) return stated;
  const natural = attr === "width" ? img.naturalWidth : img.naturalHeight;
  // An unsized image in a parsed document has no natural size to go on, so it
  // cannot clear the bar. Better to say "not available" than to show a logo.
  return natural > 0 ? natural : 0;
}

function srcOf(el) {
  if (!el) return null;
  const set = el.getAttribute && el.getAttribute("srcset");
  if (set) {
    const best = set
      .split(",")
      .map((part) => part.trim().split(/\s+/))
      .map(([url, size]) => ({ url, w: parseInt(size, 10) || 0 }))
      .sort((a, b) => b.w - a.w)[0];
    if (best && best.url) return best.url;
  }
  return (el.getAttribute && el.getAttribute("src")) || null;
}

// Instagram puts the author's name inside the caption node as .CaptionUsername,
// so the raw text reads "nasa Some caption". Take the span out first.
function readCaption(doc) {
  const node = doc.querySelector(".Caption");
  if (!node) return "";
  const copy = node.cloneNode(true);
  for (const drop of copy.querySelectorAll(".CaptionUsername, .CaptionComments, .CaptionCommentsExpand")) {
    drop.remove();
  }
  return (copy.textContent || "").replace(/\s+/g, " ").trim();
}

function readAuthor(doc) {
  const name = doc.querySelector(".UsernameText") || doc.querySelector(".Username");
  const avatarImg = doc.querySelector(".Avatar img, .AvatarContainer img");
  return {
    username: ((name && name.textContent) || "").trim(),
    avatar: srcOf(avatarImg),
  };
}
