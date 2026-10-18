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

  it("hands back the manager's tab handle, so a tab it opened can be closed", () => {
    const handle = { close: vi.fn(), closed: false };
    const gm = createGm({ GM_openInTab: () => handle });
    expect(gm.openTab("https://v/doc")).toBe(handle);
  });

  it("writes at once with GM_setValue when it exists, for a click that leaves the page", () => {
    const store = {};
    const asyncSet = vi.fn(async () => {});
    const gm = createGm({ GM: { setValue: asyncSet }, GM_setValue: (k, v) => { store[k] = v; }, GM_getValue: (k) => store[k] });
    expect(gm.setNow("a", "1")).toBe(true);
    expect(store.a).toBe("1");
    expect(asyncSet).not.toHaveBeenCalled();
    expect(gm.getNow("a")).toBe("1");
  });

  it("falls back to the async write, and reads nothing at once, without GM_* storage", () => {
    const asyncSet = vi.fn(async () => {});
    const gm = createGm({ GM: { setValue: asyncSet, getValue: async () => "x" } });
    expect(gm.setNow("a", "1")).toBe(false);
    expect(asyncSet).toHaveBeenCalledWith("a", "1");
    expect(gm.getNow("a")).toBeUndefined();
  });
});