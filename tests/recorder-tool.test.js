import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRecorderTool, stepFromClick, realHref, openStand, withOpenCaught } from "../src/lib/recorder/tool.js";
import { newDraft, addClick } from "../src/lib/recorder/steps.js";

const isOurs = (node) => !!(node && node.closest && node.closest("[data-pz]"));

function fakeGm() {
  const values = {};
  return {
    values,
    get: async (key, dflt) => (key in values ? values[key] : dflt),
    set: async (key, value) => { values[key] = value; },
    getNow: (key) => values[key],
    setNow: (key, value) => { values[key] = value; return true; },
    openTab: () => {},
  };
}

function cibse() {
  const card = (n, title) => `<article class="card"><h3><a class="title" href="/item/${n}">${title}</a></h3>
    <p class="price">Members from FREE</p><a class="btn access" href="/item/${n}">Access Now</a></article>`;
  document.body.innerHTML = `<header class="site"><h1>Knowledge Portal</h1></header>
    <main><div class="results">${card(1, "Guide D1 Transportation")}${card(2, "TM59 Overheating")}${card(3, "TM71 Heat transfer")}</div></main>
    <div class="blank-area"><p>Plain words</p></div>`;
}

const me = { token: "h", visit: "v1", origin: "http://localhost:3000", path: "/" };

beforeEach(() => {
  document.body.innerHTML = "";
  try { sessionStorage.clear(); } catch { /* none */ }
});

describe("building a step from a click", () => {
  it("records the first click on an item as the item click, with its row", () => {
    cibse();
    const draft = newDraft({ origin: me.origin, listUrl: "http://localhost:3000/", homeTab: "h", visit: "v1" });
    const out = stepFromClick(document.querySelectorAll("a.access")[0], me, draft, { doc: document, isOurs });
    expect(out.problem).toBeUndefined();
    expect(out.click.scope).toBe("row");
    expect(out.click.target.words).toBe("access now");
    expect(out.click.row.title).toBe("Guide D1 Transportation");
    expect(out.rowNode.tagName).toBe("ARTICLE");
  });

  it("refuses a first click that is not one of a list", () => {
    cibse();
    const draft = newDraft({ origin: me.origin, listUrl: "/", homeTab: "h", visit: "v1" });
    const out = stepFromClick(document.querySelector("h1"), me, draft, { doc: document, isOurs });
    expect(out.problem).toBe("That isn't one of a list of items. Click the first item's button.");
  });

  it("passes over a later click on the page itself, not on a control", () => {
    cibse();
    let draft = newDraft({ origin: me.origin, listUrl: "/", homeTab: "h", visit: "v1" });
    const first = stepFromClick(document.querySelectorAll("a.access")[0], me, draft, { doc: document, isOurs });
    draft = addClick(draft, first.click);
    const out = stepFromClick(document.querySelector(".blank-area p"), me, draft, { doc: document, isOurs, rowNode: first.rowNode });
    expect(out.ignored).toBe(true);
  });

  it("keeps a later click in the same item's row on the same visit as a row click", () => {
    cibse();
    let draft = newDraft({ origin: me.origin, listUrl: "/", homeTab: "h", visit: "v1" });
    const first = stepFromClick(document.querySelectorAll("a.access")[0], me, draft, { doc: document, isOurs });
    draft = addClick(draft, first.click);
    const out = stepFromClick(document.querySelectorAll("a.title")[0], me, draft, { doc: document, isOurs, rowNode: first.rowNode });
    expect(out.click.scope).toBe("row");
    const elsewhere = stepFromClick(document.querySelectorAll("a.title")[0], Object.assign({}, me, { visit: "v2" }), draft, { doc: document, isOurs, rowNode: first.rowNode });
    expect(elsewhere.click.scope).toBe("page");
  });
});

describe("opening a tab from a replayed click", () => {
  it("opens a link's address only when it is a real one", () => {
    document.body.innerHTML = `<a id="real" href="https://viewer.example/doc/1">x</a><a id="hash" href="#">x</a>
      <a id="same" href="${location.href.split("#")[0]}#top">x</a><a id="js" href="javascript:void(0)">x</a>`;
    expect(realHref(document.getElementById("real"), location.href)).toBe("https://viewer.example/doc/1");
    expect(realHref(document.getElementById("hash"), location.href)).toBe("");
    expect(realHref(document.getElementById("same"), location.href)).toBe("");
    expect(realHref(document.getElementById("js"), location.href)).toBe("");
  });

  it("catches window.open, never opening a blank page, and follows the address set on it later", () => {
    const opened = [];
    const stand = openStand((url) => { opened.push(url); }, "https://www.cibse.org/item/1");
    stand("/viewer/1");
    const blank = stand("");
    stand("about:blank");
    expect(opened).toEqual(["https://www.cibse.org/viewer/1"]);
    blank.location.href = "https://viewer.example/doc/2";
    blank.location = "https://viewer.example/doc/3";
    blank.location.replace("https://viewer.example/doc/4");
    expect(opened.slice(1)).toEqual(["https://viewer.example/doc/2", "https://viewer.example/doc/3", "https://viewer.example/doc/4"]);
  });
});

describe("window.open during a replayed click", () => {
  it("is sent to the manager's tab opener while the click runs, then given back", () => {
    vi.useFakeTimers();
    try {
      const original = () => "the page's own";
      const page = { open: original };
      const opened = [];
      withOpenCaught(page, (url) => { opened.push(url); return { close() {} }; }, "https://www.cibse.org/item/1", () => {
        const tab = page.open("https://cibseorg.sharepoint.com/doc/1", "_blank");
        tab.focus();
      });
      expect(opened).toEqual(["https://cibseorg.sharepoint.com/doc/1"]);
      expect(page.open).not.toBe(original);
      vi.advanceTimersByTime(1000);
      expect(page.open).toBe(original);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the recorder tool", () => {
  it("lets go of a leaving note naming its own token once it lands", async () => {
    const gm = fakeGm();
    gm.values["pz-rec live"] = JSON.stringify({ mode: "recording", closing: [], note: "", draft: newDraft({ origin: "http://localhost:3000", listUrl: "/", homeTab: "h", visit: "v0" }) });
    gm.values["pz-rec leaving"] = JSON.stringify({ token: "h", at: Date.now(), origin: "http://localhost:3000" });
    sessionStorage.setItem("pz-rec tab", "h");
    const tool = createRecorderTool({ gm, version: "test" });
    await tool.resume();
    expect(JSON.parse(gm.values["pz-rec leaving"] || "null")).toBeNull();
    tool.close();
    tool.dispose();
  });

  it("Item back forgets the last finished item and names it, but never while a run goes", async () => {
    const gm = fakeGm();
    const origin = location.origin;
    gm.values["pz-rec ledger " + origin] = JSON.stringify({ rows: {
      a: { status: "done", title: "Guide D14", note: "", at: "2026-10-18T21:14:58.000Z", page: 1 },
      b: { status: "done", title: "Guide D15", note: "", at: "2026-10-18T21:15:04.000Z", page: 1 },
    } });
    const tool = createRecorderTool({ gm, version: "test" });
    tool.open();
    const panel = document.querySelector('[data-pz="recorder"]');
    panel.querySelector('[data-act="rec-back"]').click();
    await new Promise((done) => setTimeout(done, 20));
    expect(Object.keys(JSON.parse(gm.values["pz-rec ledger " + origin]).rows)).toEqual(["a"]);
    expect(panel.textContent).toContain('Item back: "Guide D15" will be done again.');
    gm.values["pz-rec live"] = JSON.stringify({ mode: "running", closing: [], note: "", run: { origin, tabs: {}, opened: [], home: "x" } });
    panel.querySelector('[data-act="rec-back"]').click();
    await new Promise((done) => setTimeout(done, 20));
    expect(Object.keys(JSON.parse(gm.values["pz-rec ledger " + origin]).rows)).toEqual(["a"]);
    expect(panel.textContent).toContain("Pause first, then Item back.");
    tool.close();
    tool.dispose();
  });

  it("Step back sends a running item back one step and says which", async () => {
    const gm = fakeGm();
    const origin = location.origin;
    const click = (tab, text, extra = {}) => Object.assign({ kind: "click", tab, origin, path: "/", visit: "r", target: { tag: "a", text, words: text.toLowerCase(), chain: [] }, scope: "page", afterLoad: false, opens: false }, extra);
    gm.values["pz-rec recording " + origin] = JSON.stringify({
      origin, homeTab: "h", timeout: 60, steps: [click("h", "Access Now", { scope: "row" }), click("h", "Download", { afterLoad: true }), click("h", "Yes, I agree")],
    });
    gm.values["pz-rec live"] = JSON.stringify({ mode: "paused", closing: [], note: "", rev: 4, run: {
      origin, homeTab: "h", home: "H", phase: "steps", at: 2, row: { id: "d16", title: "Guide D16" }, listUrl: origin + "/", page: 1,
      tabs: { h: "H" }, opened: [], visits: { h: "v-item" }, since: 0, turnFrom: null,
    } });
    const tool = createRecorderTool({ gm, version: "test" });
    tool.open();
    const panel = document.querySelector('[data-pz="recorder"]');
    panel.querySelector('[data-act="rec-step-back"]').click();
    await new Promise((done) => setTimeout(done, 20));
    const live = JSON.parse(gm.values["pz-rec live"]);
    expect(live.run.at).toBe(1);
    expect(live.run.visits).toEqual({});
    expect(live.mode).toBe("paused");
    expect(panel.textContent).toContain('Step back: step 2 again, Click "Download".');
    tool.close();
    tool.dispose();
  });

  it("opens its panel on the page", () => {
    const tool = createRecorderTool({ gm: fakeGm(), version: "test" });
    tool.open();
    expect(document.querySelector('[data-pz="recorder"]')).not.toBeNull();
    expect(tool.isOpen()).toBe(true);
    tool.close();
    expect(document.querySelector('[data-pz="recorder"]')).toBeNull();
  });

  it("does nothing at load while the recorder is idle", async () => {
    const tool = createRecorderTool({ gm: fakeGm(), version: "test" });
    expect(await tool.resume()).toBe(false);
    expect(document.querySelector('[data-pz="recorder"]')).toBeNull();
  });

  it("carries on a recording in a tab that already took part", async () => {
    const gm = fakeGm();
    gm.values["pz-rec live"] = JSON.stringify({ mode: "recording", closing: [], note: "", draft: newDraft({ origin: "http://localhost:3000", listUrl: "/", homeTab: "h", visit: "v0" }) });
    sessionStorage.setItem("pz-rec tab", "h");
    const tool = createRecorderTool({ gm, version: "test" });
    expect(await tool.resume()).toBe(true);
    expect(document.querySelector('[data-pz="recorder"]')).not.toBeNull();
    tool.close();
    tool.dispose();
  });
});
