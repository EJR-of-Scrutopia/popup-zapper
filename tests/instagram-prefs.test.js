import { describe, it, expect } from "vitest";
import {
  DEFAULT_INSTAGRAM,
  readPrefs,
  writePrefs,
  isSignedIn,
  isActive,
} from "../src/lib/instagram/prefs.js";

function lib(instagram, extra = {}) {
  return {
    enabled: true,
    disabledDomains: [],
    ...(instagram ? { instagram: { ...DEFAULT_INSTAGRAM, ...instagram } } : {}),
    ...extra,
  };
}

describe("readPrefs", () => {
  it("defaults a library with no instagram key", () => {
    expect(readPrefs({})).toEqual({ mode: "auto", view: "ours" });
  });
  it("fills a missing key from the default", () => {
    expect(readPrefs({ instagram: { view: "embed" } })).toEqual({ mode: "auto", view: "embed" });
  });
  it("survives a junk value", () => {
    expect(readPrefs({ instagram: "nonsense" })).toEqual({ mode: "auto", view: "ours" });
  });
  it("survives a null library", () => {
    expect(readPrefs(null)).toEqual({ mode: "auto", view: "ours" });
  });
});

describe("writePrefs", () => {
  it("merges into the same library object", () => {
    const l = lib();
    expect(writePrefs(l, { view: "embed" })).toBe(l);
    expect(l.instagram).toEqual({ mode: "auto", view: "embed" });
  });
  it("creates the key when absent", () => {
    const l = { enabled: true };
    writePrefs(l, { mode: "off" });
    expect(l.instagram).toEqual({ mode: "off", view: "ours" });
  });
});

describe("isSignedIn", () => {
  it("sees a ds_user_id cookie", () => {
    expect(isSignedIn("ds_user_id=123; csrftoken=x")).toBe(true);
  });
  it("sees it first in the string", () => {
    expect(isSignedIn("ds_user_id=123")).toBe(true);
  });
  it("ignores an empty ds_user_id", () => {
    expect(isSignedIn("ds_user_id=; a=b")).toBe(false);
  });
  it("does not match a lookalike cookie name", () => {
    expect(isSignedIn("not_ds_user_id=123")).toBe(false);
  });
  it("does not match the name inside another value", () => {
    expect(isSignedIn("other=ds_user_id=123")).toBe(false);
  });
  it("is false for an empty or missing cookie string", () => {
    expect(isSignedIn("")).toBe(false);
    expect(isSignedIn(null)).toBe(false);
  });
});

describe("isActive", () => {
  const on = { hostname: "instagram.com", cookie: "csrftoken=x" };

  it("is off away from instagram", () => {
    expect(isActive({ library: lib(), hostname: "example.com", cookie: "" })).toBe(false);
  });
  it("is on when signed out under auto", () => {
    expect(isActive({ library: lib(), ...on })).toBe(true);
  });
  it("is off when signed in under auto", () => {
    expect(isActive({ library: lib(), hostname: "instagram.com", cookie: "ds_user_id=123" })).toBe(false);
  });
  it("is on when signed in under mode on", () => {
    expect(isActive({ library: lib({ mode: "on" }), hostname: "instagram.com", cookie: "ds_user_id=123" })).toBe(true);
  });
  it("is off under mode off even when signed out", () => {
    expect(isActive({ library: lib({ mode: "off" }), ...on })).toBe(false);
  });
  it("is off when the library is disabled", () => {
    expect(isActive({ library: lib(null, { enabled: false }), ...on })).toBe(false);
  });
  it("is off when instagram is in disabledDomains", () => {
    expect(isActive({ library: lib(null, { disabledDomains: ["instagram.com"] }), ...on })).toBe(false);
  });
  it("is unaffected by another domain being disabled", () => {
    expect(isActive({ library: lib(null, { disabledDomains: ["example.com"] }), ...on })).toBe(true);
  });
  it("is off for a missing library", () => {
    expect(isActive({ library: null, ...on })).toBe(false);
  });
});
