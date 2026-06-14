import { describe, it, expect, beforeEach } from "vitest";
import { runBlocker } from "../src/lib/blocker.js";

const lib = {
  version: 1, enabled: true, disabledDomains: [],
  global: [{ type: "class", value: "promo-modal", action: "remove" }],
  domains: {}, whitelist: [],
};

beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("runBlocker", () => {
  it("removes a popup that matches a rule", () => {
    document.body.innerHTML = `<div class="promo-modal">x</div><p id="keep">y</p>`;
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.querySelector(".promo-modal")).toBeNull();
    expect(document.querySelector("#keep")).not.toBeNull();
  });

  it("clicks a reject button when a banner is present", () => {
    let clicked = false;
    document.body.innerHTML = `<div id="onetrust-banner-sdk"><button>Reject all</button></div>`;
    document.querySelector("button").addEventListener("click", () => { clicked = true; });
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(clicked).toBe(true);
  });

  it("restores page scroll lock", () => {
    document.body.style.overflow = "hidden";
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.body.style.overflow).toBe("auto");
  });

  it("does nothing on a disabled domain", () => {
    document.body.innerHTML = `<div class="promo-modal">x</div>`;
    runBlocker({
      doc: document,
      library: { ...lib, disabledDomains: ["site.com"] },
      hostname: "site.com",
    });
    expect(document.querySelector(".promo-modal")).not.toBeNull();
  });

  it("clears tracking cookies only when cleanup is enabled for the domain", () => {
    document.cookie = "_ga=abc;path=/";
    const cleanupLib = {
      ...lib,
      domains: { "site.com": { rules: [], cleanup: true } },
    };
    runBlocker({ doc: document, library: cleanupLib, hostname: "site.com" });
    expect(document.cookie).not.toMatch(/_ga=/);
  });

  it("removes a known paywall-vendor iframe overlay (always on)", () => {
    document.body.innerHTML =
      `<div class="gallery-piano-container"><iframe src="https://buy-eu.piano.io/checkout/x"></iframe></div>` +
      `<div id="real-image">image</div>`;
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.querySelector(".gallery-piano-container")).toBeNull();
    expect(document.querySelector("#real-image")).not.toBeNull();
  });

  it("auto-zap unlocks gated content: removes register gate and clears truncation", () => {
    document.body.innerHTML =
      `<div id="gate" style="position:fixed">Register to continue reading this article</div>` +
      `<article id="body" style="max-height:200px;overflow:hidden">${"word ".repeat(200)}</article>`;
    const azLib = { ...lib, domains: { "site.com": { rules: [], autozap: true } } };
    runBlocker({ doc: document, library: azLib, hostname: "site.com" });
    expect(document.querySelector("#gate")).toBeNull();
    expect(document.querySelector("#body").style.maxHeight).toBe("none");
  });

  it("does not unlock content when autozap is off", () => {
    document.body.innerHTML =
      `<article id="body" style="max-height:200px;overflow:hidden">${"word ".repeat(200)}</article>`;
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.querySelector("#body").style.maxHeight).not.toBe("none");
  });

  it("logs each action it takes", () => {
    document.body.innerHTML = `<div class="promo-modal">x</div>`;
    const events = [];
    runBlocker({
      doc: document, library: lib, hostname: "site.com",
      log: (action, detail) => events.push({ action, detail }),
    });
    expect(events.some((e) => e.action === "popup")).toBe(true);
  });

  it("auto-zaps the top popup only when autozap is enabled for the domain", () => {
    const html = `<div id="gate" style="position:fixed;z-index:9999">Please sign in to continue</div>`;
    // disabled: gate stays
    document.body.innerHTML = html;
    runBlocker({ doc: document, library: lib, hostname: "site.com" });
    expect(document.querySelector("#gate")).not.toBeNull();
    // enabled: gate removed
    document.body.innerHTML = html;
    const azLib = { ...lib, domains: { "site.com": { rules: [], autozap: true } } };
    runBlocker({ doc: document, library: azLib, hostname: "site.com" });
    expect(document.querySelector("#gate")).toBeNull();
  });
});