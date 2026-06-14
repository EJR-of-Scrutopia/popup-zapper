import { describe, it, expect, beforeEach } from "vitest";
import { extractCleanContent, applyCleanContent, buildCleanDocument } from "../src/lib/cleanfetch.js";

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

describe("buildCleanDocument", () => {
  it("strips scripts, removes paywall elements, and adds a base href", () => {
    const html = `<html><head><title>T</title><script>gate()</script></head>` +
      `<body><div class="paywall-modal">PAY</div><article>${"word ".repeat(200)}</article></body></html>`;
    const out = buildCleanDocument(html, "https://site.com/a");
    expect(out).not.toContain("gate()");
    expect(out).not.toContain("PAY");
    expect(out).toContain('href="https://site.com/a"');
    expect(out).toContain("article");
  });

  it("returns null for empty input", () => {
    expect(buildCleanDocument("", "https://x")).toBeNull();
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