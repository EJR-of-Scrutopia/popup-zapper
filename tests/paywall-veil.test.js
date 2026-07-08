import { describe, it, expect, beforeEach } from "vitest";
import { isVeilOverlay, removeVeils } from "../src/lib/paywall-veil.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("isVeilOverlay", () => {
  it("flags a fixed high-z blur overlay", () => {
    const d = document.createElement("div");
    // jsdom's CSSOM does not support backdrop-filter; filter blur exercises the
    // same generic-veil path (real browsers also match cs.backdropFilter).
    d.style.cssText = "position:fixed;z-index:99999;filter:blur(8px);";
    document.body.appendChild(d);
    expect(isVeilOverlay(d, window)).toBe(true);
  });
  it("flags a known vendor overlay by class even without blur", () => {
    const d = document.createElement("div");
    d.className = "piano-meter-overlay";
    d.style.cssText = "position:fixed;z-index:99999;";
    document.body.appendChild(d);
    expect(isVeilOverlay(d, window)).toBe(true);
  });
  it("ignores a small decorative blurred element (not fixed)", () => {
    const d = document.createElement("div");
    d.style.cssText = "position:relative;filter:blur(4px);";
    document.body.appendChild(d);
    expect(isVeilOverlay(d, window)).toBe(false);
  });
});

describe("removeVeils", () => {
  it("removes veils and respects skip()", () => {
    document.body.innerHTML =
      `<div id="v" class="piano-meter-overlay" style="position:fixed;z-index:99999"></div>` +
      `<div id="keep" style="position:fixed;z-index:99999;backdrop-filter:blur(8px)"></div>`;
    const removed = removeVeils(document, (el) => el.id === "keep");
    expect(document.getElementById("v")).toBeNull();
    expect(document.getElementById("keep")).not.toBeNull();
    expect(removed.length).toBe(1);
  });
});