import { describe, it, expect, beforeEach } from "vitest";
import { extractCleanContent, applyCleanContent } from "../src/lib/cleanfetch.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("extractCleanContent", () => {
  it("pulls the main article and title from fetched HTML", () => {
    const html = `<html><head><title>Clean Title</title></head>` +
      `<body><article>${"word ".repeat(200)}</article></body></html>`;
    const out = extractCleanContent(html);
    expect(out.title).toBe("Clean Title");
    expect(out.sel).toBe("article");
    expect(out.len).toBeGreaterThan(400);
  });

  it("returns null for empty input", () => {
    expect(extractCleanContent("")).toBeNull();
  });
});

describe("applyCleanContent", () => {
  it("writes the extracted html into the matching element", () => {
    document.body.innerHTML = `<article>blocked teaser</article>`;
    const out = { title: "T", sel: "article", html: "FULL CONTENT HERE", len: 17 };
    expect(applyCleanContent(document, out)).toBe(true);
    expect(document.querySelector("article").textContent).toBe("FULL CONTENT HERE");
  });
});