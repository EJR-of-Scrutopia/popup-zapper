import { describe, it, expect } from "vitest";
import { DEFAULT_LIBRARY, loadLibrary, saveLibrary } from "../src/lib/storage.js";

describe("storage", () => {
  it("returns defaults when nothing is stored", () => {
    const lib = loadLibrary(() => undefined);
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });

  it("returns defaults when stored blob is corrupt", () => {
    const lib = loadLibrary(() => "{not valid json");
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });

  it("returns defaults when stored version mismatches", () => {
    const lib = loadLibrary(() => JSON.stringify({ version: 999, global: [{}] }));
    expect(lib).toEqual(DEFAULT_LIBRARY);
  });

  it("merges stored fields over defaults", () => {
    const stored = JSON.stringify({
      version: 1,
      global: [{ type: "class", value: "promo", action: "remove" }],
    });
    const lib = loadLibrary(() => stored);
    expect(lib.global).toHaveLength(1);
    expect(lib.domains).toEqual({});
    expect(lib.enabled).toBe(true);
  });

  it("saveLibrary serializes via the injected setter", () => {
    let saved = null;
    saveLibrary((key, v) => { saved = v; }, DEFAULT_LIBRARY);
    expect(JSON.parse(saved).version).toBe(1);
  });
});