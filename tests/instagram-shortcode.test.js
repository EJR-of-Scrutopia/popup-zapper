import { describe, it, expect } from "vitest";
import { shortcodeFromPath, shortcodeFromAnchor, embedUrl } from "../src/lib/instagram/shortcode.js";

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

describe("shortcodeFromPath", () => {
  it("takes a bare post path", () => {
    expect(shortcodeFromPath("/p/BsOGulcndj-/")).toBe("BsOGulcndj-");
  });
  it("takes a username-prefixed post path", () => {
    expect(shortcodeFromPath("/lucyhcraig/p/C1x_yZ2a/")).toBe("C1x_yZ2a");
  });
  it("takes a reel path", () => {
    expect(shortcodeFromPath("/reel/C9aB-cD_e/")).toBe("C9aB-cD_e");
  });
  it("takes a username-prefixed reel path", () => {
    expect(shortcodeFromPath("/lucyhcraig/reel/C9aB-cD_e/")).toBe("C9aB-cD_e");
  });
  it("takes a tv path", () => {
    expect(shortcodeFromPath("/tv/Abc123/")).toBe("Abc123");
  });
  it("takes a path with no trailing slash", () => {
    expect(shortcodeFromPath("/p/Abc123")).toBe("Abc123");
  });
  it("takes a full URL, not only a path", () => {
    expect(shortcodeFromPath("https://www.instagram.com/p/Abc123/?img_index=2")).toBe("Abc123");
  });
  it("ignores a profile path", () => {
    expect(shortcodeFromPath("/lucyhcraig/")).toBe(null);
  });
  it("ignores an explore path with no shortcode", () => {
    expect(shortcodeFromPath("/explore/tags/cats/")).toBe(null);
  });
  it("ignores an empty shortcode", () => {
    expect(shortcodeFromPath("/p//")).toBe(null);
  });
  it("ignores a bare slash", () => {
    expect(shortcodeFromPath("/")).toBe(null);
  });
  it("ignores null and undefined", () => {
    expect(shortcodeFromPath(null)).toBe(null);
    expect(shortcodeFromPath(undefined)).toBe(null);
  });
});

describe("shortcodeFromAnchor", () => {
  it("takes the shortcode from the nearest enclosing anchor", () => {
    const tile = el(`<a href="/lucyhcraig/p/C1x_yZ2a/"><div><img alt="a post"></div></a>`);
    expect(shortcodeFromAnchor(tile.querySelector("img"))).toBe("C1x_yZ2a");
  });
  it("takes the shortcode from the anchor itself", () => {
    expect(shortcodeFromAnchor(el(`<a href="/p/Abc123/"></a>`))).toBe("Abc123");
  });
  it("ignores an anchor to the login page", () => {
    const a = el(`<a href="/accounts/login/"><span>Log in</span></a>`);
    expect(shortcodeFromAnchor(a.querySelector("span"))).toBe(null);
  });
  it("ignores an element under no anchor", () => {
    expect(shortcodeFromAnchor(el(`<div><span>plain</span></div>`).querySelector("span"))).toBe(null);
  });
  it("ignores null", () => {
    expect(shortcodeFromAnchor(null)).toBe(null);
  });
});

describe("embedUrl", () => {
  it("builds the captioned embed URL", () => {
    expect(embedUrl("Abc123")).toBe("https://www.instagram.com/p/Abc123/embed/captioned/");
  });
});

describe("the query string is not part of the path", () => {
  it("ignores a post code carried in a login link's next parameter", () => {
    expect(shortcodeFromPath("/accounts/login/?next=/p/ABC123/")).toBe(null);
  });
  it("ignores a post code in a fragment", () => {
    expect(shortcodeFromPath("/explore/#/p/ABC123/")).toBe(null);
  });
  it("still reads a real post URL carrying a query", () => {
    expect(shortcodeFromPath("https://www.instagram.com/p/Abc123/?img_index=2")).toBe("Abc123");
  });
  it("ignores a login anchor whose next points at a post", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "/accounts/login/?next=%2Fp%2FABC123%2F");
    expect(shortcodeFromAnchor(a)).toBe(null);
  });
});
