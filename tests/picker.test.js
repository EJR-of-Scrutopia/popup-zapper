import { describe, it, expect, beforeEach } from "vitest";
import { createPicker } from "../src/lib/picker.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createPicker", () => {
  it("ranks fixed high-z overlays first and cycles them", () => {
    document.body.innerHTML =
      `<div id="lo" style="position:relative">login please</div>` +
      `<div id="hi" style="position:fixed;z-index:99999">subscribe to continue</div>`;
    const p = createPicker(document);
    expect(p.candidateCount()).toBeGreaterThan(0);
    expect(p.current().id).toBe("hi");        // highest score first
    const first = p.current();
    p.nextCandidate();
    expect(p.current()).not.toBe(first);      // moved to another candidate
  });

  it("grows to parent and shrinks to child", () => {
    document.body.innerHTML =
      `<section id="outer"><div id="mid" style="position:fixed;z-index:99999">register now<span id="inner">x</span></div></section>`;
    const p = createPicker(document);
    expect(p.current().id).toBe("mid");
    expect(p.grow().id).toBe("outer");
    expect(p.shrink().id).toBe("mid");
    expect(p.shrink().id).toBe("inner");
  });
});