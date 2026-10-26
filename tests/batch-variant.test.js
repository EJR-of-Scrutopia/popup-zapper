import { describe, it, expect, beforeEach } from "vitest";
import { describeTarget, matchesTarget, traitsOf } from "../src/lib/batch/target.js";
import { narrowRecord, refineRecord, ofVariant, bySlot, slotFor, workOutVariant } from "../src/lib/batch/variant.js";
import { createRowReader, learnedSource } from "../src/lib/batch/rows.js";

beforeEach(() => { document.body.innerHTML = ""; });

const KINDS = ["pdf", "dwg", "rvt"];
const NAMES = ["Alpha board", "Beta slab", "Gamma roll", "Delta batt", "Epsilon sheet", "Zeta panel"];

// Cards, each with a PDF, a DWG and an RVT download icon. The links share
// their tag and classes; the kind is in the icon inside and the file named.
function iconCards(n, { kinds = KINDS, drawnAlike = false } = {}) {
  document.body.innerHTML = `<div class="grid">${Array.from({ length: n }, (_, i) => `
    <div class="card"><h3>${NAMES[i]}</h3><div class="files">
      ${kinds.map((kind) => drawnAlike
        ? `<a class="dl" href="/get?id=${i}-${kind}"><span class="ico"></span></a>`
        : `<a class="dl" href="/files/p${i + 1}.${kind}" title="Download ${kind.toUpperCase()} for ${NAMES[i]}"><i class="icon icon-${kind}"></i></a>`).join("")}
    </div></div>`).join("")}</div>`;
  return Array.from(document.querySelectorAll("a.dl"));
}

const alikeOf = (record) => Array.from(document.getElementsByTagName(record.tag))
  .filter((el) => matchesTarget(el, Object.assign({}, record, { variant: null })));
const takenBy = (record) => bySlot(Array.from(document.getElementsByTagName(record.tag)).filter((el) => matchesTarget(el, record)),
  record.variantOn === false ? null : record.variant);

describe("the picked kind", () => {
  it("a picked PDF icon matches the PDF icons only, not the DWG and RVT beside it", () => {
    const links = iconCards(4);
    const pdf = links[0];
    const record = narrowRecord(describeTarget(pdf, "button"), pdf, alikeOf(describeTarget(pdf, "button")));
    expect(alikeOf(record)).toHaveLength(12);
    const taken = takenBy(record);
    expect(taken).toHaveLength(4);
    expect(taken.every((el) => /\.pdf$/.test(el.getAttribute("href")))).toBe(true);
    // The item's own name is no kind: it does not narrow to one card.
    expect(record.variant.all.some((trait) => /alpha/.test(trait))).toBe(false);
  });

  it("All alike switches the kind off, and back on", () => {
    const links = iconCards(3);
    const record = narrowRecord(describeTarget(links[1], "button"), links[1], alikeOf(describeTarget(links[1], "button")));
    expect(takenBy(Object.assign({}, record, { variantOn: false }))).toHaveLength(9);
    expect(takenBy(record)).toHaveLength(3);
  });

  it("icons drawn alike are told apart by where they sit in the card", () => {
    const links = iconCards(5, { drawnAlike: true });
    const second = links[1];
    const base = describeTarget(second, "button");
    const record = narrowRecord(base, second, alikeOf(base));
    expect(record.variant.slot).toBe(1);
    const taken = takenBy(record);
    expect(taken).toHaveLength(5);
    expect(taken.every((el) => /-dwg$/.test(el.getAttribute("href")))).toBe(true);
  });

  it("one control per row is no slot: the list itself is no card", () => {
    document.body.innerHTML = `<ul>${[1, 2, 3, 4].map((i) => `<li><span>Doc ${i}</span><a class="get" href="/d/${i}.pdf">Get</a></li>`).join("")}</ul>`;
    const first = document.querySelector("a.get");
    const base = describeTarget(first, "button");
    const record = narrowRecord(base, first, alikeOf(base));
    expect(takenBy(record)).toHaveLength(4);
  });

  it("a kind shared by every look-alike narrows nothing, so the record carries no variant", () => {
    document.body.innerHTML = `<div>${[1, 2, 3].map((i) => `<div class="card"><button class="add"><i class="ico-plus"></i> Add to basket</button><span>Item ${i}</span></div>`).join("")}</div>`;
    const first = document.querySelector("button");
    const base = describeTarget(first, "button");
    expect(narrowRecord(base, first, alikeOf(base)).variant).toBe(null);
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
});

describe("refining the kind", () => {
  it("this one too widens the kind to what both share", () => {
    const links = iconCards(3);
    const base = describeTarget(links[0], "button");
    const alike = alikeOf(base);
    let record = narrowRecord(base, links[0], alike);
    expect(takenBy(record)).toHaveLength(3);
    // Take the DWG kind in as well: now PDF and DWG, not RVT.
    record = refineRecord(record, links[1], true, alike, [links[0]]);
    const taken = takenBy(record);
    expect(taken.length).toBeGreaterThanOrEqual(6);
  });

  it("not this one leaves its kind out", () => {
    const links = iconCards(3);
    const base = describeTarget(links[0], "button");
    const alike = alikeOf(base);
    let record = Object.assign(narrowRecord(base, links[0], alike), { variantOn: false });
    expect(takenBy(record)).toHaveLength(9);
    record = refineRecord(record, links[2], false, alike, []);
    const taken = takenBy(record);
    expect(taken.some((el) => /\.rvt$/.test(el.getAttribute("href")))).toBe(false);
    expect(taken.some((el) => /\.pdf$/.test(el.getAttribute("href")))).toBe(true);
  });

  it("keeps its examples as traits, so it survives storage", () => {
    const links = iconCards(2);
    const base = describeTarget(links[0], "button");
    const record = narrowRecord(base, links[0], alikeOf(base));
    const again = JSON.parse(JSON.stringify(record));
    expect(takenBy(again)).toHaveLength(2);
    expect(Array.isArray(again.examples.yes[0])).toBe(true);
  });

  it("workOutVariant ignores a trait on every look-alike, and one only the picked has", () => {
    const links = iconCards(3);
    const alike = alikeOf(describeTarget(links[0], "button"));
    const variant = workOutVariant(alike, [traitsOf(links[0])], []);
    expect(variant.all).toContain("i:icon-pdf");
    expect(variant.all).not.toContain("c:dl");
    expect(variant.all.some((trait) => /alpha/.test(trait))).toBe(false);
    expect(slotFor(alike.filter((el) => /pdf/.test(el.href)), [links[0]])).toBe(null);
  });
});

describe("a picked checkbox of one kind, read as rows", () => {
  it("a learned source takes the boxes of the kind and rows them one per card", () => {
    document.body.innerHTML = `<div class="list">${[1, 2, 3].map((i) => `
      <div class="item"><span>Swatch ${i}</span>
        <span class="opt" role="checkbox" aria-checked="false" data-size="small"></span>
        <span class="opt" role="checkbox" aria-checked="false" data-size="large"></span>
      </div>`).join("")}</div>`;
    const small = document.querySelector('[data-size="small"]');
    const base = describeTarget(small, "box");
    const record = narrowRecord(base, small, alikeOf(base));
    const source = learnedSource(document, record, matchesTarget, () => false, (list) => bySlot(list, record.variant));
    const rows = createRowReader(document, { now: () => 0, source }).rows();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.box.getAttribute("data-size") === "small")).toBe(true);
    expect(ofVariant(alikeOf(base), record.variant)).toHaveLength(3);
  });
});
