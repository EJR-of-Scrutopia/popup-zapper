import { describe, it, expect, beforeEach } from "vitest";
import { createRecorderTool, stepFromClick } from "../src/lib/recorder/tool.js";
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
    expect(out.click.row.title).toContain("Guide D1");
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

describe("the recorder tool", () => {
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
