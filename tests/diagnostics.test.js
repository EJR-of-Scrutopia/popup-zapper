import { describe, it, expect, beforeEach } from "vitest";
import { collectDiagnostics } from "../src/lib/diagnostics.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("collectDiagnostics", () => {
  it("reports iframes, top candidates, and blurred elements", () => {
    document.body.innerHTML =
      `<iframe src="https://buy-eu.piano.io/gate"></iframe>` +
      `<div id="gate" style="position:fixed;z-index:9999">Create your free account</div>` +
      `<div id="img" style="filter:blur(8px)"></div>`;
    const report = collectDiagnostics(document);
    expect(report).toContain("iframes: 1");
    expect(report).toContain("buy-eu.piano.io");
    expect(report).toContain("#gate");
    expect(report).toContain("Blurred elements: 1");
    expect(report).toContain("#img");
  });

  it("ignores the zapper's own UI", () => {
    document.body.innerHTML = `<div data-pz="log" style="position:fixed;z-index:9999">Sign in</div>`;
    const report = collectDiagnostics(document);
    expect(report).toContain("Top popup candidates (score > 0): 0");
  });
});