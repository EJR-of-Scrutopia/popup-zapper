import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRecorderPanel } from "../src/lib/recorder/panel.js";
import { findWordRanges, highlightWords, clearHighlights } from "../src/lib/recorder/highlight.js";
import { setTheme } from "../src/lib/ui.js";

beforeEach(() => { document.body.innerHTML = ""; setTheme("auto"); });

const acts = (el) => Array.from(el.querySelectorAll("[data-act]")).map((node) => node.getAttribute("data-act"));
const act = (el, name, index) => el.querySelector(`[data-act="${name}"]` + (index === undefined ? "" : `[data-index="${index}"]`));

describe("highlighting", () => {
  it("finds every place a word stands, ignoring case", () => {
    expect(findWordRanges("Buy now or buy NOW", ["buy now"])).toEqual([[0, 7], [11, 18]]);
    expect(findWordRanges("nothing here", ["buy"])).toEqual([]);
    expect(findWordRanges("aaa", ["aa"])).toEqual([[0, 2]]);
  });

  it("marks nothing, without a fault, where the browser lacks highlights", () => {
    document.body.innerHTML = "<p>Buy now</p>";
    expect(highlightWords(document, "pz-rec-mark", ["buy"], () => false)).toBe(0);
    expect(() => clearHighlights(document)).not.toThrow();
  });
});

describe("recorder panel", () => {
  it("offers Back one beside Reset, to have the last finished item done again", () => {
    const onBack = vi.fn();
    const view = createRecorderPanel({ onBack });
    const back = act(view.el, "rec-back");
    expect(back.textContent).toBe("↶ Back one");
    back.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("opens with close, record, play, stop, reset and back one first, marked as our own", () => {
    const view = createRecorderPanel({});
    expect(acts(view.el).slice(0, 6)).toEqual(["rec-close", "rec-record", "rec-play", "rec-stop", "rec-reset", "rec-back"]);
    expect(view.el.getAttribute("data-pz")).toBe("recorder");
    for (const name of ["rec-add-wait", "rec-check-text", "rec-add-check", "rec-skip", "rec-only", "rec-highlight", "rec-pages", "rec-timeout", "rec-export"]) {
      expect(act(view.el, name)).not.toBeNull();
    }
  });

  it("draws the steps, a remove on every one but the first, and a box on each wait", () => {
    const onRemoveStep = vi.fn();
    const onSelectStep = vi.fn();
    const onWaitSeconds = vi.fn();
    const view = createRecorderPanel({ onRemoveStep, onSelectStep, onWaitSeconds });
    view.setSteps(["Click a", "Wait 5 s", "Go back"], ["click", "wait", "back"], [null, 5, null], 1);
    expect(view.el.querySelectorAll('[data-act="rec-remove"]')).toHaveLength(2);
    expect(act(view.el, "rec-remove", 0)).toBeNull();
    const box = act(view.el, "rec-wait-seconds", 1);
    expect(box.value).toBe("5");
    act(view.el, "rec-remove", 2).click();
    expect(onRemoveStep).toHaveBeenCalledWith(2);
    act(view.el, "rec-step", 0).click();
    expect(onSelectStep).toHaveBeenCalledWith(0);
    box.value = "9";
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onWaitSeconds).toHaveBeenCalledWith(1, "9");
    expect(act(view.el, "rec-step", 1).getAttribute("aria-selected")).toBe("true");
  });

  it("adds a check from the words typed, then empties the box", () => {
    const onAddCheck = vi.fn();
    const view = createRecorderPanel({ onAddCheck });
    act(view.el, "rec-check-text").value = "Buy now";
    act(view.el, "rec-add-check").click();
    expect(onAddCheck).toHaveBeenCalledWith("Buy now");
    expect(act(view.el, "rec-check-text").value).toBe("");
  });

  it("names what Record and Play do next", () => {
    const view = createRecorderPanel({});
    const record = act(view.el, "rec-record");
    const play = act(view.el, "rec-play");
    expect(record.textContent).toBe("⏺ Record");
    view.setMode("recording");
    expect(record.textContent).toBe("■ Stop recording");
    view.setMode("running");
    expect(play.textContent).toBe("⏸ Pause");
    view.setMode("paused");
    expect(play.textContent).toBe("▶ Resume");
    view.setMode("idle");
    expect(play.textContent).toBe("▶ Play");
  });

  it("fills and reports its fields", () => {
    const onSkipText = vi.fn();
    const onPages = vi.fn();
    const view = createRecorderPanel({ onSkipText, onPages });
    view.setFields({ skipText: "hard copy", onlyText: "", highlight: "PDF", pages: 2, timeout: 30 });
    expect(act(view.el, "rec-skip").value).toBe("hard copy");
    expect(act(view.el, "rec-timeout").value).toBe("30");
    act(view.el, "rec-skip").value = "print";
    act(view.el, "rec-skip").dispatchEvent(new Event("change"));
    expect(onSkipText).toHaveBeenCalledWith("print");
    act(view.el, "rec-pages").value = "4";
    act(view.el, "rec-pages").dispatchEvent(new Event("change"));
    expect(onPages).toHaveBeenCalledWith("4");
  });
});
