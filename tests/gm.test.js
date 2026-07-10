import { describe, it, expect, vi } from "vitest";
import { createGm } from "../src/lib/gm.js";

describe("createGm", () => {
  it("prefers async GM.* storage when present", async () => {
    const store = {};
    const env = { GM: { getValue: async (k, d) => (k in store ? store[k] : d), setValue: async (k, v) => { store[k] = v; } } };
    const gm = createGm(env);
    await gm.set("a", "1");
    expect(await gm.get("a", "z")).toBe("1");
    expect(await gm.get("missing", "z")).toBe("z");
  });

  it("wraps synchronous GM_* storage as promises", async () => {
    const store = {};
    const env = {
      GM_getValue: (k) => store[k],
      GM_setValue: (k, v) => { store[k] = v; },
    };
    const gm = createGm(env);
    await gm.set("a", "1");
    expect(await gm.get("a", "z")).toBe("1");
    expect(await gm.get("missing", "z")).toBe("z"); // undefined -> default
  });

  it("falls back to localStorage when no GM storage exists", async () => {
    const mem = {};
    const env = { localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } } };
    const gm = createGm(env);
    await gm.set("a", "1");
    expect(await gm.get("a", "z")).toBe("1");
  });

  it("xhr uses GM_xmlhttpRequest when present", () => {
    const spy = vi.fn();
    const gm = createGm({ GM_xmlhttpRequest: spy });
    const details = { url: "u", onload() {} };
    gm.xhr(details);
    expect(spy).toHaveBeenCalledWith(details);
  });

  it("clipboard prefers GM_setClipboard", async () => {
    const spy = vi.fn();
    const gm = createGm({ GM_setClipboard: spy });
    await gm.clipboard("hi");
    expect(spy).toHaveBeenCalledWith("hi");
  });

  it("openTab prefers GM_openInTab, else window.open", () => {
    const gmOpen = vi.fn();
    createGm({ GM_openInTab: gmOpen }).openTab("u");
    expect(gmOpen).toHaveBeenCalledWith("u", { active: true });
    const open = vi.fn(() => ({}));
    createGm({ open }).openTab("u");
    expect(open).toHaveBeenCalledWith("u", "_blank");
  });
});