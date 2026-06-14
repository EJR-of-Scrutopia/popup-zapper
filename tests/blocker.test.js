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
});