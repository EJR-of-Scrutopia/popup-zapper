import { describe, it, expect, beforeEach } from "vitest";
import {
  describeStepTarget, refineWords, rowsFor, rowOf, findInRow, findOnPage, parseWords, rowFilter, wantedRows, pageHasWords,
} from "../src/lib/recorder/targets.js";
import { resolveTarget } from "../src/lib/batch/target.js";

const isOurs = (node) => !!(node && node.closest && node.closest("[data-pz]"));
const visible = { isOurs, onScreen: () => true };

function card(n, title, extra = "") {
  return `<article class="card">
    <a class="thumb" href="/item/${n}"><img alt=""></a>
    <h3><a class="title" href="/item/${n}">${title}</a></h3>
    <p class="price">Members from FREE${extra}</p>
    <a class="btn access" href="/item/${n}">Access Now</a>
  </article>`;
}

function cibse() {
  document.body.innerHTML = `<header class="site"><h1>Knowledge Portal</h1></header>
    <main><div class="results">
      ${card(1, "Guide D1 Transportation systems 2025")}
      ${card(2, "TM59 Overheating risk in dwellings 2026", " · PDF and Hard Copy")}
      ${card(3, "TM71 Measuring heat transfer 2026")}
    </div></main>`;
  return Array.from(document.querySelectorAll("a.access"));
}

function targetOf(node) {
  const found = resolveTarget(node);
  return describeStepTarget(found.node, found.kind);
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("rows of a list", () => {
  it("finds every card from one Access Now, each row the card itself", () => {
    const buttons = cibse();
    const rows = rowsFor(document, targetOf(buttons[1]), isOurs);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.every((row) => row.node.tagName === "ARTICLE")).toBe(true);
    expect(rows[1].title).toContain("TM59 Overheating risk");
    expect(rows[1].title).not.toContain("Access Now");
    expect(rows[1].control).toBe(buttons[1]);
  });

  it("names each item by its heading, for the panel, leaving its identity as it was", () => {
    const buttons = cibse();
    const rows = rowsFor(document, targetOf(buttons[0]), isOurs);
    expect(rows[1].name).toBe("TM59 Overheating risk in dwellings 2026");
    expect(rows[1].id).toContain("members from free");
    document.body.innerHTML = `<ul><li><a class="go" href="/a">Open</a> First plain item text</li><li><a class="go" href="/b">Open</a> Second plain item text</li></ul>`;
    const plain = rowsFor(document, targetOf(document.querySelector("a.go")), isOurs);
    expect(plain[0].name).toBe(plain[0].title);
  });

  it("places a clicked button in its row", () => {
    const buttons = cibse();
    const rows = rowsFor(document, targetOf(buttons[0]), isOurs);
    expect(rowOf(rows, buttons[1]).title).toContain("TM59");
    expect(rowOf(rows, document.querySelector("h1"))).toBeNull();
  });

  it("finds the same button inside another row", () => {
    const buttons = cibse();
    const target = targetOf(buttons[0]);
    const rows = rowsFor(document, target, isOurs);
    expect(findInRow(rows[2].node, target)).toBe(buttons[2]);
  });

  it("leaves out rows the ledger holds, and rows a filter skips", () => {
    const buttons = cibse();
    const rows = rowsFor(document, targetOf(buttons[0]), isOurs);
    const ledger = { rows: { [rows[0].id]: { status: "failed" } } };
    const wanted = wantedRows(rows, ledger, { skipText: "hard copy", onlyText: "" });
    expect(wanted.map((row) => row.id)).toEqual([rows[2].id]);
  });
});

describe("a target on another page", () => {
  it("finds an icon button by its label, the best placed of two", () => {
    document.body.innerHTML = `<div class="toolbar"><span class="group"><button class="cmd" aria-label="Download"><i></i></button></span></div>`;
    const target = targetOf(document.querySelector("button i"));
    expect(target.words).toBe("download");
    document.body.innerHTML = `<div class="other"><button aria-label="Download"><i></i></button></div>
      <div class="toolbar"><span class="group"><button class="cmd" aria-label="Download"><i></i></button></span></div>`;
    expect(findOnPage(document, target, visible)).toBe(document.querySelector(".toolbar button"));
  });

  it("finds nothing when the only match is hidden", () => {
    document.body.innerHTML = `<div class="toolbar"><button class="cmd" aria-label="Download"><i></i></button></div>`;
    const target = targetOf(document.querySelector("button"));
    expect(findOnPage(document, target, { isOurs, onScreen: () => false })).toBeNull();
  });

  it("records an opening link's absolute address and its new-tab target", () => {
    document.body.innerHTML = `<p><a class="read" href="https://viewer.example/doc/1" target="_blank">Read online</a></p>`;
    const target = targetOf(document.querySelector("a"));
    expect(target.blank).toBe(true);
    expect(target.href).toBe("https://viewer.example/doc/1");
    expect(target.text).toBe("Read online");
    expect(target.words).toBe("read online");
  });

  it("keeps words only when most matches share them", () => {
    const buttons = cibse();
    const target = targetOf(buttons[0]);
    expect(refineWords(target, buttons).words).toBe("access now");
    buttons[1].textContent = "Buy";
    buttons[2].textContent = "Sold out";
    expect(refineWords(target, buttons).words).toBe("");
  });
});

describe("what the page says", () => {
  it("finds words the page shows, across elements", () => {
    document.body.innerHTML = "<p>Members only: <b>Buy</b> now</p>";
    expect(pageHasWords(document, "buy now", visible)).toBe(true);
  });

  it("never reads the recorder's own panel, which names the words it checks for", () => {
    document.body.innerHTML = `<p>Read online</p><div data-pz="recorder"><span>Skip the item if the page says "Buy now"</span></div>`;
    expect(pageHasWords(document, "Buy now", visible)).toBe(false);
  });

  it("leaves out hidden text and scripts", () => {
    document.body.innerHTML = `<p class="gone">Buy now</p><script>var buy = "Buy now";</script><p>Read online</p>`;
    const shown = { isOurs, onScreen: (node) => !node.classList.contains("gone") };
    expect(pageHasWords(document, "buy now", shown)).toBe(false);
  });
});

describe("words and filters", () => {
  it("splits typed words on commas and new lines", () => {
    expect(parseWords(" Buy now, hard copy\n\n")).toEqual(["buy now", "hard copy"]);
    expect(parseWords("")).toEqual([]);
  });

  it("skips a title holding a skip word, and one lacking every only word", () => {
    expect(rowFilter("TM59 PDF and Hard Copy", "hard copy", "")).toEqual({ take: false, why: 'skipped: has "hard copy"' });
    expect(rowFilter("TM59 PDF and Hard Copy", "", "tm")).toEqual({ take: true, why: "" });
    expect(rowFilter("TM59 PDF and Hard Copy", "", "guide")).toEqual({ take: false, why: 'skipped: lacks any of "guide"' });
  });
});
