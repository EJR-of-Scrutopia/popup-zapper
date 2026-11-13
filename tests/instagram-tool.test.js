import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInstagramTool } from "../src/lib/instagram/tool.js";

const POST = {
  kind: "photo",
  media: [{ type: "image", url: "https://x.cdninstagram.com/a.jpg", poster: null, index: 0 }],
  hasMore: false,
  caption: "c",
  author: { username: "nasa", avatar: null },
  source: "dom",
};

function grid(codes) {
  document.body.innerHTML = `<main>${codes
    .map((c) => `<a href="/nasa/p/${c}/"><img data-code="${c}"></a>`)
    .join("")}</main>`;
  return [...document.querySelectorAll("a img")];
}

let lb, made, loadPost, saveLibrary, cookie, href, deps;

function fakeLightbox() {
  lb = {
    open: vi.fn(), close: vi.fn(),
    showPost: vi.fn(), showMessage: vi.fn(),
    showLoading: vi.fn(), showNote: vi.fn(),
    isOpen: vi.fn(() => true),
    el: null,
  };
  return lb;
}

function tool(library, { ready = Promise.resolve(library) } = {}) {
  made = [];
  loadPost = vi.fn(async () => ({ ok: true, post: POST }));
  saveLibrary = vi.fn();
  deps = {
    doc: document,
    win: { addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { pathname: href || "/nasa/" } },
    ready,
    getCookie: () => cookie,
    saveLibrary,
    gmXhr: vi.fn(),
    loadPost,
    createLightbox: (opts) => { made.push(opts); return fakeLightbox(); },
  };
  return createInstagramTool(deps);
}

function clickOn(node, init = {}) {
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  node.dispatchEvent(ev);
  return ev;
}

const lib = (over = {}) => ({ enabled: true, disabledDomains: [], instagram: { mode: "auto", view: "ours" }, ...over });

beforeEach(() => {
  cookie = "csrftoken=x";
  href = "/nasa/";
  document.body.innerHTML = "";
});

describe("catching a tile click", () => {
  it("swallows a plain left click and opens the viewer", async () => {
    const tiles = grid(["A1"]);
    const t = tool(lib()); t.start();
    const ev = clickOn(tiles[0]);
    expect(ev.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A1", expect.anything()));
    await vi.waitFor(() => expect(lb.showPost).toHaveBeenCalled());
    t.stop();
  });

  it("lets a ctrl-click through", () => {
    const tiles = grid(["A1"]);
    const t = tool(lib()); t.start();
    expect(clickOn(tiles[0], { ctrlKey: true }).defaultPrevented).toBe(false);
    t.stop();
  });
  it("lets a meta-click through", () => {
    const tiles = grid(["A1"]);
    const t = tool(lib()); t.start();
    expect(clickOn(tiles[0], { metaKey: true }).defaultPrevented).toBe(false);
    t.stop();
  });
  it("lets a shift-click through", () => {
    const tiles = grid(["A1"]);
    const t = tool(lib()); t.start();
    expect(clickOn(tiles[0], { shiftKey: true }).defaultPrevented).toBe(false);
    t.stop();
  });
  it("lets a middle click through", () => {
    const tiles = grid(["A1"]);
    const t = tool(lib()); t.start();
    expect(clickOn(tiles[0], { button: 1 }).defaultPrevented).toBe(false);
    t.stop();
  });
  it("lets a click on a non-post link through", () => {
    document.body.innerHTML = `<a href="/accounts/login/"><span id="s">Log in</span></a>`;
    const t = tool(lib()); t.start();
    expect(clickOn(document.getElementById("s")).defaultPrevented).toBe(false);
    t.stop();
  });
  it("does nothing at all when signed in under auto", async () => {
    cookie = "ds_user_id=99";
    const tiles = grid(["A1"]);
    const t = tool(lib()); t.start(); await t.ready;
    expect(clickOn(tiles[0]).defaultPrevented).toBe(false);
    expect(loadPost).not.toHaveBeenCalled();
    t.stop();
  });
  it("does nothing when instagram is switched off for the site", async () => {
    const tiles = grid(["A1"]);
    const t = tool(lib({ disabledDomains: ["instagram.com"] })); t.start(); await t.ready;
    expect(clickOn(tiles[0]).defaultPrevented).toBe(false);
    t.stop();
  });
});

describe("before the library has resolved", () => {
  it("holds the click, then opens once the answer arrives", async () => {
    let resolve;
    const ready = new Promise((r) => { resolve = r; });
    const tiles = grid(["A1"]);
    const t = tool(null, { ready }); t.start();

    const ev = clickOn(tiles[0]);
    expect(ev.defaultPrevented).toBe(true);
    expect(loadPost).not.toHaveBeenCalled();

    resolve(lib());
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A1", expect.anything()));
    t.stop();
  });

  it("does not open when the answer turns out to be off", async () => {
    let resolve;
    const ready = new Promise((r) => { resolve = r; });
    const tiles = grid(["A1"]);
    const t = tool(null, { ready }); t.start();
    clickOn(tiles[0]);
    resolve(lib({ instagram: { mode: "off", view: "ours" } }));
    await ready;
    await Promise.resolve();
    expect(loadPost).not.toHaveBeenCalled();
    t.stop();
  });
});

describe("a post URL opened directly", () => {
  it("opens the viewer at start", async () => {
    href = "/p/Direct1/";
    const t = tool(lib()); t.start();
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("Direct1", expect.anything()));
    t.stop();
  });
  it("waits for a body to mount into before opening", async () => {
    href = "/p/Direct1/";
    const t = tool(lib());
    // document-start: the parser has not reached <body> yet.
    const body = document.body;
    Object.defineProperty(document, "body", { value: null, configurable: true });
    t.start();
    await t.ready;
    await Promise.resolve();
    expect(loadPost).not.toHaveBeenCalled();

    Object.defineProperty(document, "body", { value: body, configurable: true });
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("Direct1", expect.anything()));
    t.stop();
  });

  it("does not open on a profile URL", async () => {
    href = "/nasa/";
    const t = tool(lib()); t.start();
    await Promise.resolve();
    expect(loadPost).not.toHaveBeenCalled();
    t.stop();
  });
  it("does not reopen the same shortcode twice", async () => {
    href = "/p/Direct1/";
    const t = tool(lib()); t.start();
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledTimes(1));
    await t.openShortcode("Direct1");
    expect(loadPost).toHaveBeenCalledTimes(1);
    t.stop();
  });
});

describe("stepping through the grid", () => {
  it("steps to the next tile", async () => {
    grid(["A1", "A2", "A3"]);
    const t = tool(lib()); t.start();
    await t.openShortcode("A1");
    loadPost.mockClear();
    await made[0].onStep(1);
    expect(loadPost).toHaveBeenCalledWith("A2", expect.anything());
    t.stop();
  });

  it("reads the grid fresh, so a re-render under it is harmless", async () => {
    grid(["A1", "A2", "A3"]);
    const t = tool(lib()); t.start();
    await t.openShortcode("A1");
    grid(["A1", "A9", "A3"]); // Instagram swapped the tiles out
    loadPost.mockClear();
    await made[0].onStep(1);
    expect(loadPost).toHaveBeenCalledWith("A9", expect.anything());
    t.stop();
  });

  it("stops at the end rather than throwing", async () => {
    grid(["A1", "A2"]);
    const t = tool(lib()); t.start();
    await t.openShortcode("A2");
    loadPost.mockClear();
    await expect(made[0].onStep(1)).resolves.not.toThrow();
    expect(loadPost).not.toHaveBeenCalled();
    t.stop();
  });

  it("does not throw when the current post is no longer in the grid", async () => {
    grid(["A1", "A2"]);
    const t = tool(lib()); t.start();
    await t.openShortcode("A1");
    grid(["B1", "B2"]);
    loadPost.mockClear();
    await expect(made[0].onStep(1)).resolves.not.toThrow();
    t.stop();
  });
});

describe("failures and preferences", () => {
  it("shows the reason when the load fails", async () => {
    grid(["A1"]);
    const t = tool(lib());
    t.start();
    loadPost.mockResolvedValueOnce({ ok: false, reason: "nope" });
    await t.openShortcode("A1");
    expect(lb.showMessage).toHaveBeenCalledWith("nope");
    t.stop();
  });

  it("opens in the stored view", async () => {
    grid(["A1"]);
    const t = tool(lib({ instagram: { mode: "auto", view: "embed" } })); t.start();
    await t.openShortcode("A1");
    expect(lb.showPost).toHaveBeenCalledWith(POST, { view: "embed" });
    t.stop();
  });

  it("remembers a view change and redraws in it", async () => {
    grid(["A1"]);
    const t = tool(lib()); t.start();
    await t.openShortcode("A1");
    made[0].onViewChange("embed");
    expect(saveLibrary).toHaveBeenCalled();
    expect(lb.showPost).toHaveBeenLastCalledWith(POST, { view: "embed" });
    t.stop();
  });
});

describe("a load in flight must not deaden the page", () => {
  function slowTool(library) {
    let release;
    const gate = new Promise((r) => { release = r; });
    const t = tool(library);
    loadPost.mockImplementation(async (code) => { await gate; return { ok: true, post: POST }; });
    return { t, release };
  }

  it("a second tile click supersedes the first instead of being dropped", async () => {
    grid(["A1", "A2"]);
    const { t, release } = slowTool(lib());
    t.start(); await t.ready;
    const tiles = [...document.querySelectorAll("a img")];
    clickOn(tiles[0]);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A1", expect.anything()));
    clickOn(tiles[1]);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A2", expect.anything()));
    release();
    t.stop();
  });

  it("closing mid-load leaves the next click working", async () => {
    grid(["A1", "A2"]);
    const { t, release } = slowTool(lib());
    t.start(); await t.ready;
    const tiles = [...document.querySelectorAll("a img")];
    clickOn(tiles[0]);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A1", expect.anything()));
    made[0].onClose();
    loadPost.mockClear();
    clickOn(tiles[1]);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A2", expect.anything()));
    release();
    t.stop();
  });

  it("a failed post can be retried by clicking it again", async () => {
    grid(["A1"]);
    const t = tool(lib());
    t.start(); await t.ready;
    loadPost.mockResolvedValueOnce({ ok: false, reason: "nope" });
    await t.openShortcode("A1");
    expect(lb.showMessage).toHaveBeenCalledWith("nope");
    loadPost.mockClear();
    const tiles = [...document.querySelectorAll("a img")];
    clickOn(tiles[0]);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A1", expect.anything()));
    t.stop();
  });

  it("shows a loading state before the post arrives", async () => {
    grid(["A1"]);
    const { t, release } = slowTool(lib());
    t.start(); await t.ready;
    clickOn([...document.querySelectorAll("a img")][0]);
    await vi.waitFor(() => expect(lb.showLoading).toHaveBeenCalled());
    release();
    t.stop();
  });

  it("ignores a stale load that lands after a newer one", async () => {
    grid(["A1", "A2"]);
    const t = tool(lib());
    t.start(); await t.ready;
    let releaseA;
    loadPost.mockImplementation(async (code) => {
      if (code === "A1") { await new Promise((r) => { releaseA = r; }); return { ok: true, post: { ...POST, caption: "stale" } }; }
      return { ok: true, post: { ...POST, caption: "fresh" } };
    });
    const tiles = [...document.querySelectorAll("a img")];
    clickOn(tiles[0]);
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("A1", expect.anything()));
    clickOn(tiles[1]);
    await vi.waitFor(() => expect(lb.showPost).toHaveBeenCalledWith(expect.objectContaining({ caption: "fresh" }), expect.anything()));
    lb.showPost.mockClear();
    releaseA();
    await Promise.resolve(); await Promise.resolve();
    expect(lb.showPost).not.toHaveBeenCalled();
    t.stop();
  });
});

describe("a save that fails says so", () => {
  it("puts the reason in front of the user", async () => {
    grid(["A1"]);
    const t = tool(lib());
    t.start(); await t.ready;
    await t.openShortcode("A1");
    // An item with no URL is the one failure save.js can reach without network.
    await made[0].onSave({ type: "video", url: null, index: 0 });
    expect(lb.showNote).toHaveBeenCalled();
    expect(String(lb.showNote.mock.calls[0][0])).toMatch(/nothing to save/i);
    t.stop();
  });

  it("says nothing when the save works", async () => {
    grid(["A1"]);
    const t = tool(lib());
    t.start(); await t.ready;
    await t.openShortcode("A1");
    deps.gmXhr.mockImplementation((o) => o.onload({ status: 200, response: new Blob(["x"]) }));
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();
    await made[0].onSave({ type: "image", url: "https://x.cdninstagram.com/a.jpg", index: 0 });
    expect(lb.showNote).not.toHaveBeenCalled();
    t.stop();
  });
});

describe("Instagram's own soft navigations", () => {
  function historyWin(start) {
    const w = {
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      location: { pathname: start, href: "https://www.instagram.com" + start },
      history: {
        pushState() {}, replaceState() {},
      },
    };
    return w;
  }

  it("opens the viewer when the app pushes a post URL", async () => {
    grid(["A1"]);
    const w = historyWin("/nasa/");
    const t = createInstagramTool({
      doc: document, win: w, ready: Promise.resolve(lib()),
      getCookie: () => "csrftoken=x", saveLibrary: vi.fn(), gmXhr: vi.fn(),
      loadPost, createLightbox: (o) => { made.push(o); return fakeLightbox(); },
    });
    t.start(); await t.ready;
    loadPost.mockClear();
    w.location.pathname = "/p/Soft1/";
    w.history.pushState({}, "", "/p/Soft1/");
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledWith("Soft1", expect.anything()));
    t.stop();
  });

  it("puts history back as it found it on stop", async () => {
    const w = historyWin("/nasa/");
    const push = w.history.pushState;
    const t = createInstagramTool({
      doc: document, win: w, ready: Promise.resolve(lib()),
      getCookie: () => "csrftoken=x", saveLibrary: vi.fn(), gmXhr: vi.fn(),
      loadPost, createLightbox: (o) => { made.push(o); return fakeLightbox(); },
    });
    t.start(); await t.ready;
    expect(w.history.pushState).not.toBe(push);
    t.stop();
    expect(w.history.pushState).toBe(push);
  });
});

describe("the boot window on a signed-in visit", () => {
  it("leaves the click entirely alone rather than holding it", async () => {
    cookie = "ds_user_id=99";
    const tiles = grid(["A1"]);
    const t = tool(null, { ready: new Promise(() => {}) });
    t.start();
    expect(clickOn(tiles[0]).defaultPrevented).toBe(false);
    t.stop();
  });
});
