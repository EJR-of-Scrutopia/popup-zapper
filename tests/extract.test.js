import { describe, it, expect } from "vitest";
import { isHashedToken, extractKeywords } from "../src/lib/extract.js";

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

describe("isHashedToken", () => {
  it("flags css-module / hashed tokens", () => {
    expect(isHashedToken("css-1a2b3c")).toBe(true);
    expect(isHashedToken("_3xYz9k")).toBe(true);
  });
  it("keeps human class names", () => {
    expect(isHashedToken("newsletter-modal")).toBe(false);
    expect(isHashedToken("signup")).toBe(false);
    expect(isHashedToken("btn")).toBe(false);
  });
});

describe("extractKeywords", () => {
  it("prefers id, then human classes, skipping hashed", () => {
    const node = el(`<div id="paywall" class="modal css-1a2b3c" data-testid="gate">Sign in</div>`);
    const kws = extractKeywords(node);
    const values = kws.map((k) => k.value);
    expect(values).toContain("paywall");
    expect(values).toContain("modal");
    expect(values).not.toContain("css-1a2b3c");
    expect(kws[0]).toEqual({ type: "id", value: "paywall", action: "remove" });
  });

  it("falls back to a data-attr when no id/usable class", () => {
    const node = el(`<div class="css-1a2b3c" data-modal="login"></div>`);
    const kws = extractKeywords(node);
    expect(kws.some((k) => k.type === "attr" && k.value === "data-modal")).toBe(true);
  });

  it("uses a short text snippet only as a last resort", () => {
    const node = el(`<div>Subscribe now</div>`);
    const kws = extractKeywords(node);
    expect(kws).toEqual([{ type: "text", value: "Subscribe now", action: "remove" }]);
  });

  it("returns empty for an element with no usable signal", () => {
    const node = el(`<div></div>`);
    expect(extractKeywords(node)).toEqual([]);
  });
});