import { describe, it, expect } from "vitest";
import { ANALYTICS_KEYS, clearTrackingStorage, neutralizeBeacon } from "../src/lib/cleanup.js";

describe("clearTrackingStorage", () => {
  it("removes known analytics keys from a storage-like object", () => {
    const store = { _ga: "1", keepme: "2", _gid: "3" };
    const storage = {
      key: (i) => Object.keys(store)[i],
      get length() { return Object.keys(store).length; },
      removeItem: (k) => { delete store[k]; },
    };
    clearTrackingStorage(storage);
    expect(store).toEqual({ keepme: "2" });
  });

  it("exposes a default analytics key list", () => {
    expect(ANALYTICS_KEYS.some((re) => re.test("_ga"))).toBe(true);
  });
});

describe("neutralizeBeacon", () => {
  it("replaces sendBeacon with a no-op returning true", () => {
    const nav = { sendBeacon: () => { throw new Error("should not run"); } };
    neutralizeBeacon(nav);
    expect(nav.sendBeacon("url", "data")).toBe(true);
  });
});