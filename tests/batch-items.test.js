import { describe, it, expect, beforeEach } from "vitest";
import {
  autoSource, learnedSource, createRowReader, boxState, isTicked, clickBox,
} from "../src/lib/batch/rows.js";
import { resolveTarget, describeTarget, matchesTarget } from "../src/lib/batch/target.js";
import { isAddText, isInZipText } from "../src/lib/batch/runner.js";
import { readTargetRecord, writeTargetRecord, targetKey } from "../src/lib/batch/settings.js";

beforeEach(() => { document.body.innerHTML = ""; });

// A results list of custom checkboxes (role="checkbox", aria-checked), each
// toggled by its own click handler, beside a filter panel of native boxes.
function customList(n) {
  document.body.innerHTML = `
    <aside class="filters">
      <label><input type="checkbox"> PDF</label>
      <label><input type="checkbox"> DWG</label>
    </aside>
    <ul class="results">
      ${Array.from({ length: n }, (_, i) => `
        <li class="result">
          <span class="tick" role="checkbox" aria-checked="false" tabindex="0"></span>
          <a href="/doc/${i + 1}.pdf">Declaration of performance ${i + 1}</a>
          <span class="meta">PDF 2${i}0 KB</span>
        </li>`).join("")}
    </ul>`;
  for (const box of document.querySelectorAll('[role="checkbox"]')) {
    box.addEventListener("click", () => {
      box.setAttribute("aria-checked", box.getAttribute("aria-checked") === "true" ? "false" : "true");
    });
  }
}

describe("box state", () => {
  it("reads native, ARIA, a hidden input inside, and a class", () => {
    document.body.innerHTML = `
      <input id="n" type="checkbox" checked>
      <div id="a" role="checkbox" aria-checked="true"></div>
      <label id="l"><input type="checkbox"> wrapped</label>
      <div id="c" class="box is-checked"></div>
      <div id="u" class="box"></div>`;
    const $ = (id) => document.getElementById(id);
    expect(boxState($("n"))).toBe(true);
    expect(boxState($("a"))).toBe(true);
    expect(boxState($("l"))).toBe(false);
    expect(boxState($("c"))).toBe(true);
    expect(boxState($("u"))).toBe(null);
  });

  it("tracks a box that shows no state by its own clicks, so it is never clicked twice", () => {
    document.body.innerHTML = '<div id="u" class="box"></div>';
    const box = document.getElementById("u");
    let clicks = 0;
    box.addEventListener("click", () => { clicks++; });
    expect(isTicked(box)).toBe(false);
    clickBox(box);
    expect(isTicked(box)).toBe(true);
    clickBox(box);
    expect(isTicked(box)).toBe(false);
    expect(clicks).toBe(2);
  });
});

describe("automatic source", () => {
  it("reads custom checkbox rows as document rows, and leaves the filter panel alone", () => {
    customList(5);
    const reader = createRowReader(document, { now: () => 0, source: autoSource(document) });
    const rows = reader.rows();
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.box.getAttribute("role") === "checkbox")).toBe(true);
    expect(rows[0].identity.format).toBe("PDF");
  });

  it("counts a native box inside a custom one once", () => {
    document.body.innerHTML = `
      <ul><li><span role="checkbox" aria-checked="false"><input type="checkbox" hidden></span>
        <span>Product data sheet for cavity slab</span> <span>PDF 120 KB</span></li></ul>`;
    const reader = createRowReader(document, { now: () => 0, source: autoSource(document) });
    const rows = reader.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].box.getAttribute("role")).toBe("checkbox");
  });

  it("checked() finds ticked custom boxes, for clearing strays", () => {
    customList(3);
    const reader = createRowReader(document, { now: () => 0, source: autoSource(document) });
    reader.rows();
    document.querySelectorAll('[role="checkbox"]')[1].click();
    expect(reader.checked()).toHaveLength(1);
  });

  it("never reads our own UI", () => {
    customList(2);
    const ours = document.createElement("div");
    ours.setAttribute("data-pz", "batch");
    ours.innerHTML = '<label><input type="checkbox"> Declaration of performance test PDF 10 KB</label>';
    document.body.appendChild(ours);
    const isOurs = (el) => !!el.closest("[data-pz]");
    const reader = createRowReader(document, { now: () => 0, source: autoSource(document, isOurs) });
    expect(reader.rows()).toHaveLength(2);
  });
});

describe("picking an item", () => {
  it("resolves a click on a label, a box, a button, or a styled wrapper", () => {
    document.body.innerHTML = `
      <label id="lab"><input id="inp" type="checkbox"><span id="txt">Pick me</span></label>
      <div id="wrap"><span id="deco"></span><input id="hid" type="checkbox" style="display:none"></div>
      <div class="card"><button id="btn"><span id="ico">+</span> Add to basket</button></div>
      <div id="plain">just a div</div>`;
    const $ = (id) => document.getElementById(id);
    expect(resolveTarget($("txt"))).toEqual({ node: $("inp"), kind: "box" });
    expect(resolveTarget($("deco"))).toEqual({ node: $("hid"), kind: "box" });
    expect(resolveTarget($("ico"))).toEqual({ node: $("btn"), kind: "button" });
    expect(resolveTarget($("plain"))).toEqual({ node: $("plain"), kind: "button" });
  });

  it("a learned box matches its siblings and not the filter panel's boxes", () => {
    customList(6);
    const picked = document.querySelectorAll('[role="checkbox"]')[2];
    const record = describeTarget(picked, "box");
    const all = Array.from(document.querySelectorAll("*")).filter((el) => matchesTarget(el, record));
    expect(all).toHaveLength(6);
    expect(all.every((el) => el.getAttribute("role") === "checkbox")).toBe(true);
  });

  it("state classes are left out, so a ticked box still matches an unticked one", () => {
    document.body.innerHTML = `
      <div class="grid">
        <div class="cell"><i class="chk is-checked"></i> One</div>
        <div class="cell"><i class="chk"></i> Two</div>
      </div>`;
    const ticked = document.querySelector(".is-checked");
    const record = describeTarget(ticked, "box");
    expect(record.chain[0].classes).toEqual(["chk"]);
    expect(Array.from(document.querySelectorAll("i")).filter((el) => matchesTarget(el, record))).toHaveLength(2);
  });

  it("a learned box reads its rows without any document test", () => {
    document.body.innerHTML = `
      <div class="pick-list">
        ${["Alpha", "Beta", "Gamma"].map((name) => `
          <div class="pick-row"><input type="checkbox" class="pick"><span>${name}</span></div>`).join("")}
      </div>
      <div class="other"><input type="checkbox"><span>Remember me</span></div>`;
    const record = describeTarget(document.querySelector(".pick"), "box");
    const reader = createRowReader(document, { now: () => 0, source: learnedSource(document, record, matchesTarget) });
    const rows = reader.rows();
    expect(rows.map((row) => row.identity.title)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("a learned button keeps its words, and knows a plain link may take the page away", () => {
    document.body.innerHTML = `
      <div class="card"><a class="dl" href="/files/a.pdf">Get file</a></div>
      <div class="card"><a class="dl" href="/files/b.pdf" download>Get file</a></div>`;
    const [plain, saving] = document.querySelectorAll("a");
    expect(describeTarget(plain, "button")).toMatchObject({ words: "get file", link: true });
    expect(describeTarget(saving, "button").link).toBe(false);
  });

  it("is remembered per site, and anything malformed reads as nothing picked", () => {
    const data = new Map();
    const storage = {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    };
    const key = targetKey("https://example.com/a?b=1");
    expect(key).toBe(targetKey("https://example.com/elsewhere"));
    const record = { kind: "box", tag: "input", type: "checkbox", role: "", chain: [{ tag: "input", id: "", classes: [] }], words: "" };
    expect(writeTargetRecord(storage, key, record)).toBe(true);
    expect(readTargetRecord(storage, key)).toEqual(record);
    storage.setItem(key, '{"kind":"spoon"}');
    expect(readTargetRecord(storage, key)).toBe(null);
    writeTargetRecord(storage, key, null);
    expect(readTargetRecord(storage, key)).toBe(null);
  });
});

describe("add buttons", () => {
  it("knows more kinds of add button than Add to zip", () => {
    for (const words of ["Add to zip +", "Add to basket", "Add to my list", "+ Add to download list",
      "Save to favourites", "Add to project", "Select for download", "Add to collection"]) {
      expect(isAddText(words), words).toBe(true);
    }
    for (const words of ["Add review", "Download", "Basket", "Address", "Add to zip and then some more words here"]) {
      expect(isAddText(words), words).toBe(false);
    }
  });

  it("knows when an item is already in, without taking a heading for a done button", () => {
    for (const words of ["Remove from zip", "Added to basket", "In your list", "Added", "Selected", "✓"]) {
      expect(isInZipText(words), words).toBe(true);
    }
    expect(isInZipText("Selected filters")).toBe(false);
    expect(isInZipText("Add to zip")).toBe(false);
  });
});
