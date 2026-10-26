import { describe, it, expect, beforeEach } from "vitest";
import { describeTarget, matchesTarget, traitsOf } from "../src/lib/batch/target.js";
import { narrowRecord, refineRecord, ofVariant, bySlot, kindOf } from "../src/lib/batch/variant.js";
import { createRowReader, learnedSource } from "../src/lib/batch/rows.js";

beforeEach(() => { document.body.innerHTML = ""; });

const KINDS = ["pdf", "dwg", "rvt"];
const NAMES = ["Alpha board", "Beta slab", "Gamma roll", "Delta batt", "Epsilon sheet", "Zeta panel"];

// Cards, each with a PDF, a DWG and an RVT download icon. The links share
// their tag and classes; the kind is in the icon inside and the file named.
function iconCards(n, { drawnAlike = false } = {}) {
  document.body.innerHTML = `<div class="grid">${Array.from({ length: n }, (_, i) => `
    <div class="card"><h3>${NAMES[i]}</h3><div class="files">
      ${KINDS.map((kind) => drawnAlike
        ? `<a class="dl" href="#" data-kind="${kind}"><span class="ico"></span></a>`.replace(` data-kind="${kind}"`, "")
        : `<a class="dl" href="/files/p${i + 1}.${kind}" title="Download ${kind.toUpperCase()} for ${NAMES[i]}"><i class="icon icon-${kind}"></i></a>`).join("")}
    </div></div>`).join("")}</div>`;
  return Array.from(document.querySelectorAll("a.dl"));
}

const loose = (record) => Object.assign({}, record, { variant: null });
const alikeOf = (record) => Array.from(document.getElementsByTagName(record.tag)).filter((el) => matchesTarget(el, loose(record)));
const takenBy = (record) => {
  const variant = record.variantOn === false ? null : record.variant;
  const matched = alikeOf(record).filter((el) => matchesTarget(el, record));
  return bySlot(matched, variant, alikeOf(record));
};
const kindsOf = (nodes) => nodes.map((el) => (/\.(\w+)$/.exec(el.getAttribute("href")) || [])[1]);
const picked = (link) => {
  const base = describeTarget(link, "button");
  return narrowRecord(base, link, alikeOf(base));
};

describe("the picked kind", () => {
  it("a picked PDF icon matches the PDF icons only, not the DWG and RVT beside it", () => {
    const links = iconCards(4);
    const record = picked(links[0]);
    expect(alikeOf(record)).toHaveLength(12);
    const taken = takenBy(record);
    expect(kindsOf(taken)).toEqual(["pdf", "pdf", "pdf", "pdf"]);
    // An item's own name is no kind: it does not narrow to one card.
    expect(record.variant.kinds[0].all.some((trait) => /alpha/.test(trait))).toBe(false);
  });

  it("All alike switches the kind off, and back on", () => {
    const links = iconCards(3);
    const record = picked(links[1]);
    expect(takenBy(Object.assign({}, record, { variantOn: false }))).toHaveLength(9);
    expect(kindsOf(takenBy(record))).toEqual(["dwg", "dwg", "dwg"]);
  });

  it("icons drawn alike are told apart by where they sit in the card", () => {
    const links = iconCards(5, { drawnAlike: true });
    const record = picked(links[1]);
    expect(record.variant.kinds[0].slot).toBe(1);
    const taken = takenBy(record);
    expect(taken).toHaveLength(5);
    expect(taken.every((el) => Array.from(el.parentElement.children).indexOf(el) === 1)).toBe(true);
  });

  it("one control per row has no place: the list itself is no card", () => {
    document.body.innerHTML = `<ul>${NAMES.slice(0, 4).map((name) => `<li><span>${name}</span><a class="get" href="/d/${name}.pdf">Get</a></li>`).join("")}</ul>`;
    const record = picked(document.querySelector("a.get"));
    expect(takenBy(record)).toHaveLength(4);
  });

  it("a kind every look-alike shares narrows nothing, so the record carries no variant", () => {
    document.body.innerHTML = `<div>${NAMES.slice(0, 3).map((name) => `<div class="card"><button class="add"><i class="ico-plus"></i> Add to basket</button><span>${name}</span></div>`).join("")}</div>`;
    const first = document.querySelector("button");
    const record = narrowRecord(describeTarget(first, "button"), first, alikeOf(describeTarget(first, "button")));
    expect(record.variant).toBe(null);
    expect(record.examples.yes).toHaveLength(1);
  });

  it("reads the kind from data- values and pictures, never from ids", () => {
    document.body.innerHTML = `
      <a class="x" data-format="pdf" data-id="123456"><img src="/i/pdf-icon.svg?v=3"></a>
      <a class="x" data-format="dwg" data-id="123457"><img src="/i/dwg-icon.svg?v=3"></a>`;
    const traits = traitsOf(document.querySelector("a"));
    expect(traits.has("d:data-format=pdf")).toBe(true);
    expect(traits.has("img:pdf-icon.svg")).toBe(true);
    expect([...traits].some((trait) => /data-id/.test(trait))).toBe(false);
  });

  it("one example's kind keeps traits that recur and are not on every look-alike", () => {
    const links = iconCards(3);
    const kind = kindOf(links[0], alikeOf(describeTarget(links[0], "button")));
    expect(kind.all).toContain("i:icon-pdf");
    expect(kind.all).toContain("ext:pdf");
    expect(kind.all).not.toContain("c:dl");
    expect(kind.slot).toBe(null);
    expect(kind.place).toBe(0);
  });
});

describe("refining the kind", () => {
  it("this kind too takes a second kind in, alongside the first", () => {
    const links = iconCards(3);
    const alike = alikeOf(describeTarget(links[0], "button"));
    const record = refineRecord(picked(links[0]), links[4], true, alike);
    expect(kindsOf(takenBy(record))).toEqual(["pdf", "dwg", "pdf", "dwg", "pdf", "dwg"]);
  });

  it("not this, on a kind taken in, takes that kind out again", () => {
    const links = iconCards(3);
    const alike = alikeOf(describeTarget(links[0], "button"));
    let record = refineRecord(picked(links[0]), links[4], true, alike);
    record = refineRecord(record, links[7], false, alike);
    expect(kindsOf(takenBy(record))).toEqual(["pdf", "pdf", "pdf"]);
    expect(record.examples.yes).toHaveLength(1);
  });

  it("not this, on every look-alike taken, leaves its kind out", () => {
    const links = iconCards(3);
    const alike = alikeOf(describeTarget(links[0], "button"));
    let record = Object.assign(picked(links[0]), { variantOn: false });
    expect(takenBy(record)).toHaveLength(9);
    record = refineRecord(record, links[2], false, alike);
    expect(kindsOf(takenBy(record))).toEqual(["pdf", "pdf", "pdf"]);
  });

  it("not this, on icons drawn alike, holds the kind to its own place", () => {
    const links = iconCards(4, { drawnAlike: true });
    const alike = alikeOf(describeTarget(links[0], "button"));
    let record = Object.assign(picked(links[0]), { variantOn: false });
    // Every icon taken; leave the second one of a card out.
    record = refineRecord(record, links[4], false, alike);
    const taken = takenBy(record);
    expect(taken.length).toBeLessThan(12);
    expect(taken).not.toContain(links[4]);
  });

  it("keeps its examples as traits, so it survives storage", () => {
    const links = iconCards(2);
    const again = JSON.parse(JSON.stringify(picked(links[0])));
    expect(kindsOf(takenBy(again))).toEqual(["pdf", "pdf"]);
    expect(Array.isArray(again.examples.yes[0])).toBe(true);
  });
});

describe("a picked checkbox of one kind, read as rows", () => {
  it("a learned source takes the boxes of the kind and rows them one per card", () => {
    document.body.innerHTML = `<div class="list">${NAMES.slice(0, 3).map((name) => `
      <div class="item"><span>${name}</span>
        <span class="opt" role="checkbox" aria-checked="false" data-size="small"></span>
        <span class="opt" role="checkbox" aria-checked="false" data-size="large"></span>
      </div>`).join("")}</div>`;
    const small = document.querySelector('[data-size="small"]');
    const base = describeTarget(small, "box");
    const record = narrowRecord(base, small, alikeOf(base));
    const source = learnedSource(document, record, matchesTarget, () => false, (list) => bySlot(list, record.variant, alikeOf(base)));
    const rows = createRowReader(document, { now: () => 0, source }).rows();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.box.getAttribute("data-size") === "small")).toBe(true);
    expect(ofVariant(alikeOf(base), record.variant)).toHaveLength(3);
  });
});
