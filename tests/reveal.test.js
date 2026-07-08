import { describe, it, expect, beforeEach } from "vitest";
import { revealDeep, hasResidualGating } from "../src/lib/reveal.js";

beforeEach(() => { document.body.innerHTML = ""; });

const long = "word ".repeat(200); // > 600 chars

describe("hasResidualGating", () => {
  it("detects a clamped long-text container", () => {
    document.body.innerHTML =
      `<div id="c" style="max-height:300px;overflow:hidden">${long}</div>`;
    expect(hasResidualGating(document)).toBe(true);
  });
  it("returns false for a normal page", () => {
    document.body.innerHTML = `<div>${long}</div>`;
    expect(hasResidualGating(document)).toBe(false);
  });
});

describe("revealDeep", () => {
  it("clears max-height truncation on long-text containers", () => {
    document.body.innerHTML =
      `<div id="c" style="max-height:300px;overflow:hidden">${long}</div>`;
    const n = revealDeep(document);
    const el = document.getElementById("c");
    expect(el.style.maxHeight).toBe("none");
    expect(n).toBeGreaterThan(0);
  });
  it("restores an inline pointer-events:none lock", () => {
    document.body.innerHTML = `<div id="l" style="pointer-events:none;opacity:0">${long}</div>`;
    revealDeep(document);
    const el = document.getElementById("l");
    expect(el.style.pointerEvents).toBe("auto");
    expect(el.style.opacity).toBe("1");
  });
  it("respects skip()", () => {
    document.body.innerHTML =
      `<div id="c" style="max-height:300px;overflow:hidden">${long}</div>`;
    revealDeep(document, (el) => el.id === "c");
    expect(document.getElementById("c").style.maxHeight).toBe("300px");
  });
});