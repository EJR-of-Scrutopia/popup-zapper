import { describe, it, expect } from "vitest";
import { resetMeter, shouldClear, METER_KEYS, AUTH_KEYS } from "../src/lib/meter.js";

describe("shouldClear", () => {
  it("clears metering keys", () => {
    expect(shouldClear("article_count")).toBe(true);
    expect(shouldClear("paywall_views")).toBe(true);
    expect(shouldClear("nyt-meter")).toBe(true);
    expect(shouldClear("freeArticlesRead")).toBe(true);
  });

  it("never clears auth/session keys, even if they look meter-ish", () => {
    expect(shouldClear("auth_token")).toBe(false);
    expect(shouldClear("sessionId")).toBe(false);
    expect(shouldClear("user_account")).toBe(false);
    expect(shouldClear("meter_session_token")).toBe(false); // auth wins
  });

  it("ignores unrelated keys", () => {
    expect(shouldClear("_ga")).toBe(false);
    expect(shouldClear("theme")).toBe(false);
  });
});

describe("resetMeter", () => {
  it("clears matching localStorage keys, returns names", () => {
    const store = { article_count: "3", theme: "dark", auth_token: "x" };
    const storage = {
      key: (i) => Object.keys(store)[i],
      get length() { return Object.keys(store).length; },
      removeItem: (k) => { delete store[k]; },
    };
    const cleared = resetMeter(null, { localStorage: storage, sessionStorage: null, navigator: {} });
    expect(cleared).toContain("article_count");
    expect(store).toEqual({ theme: "dark", auth_token: "x" });
  });

  it("clears matching cookies on the document", () => {
    document.cookie = "paywall_count=2;path=/";
    const cleared = resetMeter(document, null);
    expect(cleared).toContain("paywall_count");
    expect(document.cookie).not.toMatch(/paywall_count=/);
  });
});

describe("patterns", () => {
  it("expose meter and auth regexes", () => {
    expect(METER_KEYS.test("paywall")).toBe(true);
    expect(AUTH_KEYS.test("session")).toBe(true);
  });
});