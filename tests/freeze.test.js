import { describe, it, expect, beforeEach } from "vitest";
import { pickContent, captureSnapshot, restoreSnapshot } from "../src/lib/freeze.js";

function fakeStore() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, _m: m };
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("pickContent", () => {
  it("picks the article element when it has enough text", () => {
    document.body.innerHTML = `<article>${"word ".repeat(200)}</article>`;
    const picked = pickContent(document);
    expect(picked.sel).toBe("article");
  });
});

describe("capture + restore", () => {
  it("captures full content and restores it after the page is gated", () => {
    document.body.innerHTML = `<article>${"word ".repeat(300)}</article>`;
    const store = fakeStore();
    expect(captureSnapshot(document, store)).toBe(true);

    // Simulate the gating refresh shrinking the article.
    document.querySelector("article").innerHTML = "Subscribe to read the rest";
    expect(restoreSnapshot(document, store)).toBe(true);
    expect(document.querySelector("article").textContent.length).toBeGreaterThan(400);
  });

  it("keeps only the largest snapshot (won't overwrite with a smaller one)", () => {
    const store = fakeStore();
    document.body.innerHTML = `<article>${"word ".repeat(300)}</article>`;
    expect(captureSnapshot(document, store)).toBe(true);
    document.body.innerHTML = `<article>short blocked text here ${"x ".repeat(60)}</article>`;
    expect(captureSnapshot(document, store)).toBe(false);
  });

  it("does not restore when current content is already complete", () => {
    document.body.innerHTML = `<article>${"word ".repeat(300)}</article>`;
    const store = fakeStore();
    captureSnapshot(document, store);
    expect(restoreSnapshot(document, store)).toBe(false);
  });
});