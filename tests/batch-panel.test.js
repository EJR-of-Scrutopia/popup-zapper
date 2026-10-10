import { describe, it, expect, beforeEach, vi } from "vitest";
import { createBatchPanel, numberStyle } from "../src/lib/batch/panel.js";
import { createControlMenu, setTheme } from "../src/lib/ui.js";

beforeEach(() => { document.body.innerHTML = ""; setTheme("auto"); });

const acts = (el) => Array.from(el.querySelectorAll("[data-act]")).map((node) => node.getAttribute("data-act"));

describe("batch panel", () => {
  it("tick mode holds Play, Stop, Reset, batch size, start row, Pick item, Download button and Select all", () => {
    const view = createBatchPanel({ mode: "tick", batchSize: 10, startAt: 3 });
    expect(acts(view.el)).toEqual([
      "batch-close", "batch-play", "batch-stop", "batch-reset", "batch-size", "batch-start",
      "batch-pick-item", "batch-forget-item", "batch-pick-button", "batch-select-all", "batch-details",
    ]);
    expect(view.inputs.size.value).toBe("10");
    expect(view.inputs.start.value).toBe("3");
    expect(view.el.getAttribute("data-pz")).toBe("batch");
  });

  it("click mode swaps the batch numbers for a limit and drops the download button", () => {
    const view = createBatchPanel({ mode: "click", limit: 40 });
    expect(acts(view.el)).toEqual([
      "batch-close", "batch-play", "batch-stop", "batch-reset", "batch-limit",
      "batch-pick-item", "batch-forget-item", "batch-details",
    ]);
    expect(view.inputs.limit.value).toBe("40");
  });

  it("with a picked item, offers to tick it in batches or click each, the current one lit", () => {
    const onKind = vi.fn();
    const view = createBatchPanel({ mode: "tick", kind: "box", onKind });
    const box = view.el.querySelector("[data-act='batch-kind-box']");
    const each = view.el.querySelector("[data-act='batch-kind-button']");
    expect(box.style.fontWeight).toBe("bold");
    box.click();
    expect(onKind).not.toHaveBeenCalled();
    each.click();
    expect(onKind).toHaveBeenCalledWith("button");
    expect(createBatchPanel({ mode: "tick" }).el.querySelector("[data-act='batch-kind-box']")).toBeNull();
  });

  it("fires its handlers", () => {
    const h = { onPlay: vi.fn(), onStop: vi.fn(), onReset: vi.fn(), onPickItem: vi.fn(), onPickButton: vi.fn(),
      onSelectAll: vi.fn(), onClose: vi.fn(), onSize: vi.fn() };
    const view = createBatchPanel({ mode: "tick", ...h });
    for (const [act, fn] of [["batch-play", h.onPlay], ["batch-stop", h.onStop], ["batch-reset", h.onReset],
      ["batch-pick-item", h.onPickItem], ["batch-pick-button", h.onPickButton], ["batch-select-all", h.onSelectAll],
      ["batch-close", h.onClose]]) {
      view.el.querySelector(`[data-act='${act}']`).click();
      expect(fn, act).toHaveBeenCalledOnce();
    }
    view.inputs.size.value = "7";
    view.inputs.size.dispatchEvent(new Event("change"));
    expect(h.onSize).toHaveBeenCalledWith("7");
  });

  it("keeps the details folded until asked, and hides the toggle with nothing to show", () => {
    const view = createBatchPanel({ mode: "tick" });
    const more = view.el.querySelector("[data-act='batch-details']");
    const box = view.el.querySelector("[data-pz-details]");
    expect(more.style.display).toBe("none");
    view.setDetails("line one\nline two");
    expect(more.style.display).toBe("block");
    expect(box.style.display).toBe("none");
    more.click();
    expect(box.style.display).toBe("block");
    view.setDetails("");
    expect(more.style.display).toBe("none");
  });

  it("draws a switch per file type and reports which was pressed", () => {
    const onType = vi.fn();
    const view = createBatchPanel({ mode: "tick", onType });
    view.setTypes([{ format: "PDF", rows: 12, on: true }, { format: "DWG", rows: 3, on: false }]);
    const chips = view.el.querySelectorAll("[data-type]");
    expect(Array.from(chips).map((c) => c.textContent)).toEqual(["PDF 12", "DWG 3"]);
    expect(chips[1].getAttribute("aria-pressed")).toBe("false");
    chips[1].click();
    expect(onType).toHaveBeenCalledWith("DWG");
  });

  it("names what Play does next", () => {
    const view = createBatchPanel({ mode: "tick" });
    const play = view.el.querySelector("[data-act='batch-play']");
    view.setPlay("running");
    expect(play.textContent).toMatch(/Pause/);
    view.setPlay("pausing");
    expect(play.textContent).toMatch(/Resume/);
    view.setPlay("idle");
    expect(play.textContent).toMatch(/Play/);
  });

  it("every number box sets its own size, marked important, so a page's styles cannot crop it", () => {
    const style = numberStyle(56);
    expect(style).toMatch(/(^|;)width:56px !important/);
    expect(style).toMatch(/(^|;)padding:2px 4px !important/);
    expect(style).toMatch(/(^|;)box-sizing:border-box !important/);
    const view = createBatchPanel({ mode: "tick" });
    for (const input of view.el.querySelectorAll("input")) {
      expect(input.style.getPropertyPriority("width")).toBe("important");
    }
  });
});

describe("zapper menu", () => {
  it("offers the batch clicker when given a handler, and says when it is open", () => {
    const onBatch = vi.fn();
    const base = { enabled: true, hostname: "x.com", open: true, status: "", showReveal: false,
      onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {} };
    const closed = createControlMenu({ ...base, onBatch, batchOpen: false });
    const item = closed.querySelector("[data-act='batch']");
    expect(item.textContent).toMatch(/Batch clicker/);
    item.click();
    expect(onBatch).toHaveBeenCalledOnce();
    expect(createControlMenu({ ...base, onBatch, batchOpen: true }).querySelector("[data-act='batch']").textContent)
      .toMatch(/Close batch clicker/);
    expect(createControlMenu(base).querySelector("[data-act='batch']")).toBeNull();
  });
});
