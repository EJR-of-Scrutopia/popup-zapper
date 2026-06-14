import { describe, it, expect } from "vitest";
import { matchesRule, getActiveRules, findMatches } from "../src/lib/rules.js";

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

describe("matchesRule", () => {
  it("matches by id", () => {
    expect(matchesRule(el(`<div id="signup-wall"></div>`),
      { type: "id", value: "signup-wall" })).toBe(true);
  });
  it("matches by class token", () => {
    expect(matchesRule(el(`<div class="a newsletter-modal b"></div>`),
      { type: "class", value: "newsletter-modal" })).toBe(true);
  });
  it("matches by attribute presence", () => {
    expect(matchesRule(el(`<div data-paywall="1"></div>`),
      { type: "attr", value: "data-paywall" })).toBe(true);
  });
  it("matches by text substring (case-insensitive)", () => {
    expect(matchesRule(el(`<div>Please Sign In to continue</div>`),
      { type: "text", value: "sign in" })).toBe(true);
  });
  it("matches by cmp selector", () => {
    expect(matchesRule(el(`<div id="onetrust-banner-sdk"></div>`),
      { type: "cmp", value: "#onetrust-banner-sdk" })).toBe(true);
  });
  it("does not match unrelated element", () => {
    expect(matchesRule(el(`<div class="article"></div>`),
      { type: "class", value: "newsletter-modal" })).toBe(false);
  });
});

describe("getActiveRules", () => {
  const lib = {
    version: 1, enabled: true, disabledDomains: ["off.com"],
    global: [
      { type: "class", value: "g1", action: "remove" },
      { type: "class", value: "g2", action: "remove", enabled: false },
    ],
    domains: { "site.com": { rules: [{ type: "id", value: "d1", action: "hide" }] } },
    whitelist: [],
  };
  it("returns enabled global + domain rules", () => {
    const rules = getActiveRules(lib, "site.com");
    expect(rules.map((r) => r.value)).toEqual(["g1", "d1"]);
  });
  it("returns nothing for a disabled domain", () => {
    expect(getActiveRules(lib, "off.com")).toEqual([]);
  });
  it("returns nothing when globally disabled", () => {
    expect(getActiveRules({ ...lib, enabled: false }, "site.com")).toEqual([]);
  });
});

describe("findMatches", () => {
  it("finds all matching elements under a root", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div class="promo"></div><p>x</p><div class="promo"></div>`;
    const matches = findMatches(root, [{ type: "class", value: "promo" }]);
    expect(matches).toHaveLength(2);
  });
});