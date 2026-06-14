import { describe, it, expect, beforeEach } from "vitest";
import { removePaywallFrames, PAYWALL_FRAME_HOSTS } from "../src/lib/frames.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("removePaywallFrames", () => {
  it("removes a Piano iframe and its overlay container, keeping real content", () => {
    document.body.innerHTML =
      `<div class="gallery-piano-container"><iframe src="https://buy-eu.piano.io/checkout/x"></iframe></div>` +
      `<div id="real-image">the article image</div>`;
    const removed = removePaywallFrames(document);
    expect(document.querySelector(".gallery-piano-container")).toBeNull();
    expect(document.querySelector("#real-image")).not.toBeNull();
    expect(removed).toHaveLength(1);
  });

  it("ignores non-paywall iframes", () => {
    document.body.innerHTML = `<iframe src="https://www.youtube.com/embed/abc"></iframe>`;
    expect(removePaywallFrames(document)).toEqual([]);
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  it("exposes the vendor host list", () => {
    expect(PAYWALL_FRAME_HOSTS.some((re) => re.test("https://buy-eu.piano.io/x"))).toBe(true);
  });
});