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
  const kind = media.type === "video" ? "video" : hasMore ? "carousel" : "photo";

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
// biggest image that is not the author's avatar.
function largestOtherImage(doc) {
  const imgs = [...doc.querySelectorAll("img")].filter((i) => {
    const s = srcOf(i);
    return s && !AVATAR.test(s);
  });
  return imgs[0] || null;
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
