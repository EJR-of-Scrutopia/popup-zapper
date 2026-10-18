import { describe, it, expect } from "vitest";
import {
  newDraft, addClick, addBack, finishRecording, removeStep, insertWait, setWait, insertCheck, describeStep,
} from "../src/lib/recorder/steps.js";

const A = "https://www.cibse.org";
const B = "https://cibseorg.sharepoint.com";
const target = (text, extra = {}) => Object.assign({ kind: "button", tag: "a", chain: [], words: text.toLowerCase(), text, href: "", blank: false }, extra);
const row = { id: "guide d1 | /item/1", title: "Guide D1" };

// Item 1 of the CIBSE portal done by hand: Access Now, Read online (a new
// tab), Download in the viewer, the viewer closed, Back on the item page.
function cibseDraft() {
  let draft = newDraft({ origin: A, listUrl: A + "/knowledge-portal/", homeTab: "h", visit: "v1" });
  draft = addClick(draft, { tab: "h", origin: A, path: "/knowledge-portal/", visit: "v1", target: target("Access Now"), scope: "row", row });
  draft = addClick(draft, { tab: "h", origin: A, path: "/item/1", visit: "v2", target: target("Read online", { blank: true }), scope: "page" });
  draft = addClick(draft, { tab: "b", origin: B, path: "/sites/x", visit: "w1", target: target("Download", { tag: "button" }), scope: "page" });
  draft = addBack(draft, { tab: "h", origin: A, visit: "v3" });
  return draft;
}

describe("recording", () => {
  it("notes the first item's row and a click after a page load", () => {
    const draft = cibseDraft();
    expect(draft.firstRow).toEqual(row);
    expect(draft.steps[0].afterLoad).toBe(false);
    expect(draft.steps[1].afterLoad).toBe(true);
    expect(draft.steps[2].afterLoad).toBe(false);
  });

  it("finishes as: item click, opening click, click in the new tab, wait, close it, back", () => {
    const { recording, problem } = finishRecording(cibseDraft(), null, { now: Date.UTC(2026, 9, 18) });
    expect(problem).toBe("");
    expect(recording.steps.map((step) => step.kind)).toEqual(["click", "click", "click", "wait", "close", "back"]);
    expect(recording.steps[1].opens).toBe(true);
    expect(recording.steps[0].opens).toBe(false);
    expect(recording.steps[3]).toEqual({ kind: "wait", tab: "b", seconds: 5 });
    expect(recording.steps[4]).toEqual({ kind: "close", tab: "b" });
    expect(recording.firstRow).toEqual(row);
    expect(recording.timeout).toBe(30);
    expect(recording.pages).toBe(0);
  });

  it("carries the filters of the recording it replaces", () => {
    const previous = { skipText: "hard copy", onlyText: "", highlight: "PDF", pages: 3, timeout: 45 };
    const { recording } = finishRecording(cibseDraft(), previous, { now: 0 });
    expect(recording.skipText).toBe("hard copy");
    expect(recording.highlight).toBe("PDF");
    expect(recording.pages).toBe(3);
    expect(recording.timeout).toBe(45);
  });

  it("closes a tab left open at the end", () => {
    let draft = newDraft({ origin: A, listUrl: A + "/", homeTab: "h", visit: "v1" });
    draft = addClick(draft, { tab: "h", origin: A, path: "/", visit: "v1", target: target("Open"), scope: "row", row });
    draft = addClick(draft, { tab: "b", origin: B, path: "/", visit: "w1", target: target("Download"), scope: "page" });
    const { recording } = finishRecording(draft, null, { now: 0 });
    expect(recording.steps.map((step) => step.kind)).toEqual(["click", "click", "wait", "close"]);
  });

  it("refuses a recording that does not start on an item, or holds nothing", () => {
    let draft = newDraft({ origin: A, listUrl: A + "/", homeTab: "h", visit: "v1" });
    expect(finishRecording(draft, null, { now: 0 }).problem).toBe("Nothing was recorded.");
    draft = addClick(draft, { tab: "h", origin: A, path: "/", visit: "v1", target: target("Menu"), scope: "page" });
    const out = finishRecording(draft, null, { now: 0 });
    expect(out.problem).toBe("Start with a click on an item in the list.");
    expect(out.recording).toBeNull();
  });

  it("marks a click after Back as after a page load, even on the same visit", () => {
    let draft = cibseDraft();
    draft = addClick(draft, { tab: "h", origin: A, path: "/knowledge-portal/", visit: "v3", target: target("Next"), scope: "page" });
    expect(draft.steps[draft.steps.length - 1].afterLoad).toBe(true);
  });
});

describe("editing", () => {
  const rec = () => finishRecording(cibseDraft(), null, { now: 0 }).recording;

  it("puts a check before the chosen step, on that step's page", () => {
    const edited = insertCheck(rec(), 1, " Buy now ");
    expect(edited.steps[1]).toEqual({ kind: "check", tab: "h", origin: A, text: "Buy now", afterLoad: true });
    expect(edited.steps[2].target.text).toBe("Read online");
    expect(insertCheck(rec(), 0, "x")).toEqual(rec());
    expect(insertCheck(rec(), 1, "  ")).toEqual(rec());
  });

  it("never removes the item click, and removes others", () => {
    const original = rec();
    expect(removeStep(original, 0)).toBe(original);
    expect(removeStep(original, 5).steps).toHaveLength(5);
  });

  it("adds a wait after the chosen step and sets its seconds within 0 to 600", () => {
    const edited = insertWait(rec(), 2);
    expect(edited.steps[3]).toEqual({ kind: "wait", tab: "b", seconds: 3 });
    expect(setWait(edited, 3, "12").steps[3].seconds).toBe(12);
    expect(setWait(edited, 3, 9999).steps[3].seconds).toBe(600);
    expect(setWait(edited, 3, "nope").steps[3].seconds).toBe(3);
    expect(setWait(edited, 0, 5)).toBe(edited);
  });
});

describe("describing steps", () => {
  it("names each step in plain words, numbering tabs after the first", () => {
    const steps = insertCheck(finishRecording(cibseDraft(), null, { now: 0 }).recording, 1, "Buy now").steps;
    expect(steps.map((step, i) => describeStep(step, i, steps))).toEqual([
      'Click "Access Now" on each item',
      'Skip the item if the page says "Buy now"',
      'Click "Read online" (opens a tab)',
      'Tab 2: Click "Download"',
      "Tab 2: Wait 5 s",
      "Tab 2: Close the tab",
      "Go back",
    ]);
  });
});
