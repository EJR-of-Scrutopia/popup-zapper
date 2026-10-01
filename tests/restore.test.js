import { describe, it, expect, beforeEach } from "vitest";
import { detectDegradation, restoreElement, restorePage, restoreBlur } from "../src/lib/restore.js";

beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("detectDegradation", () => {
  it("detects inline blur", () => {
    const d = document.createElement("div");
    d.style.filter = "blur(8px)";
    expect(detectDegradation(d).blur).toBe(true);
  });
  it("detects near-zero opacity", () => {
    const d = document.createElement("div");
    d.style.opacity = "0.02";
    expect(detectDegradation(d).opacity).toBe(true);
  });
  it("reports nothing for a clean element", () => {
    const d = document.createElement("div");
    expect(detectDegradation(d)).toEqual({
      blur: false, opacity: false, pointerEvents: false,
      userSelect: false, maxHeight: false,
    });
  });
});

describe("restoreElement", () => {
  it("strips blur and resets opacity/pointer-events", () => {
    const d = document.createElement("div");
    d.style.filter = "blur(8px)";
    d.style.opacity = "0.02";
    d.style.pointerEvents = "none";
    restoreElement(d);
    expect(d.style.filter).toBe("none");
    expect(d.style.opacity).toBe("1");
    expect(d.style.pointerEvents).toBe("auto");
  });
});

describe("restoreBlur", () => {
  it("strips blur and returns the count, respecting the whitelist", () => {
    document.body.innerHTML =
      `<div id="a" style="filter:blur(5px)"></div>` +
      `<div id="b" style="filter:blur(5px)"></div>` +
      `<div id="c"></div>`;
    const n = restoreBlur(document, (el) => el.id === "b");
    expect(document.getElementById("a").style.filter).toBe("none");
    expect(document.getElementById("b").style.filter).toBe("blur(5px)"); // whitelisted
    expect(n).toBe(1);
  });
});

describe("restorePage", () => {
  // Unlocked to `visible`, not `auto`: with html and body both non-visible,
  // body's overflow no longer passes to the viewport, body becomes a scroll
  // container that never scrolls, and every position:sticky element on the
  // page sticks to it instead of the viewport (ananke-eidos.com's pinned
  // drawing scrolled away, 2026-10-01).
  it("unfreezes html/body scroll", () => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    restorePage(document);
    expect(document.documentElement.style.overflow).toBe("visible");
    expect(document.body.style.overflow).toBe("visible");
    expect(document.body.style.position).toBe("static");
  });

  it("leaves a page that is not locked alone", () => {
    restorePage(document);
    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(document.body.getAttribute("style")).toBeNull();
  });

  it("keeps the site's own body position and height when the page is not locked", () => {
    document.body.style.position = "relative";
    document.body.style.height = "100%";
    restorePage(document);
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.height).toBe("100%");
  });

  it("unlocks only the element that is locked", () => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflowX = "hidden";
    restorePage(document);
    expect(document.documentElement.style.overflow).toBe("visible");
    expect(document.body.style.overflowX).toBe("hidden");
  });

  it("reads overflow-y alone, so a page hiding only sideways scroll is not locked", () => {
    document.documentElement.style.overflowX = "hidden";
    document.documentElement.style.overflowY = "auto";
    restorePage(document);
    expect(document.documentElement.style.overflowY).toBe("auto");
  });
});