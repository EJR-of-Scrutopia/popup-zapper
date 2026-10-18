import { describe, it, expect, beforeEach } from "vitest";
import { findNextControls } from "../src/lib/batch/pager.js";

const opts = { isOurs: () => false, onScreen: () => true, win: window };

function page(html) {
  document.body.innerHTML = html;
  return document.querySelector(".last");
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("findNextControls", () => {
  it("takes rel=next after the last item first", () => {
    const last = page('<div class="last">item</div><a rel="next" href="?p=2">→</a>');
    const found = findNextControls(document, last, opts);
    expect(found).toHaveLength(1);
    expect(found[0].how).toBe("the next page button");
    expect(found[0].control.getAttribute("rel")).toBe("next");
  });

  it("finds a link reading Next Page, as on the CIBSE portal", () => {
    const last = page('<div class="last">item</div><nav><a href="?page=0">Previous Page</a><a href="?page=2">Next Page</a></nav>');
    const found = findNextControls(document, last, opts);
    expect(found[0].control.textContent).toBe("Next Page");
  });

  it("never returns Previous Page or Last", () => {
    const last = page('<div class="last">item</div><a href="?page=0">Previous Page</a><a href="?page=48">Last</a>');
    expect(findNextControls(document, last, opts)).toEqual([]);
  });

  it("ignores a next link above the last item", () => {
    const last = page('<a rel="next" href="?p=2">Next</a><div class="last">item</div>');
    expect(findNextControls(document, last, opts)).toEqual([]);
  });

  it("sees the last page when the current number is the highest", () => {
    const last = page('<div class="last">item</div><a href="?p=1">1</a><a href="?p=2">2</a><a href="?p=3" aria-current="page">3</a>');
    expect(findNextControls(document, last, opts)).toEqual([]);
  });

  it("offers the number after the current one", () => {
    const last = page('<div class="last">item</div><a class="active" href="?p=1">1</a><a href="?p=2">2</a><a href="?p=3">3</a>');
    const found = findNextControls(document, last, opts);
    expect(found.map((each) => each.how)).toContain("page 2");
  });
});
