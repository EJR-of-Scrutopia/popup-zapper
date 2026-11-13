// Read against real rendered embeds captured by tools/capture-ig-fixtures.cjs
// from instagram.com/nasa on 2026-11-13.
//
// Where each field comes from, discovered from those fixtures:
//   media image  img.EmbeddedMediaImage  (the 1440-wide feed version)
//   video        video[src], with poster= as the fallback still
//   caption      .Caption, minus the .CaptionUsername prefix Instagram puts in it
//   username     .UsernameText, else .Username
//   avatar       .Avatar img / .AvatarContainer img
//   carousel     an element with aria-label="Next"; the embed paints only the
//                first child, so media holds one item and hasMore is true

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readEmbedDoc } from "../src/lib/instagram/embed.js";

const DIR = join(__dirname, "fixtures", "instagram");

function docOf(name) {
  const html = readFileSync(join(DIR, `${name}.html`), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

function docFrom(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

let photo, carousel, reel;
beforeAll(() => {
  photo = readEmbedDoc(docOf("photo"));
  carousel = readEmbedDoc(docOf("carousel"));
  reel = readEmbedDoc(docOf("reel"));
});

describe("a single photo", () => {
  it("is a photo", () => expect(photo.kind).toBe("photo"));
  it("has exactly one media item", () => expect(photo.media).toHaveLength(1));
  it("is an image", () => expect(photo.media[0].type).toBe("image"));
  it("points at the CDN", () => expect(photo.media[0].url).toMatch(/^https:\/\/[^/]*cdninstagram\.com\//));
  it("is not a thumbnail", () => expect(photo.media[0].url).not.toMatch(/\/s\d{2,3}x\d{2,3}\//));
  it("is not the author's avatar", () => expect(photo.media[0].url).not.toMatch(/t51\.2885-19/));
  it("has a caption", () => expect(photo.caption.length).toBeGreaterThan(0));
  it("does not repeat the username inside the caption", () => expect(photo.caption.startsWith("nasa")).toBe(false));
  it("names the author", () => expect(photo.author.username).toBe("nasa"));
  it("has no more to show", () => expect(photo.hasMore).toBe(false));
});

describe("a carousel", () => {
  it("is a carousel", () => expect(carousel.kind).toBe("carousel"));
  it("still yields its first picture", () => {
    expect(carousel.media).toHaveLength(1);
    expect(carousel.media[0].url).toMatch(/cdninstagram\.com\//);
  });
  it("says there is more behind it", () => expect(carousel.hasMore).toBe(true));
});

describe("a reel", () => {
  it("is a video", () => expect(reel.kind).toBe("video"));
  it("yields a playable source", () => {
    expect(reel.media[0].type).toBe("video");
    expect(reel.media[0].url).toMatch(/^https:\/\/[^/]*cdninstagram\.com\//);
  });
  it("yields a poster frame too", () => expect(reel.media[0].poster).toMatch(/cdninstagram\.com\//));
  it("names the author", () => expect(reel.author.username).toBe("nasa"));
});

describe("what it does with nothing", () => {
  it("returns null for a page with no media", () => {
    expect(readEmbedDoc(docFrom("<html><body><p>Sorry, this page isn't available.</p></body></html>"))).toBe(null);
  });
  it("returns null for an empty document", () => {
    expect(readEmbedDoc(docFrom(""))).toBe(null);
  });
  it("returns null for no document at all", () => {
    expect(readEmbedDoc(null)).toBe(null);
  });
  it("ignores an avatar-only page, which is the unpainted shell", () => {
    const shell = `<html><body><div class="Avatar"><img src="https://x.cdninstagram.com/v/t51.2885-19/a.jpg"></div></body></html>`;
    expect(readEmbedDoc(docFrom(shell))).toBe(null);
  });
});

describe("falling back", () => {
  it("takes a video poster when the source is missing", () => {
    const html = `<html><body><video poster="https://x.cdninstagram.com/v/t51.82787-15/p.jpg"></video></body></html>`;
    const post = readEmbedDoc(docFrom(html));
    expect(post.kind).toBe("video");
    expect(post.media[0].url).toBe(null);
    expect(post.media[0].poster).toBe("https://x.cdninstagram.com/v/t51.82787-15/p.jpg");
  });
  it("takes the largest srcset candidate when there is no plain src", () => {
    const html = `<html><body><img class="EmbeddedMediaImage"
      srcset="https://x.cdninstagram.com/v/t51.82787-15/small.jpg 640w, https://x.cdninstagram.com/v/t51.82787-15/big.jpg 1440w"></body></html>`;
    expect(readEmbedDoc(docFrom(html)).media[0].url).toBe("https://x.cdninstagram.com/v/t51.82787-15/big.jpg");
  });
  it("survives a caption with no username span", () => {
    const html = `<html><body><img class="EmbeddedMediaImage" src="https://x.cdninstagram.com/v/t51.82787-15/a.jpg">
      <div class="Caption">just words</div></body></html>`;
    expect(readEmbedDoc(docFrom(html)).caption).toBe("just words");
  });
  it("gives an empty caption and username rather than throwing when both are absent", () => {
    const html = `<html><body><img class="EmbeddedMediaImage" src="https://x.cdninstagram.com/v/t51.82787-15/a.jpg"></body></html>`;
    const post = readEmbedDoc(docFrom(html));
    expect(post.caption).toBe("");
    expect(post.author.username).toBe("");
  });
});
