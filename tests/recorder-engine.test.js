import { describe, it, expect } from "vitest";
import {
  startRun, currentTask, whoActs, rowPicked, bindTab, advance, rowEnded, startTurning, turnStarted,
  pageTurned, listArrived, resumed, timedOut, failNote, sameList, stopRun,
} from "../src/lib/recorder/engine.js";

const A = "https://www.cibse.org";
const B = "https://cibseorg.sharepoint.com";
const click = (tab, origin, text, extra = {}) => Object.assign({ kind: "click", tab, origin, path: "/", visit: "r", target: { tag: "a", text, words: text.toLowerCase(), chain: [] }, scope: "page", afterLoad: false, opens: false }, extra);

const rec = {
  origin: A, homeTab: "h", timeout: 30,
  steps: [
    click("h", A, "Access Now", { scope: "row" }),
    click("h", A, "Read online", { afterLoad: true, opens: true }),
    click("b", B, "Download"),
    { kind: "wait", tab: "b", seconds: 5 },
    { kind: "close", tab: "b" },
    { kind: "back", tab: "h", origin: A, visit: "r" },
  ],
};

const me = (token, extra = {}) => Object.assign({ token, visit: token + "-v1", origin: A, href: A + "/list", startedAt: 0, now: 1000, holdUntil: 0 }, extra);
const row = { id: "guide | /item/1", title: "Guide" };

function inSteps(at, tweak = {}) {
  let run = rowPicked(startRun(rec, me("H"), 0), row, 100);
  run = Object.assign({}, run, { at }, tweak);
  return run;
}

describe("starting and picking", () => {
  it("binds the home tab and starts on the list", () => {
    const run = startRun(rec, me("H", { href: A + "/list?page=3" }), 50);
    expect(run.tabs).toEqual({ h: "H" });
    expect(run.home).toBe("H");
    expect(run.listUrl).toBe(A + "/list?page=3");
    expect(run.page).toBe(1);
    expect(currentTask(run, rec)).toEqual({ type: "pick-row" });
  });

  it("gives picking an item to the home tab only", () => {
    const run = startRun(rec, me("H"), 0);
    const task = currentTask(run, rec);
    expect(whoActs(run, rec, me("H"), task).mine).toBe(true);
    expect(whoActs(run, rec, me("X"), task).mine).toBe(false);
  });

  it("holds a page off while it waits for its own navigation", () => {
    const run = startRun(rec, me("H"), 0);
    expect(whoActs(run, rec, me("H", { holdUntil: 5000, now: 1000 }), currentTask(run, rec)).mine).toBe(false);
  });
});

describe("who does a step", () => {
  it("refuses a step after a page load to the page that did the step before", () => {
    let run = inSteps(0);
    run = advance(run, rec, me("H", { visit: "list-1" }), 200).run;
    const task = currentTask(run, rec);
    expect(task.index).toBe(1);
    expect(whoActs(run, rec, me("H", { visit: "list-1" }), task).mine).toBe(false);
    expect(whoActs(run, rec, me("H", { visit: "item-1" }), task).mine).toBe(true);
  });

  it("gives a new tab's first step to a fresh unbound page on that origin", () => {
    const run = inSteps(2, { since: 5000 });
    const task = currentTask(run, rec);
    expect(whoActs(run, rec, me("N", { origin: B, startedAt: 5200 }), task)).toEqual({ mine: true, bind: true, skip: false });
    expect(whoActs(run, rec, me("N", { origin: A, startedAt: 5200 }), task).mine).toBe(false);
    expect(whoActs(run, rec, me("N", { origin: B, startedAt: 3000 }), task).mine).toBe(false);
    expect(whoActs(run, rec, me("H", { origin: B, startedAt: 5200 }), task).mine).toBe(false);
  });

  it("gives a step in a bound tab to that tab alone", () => {
    const run = bindTab(inSteps(3), "b", "N");
    const task = currentTask(run, rec);
    expect(whoActs(run, rec, me("N", { origin: B }), task).mine).toBe(true);
    expect(whoActs(run, rec, me("H"), task).mine).toBe(false);
    expect(run.opened).toEqual(["N"]);
  });

  it("lets the home tab pass over a close for a tab that never opened", () => {
    const run = inSteps(4);
    expect(whoActs(run, rec, me("H"), currentTask(run, rec))).toEqual({ mine: true, bind: false, skip: true });
  });
});

describe("moving on", () => {
  it("unbinds a closed tab, and finishes after the last step", () => {
    let run = bindTab(inSteps(4), "b", "N");
    run = advance(run, rec, me("N", { origin: B }), 300).run;
    expect(run.tabs).toEqual({ h: "H" });
    expect(run.opened).toEqual([]);
    expect(run.since).toBe(300);
    const last = advance(run, rec, me("H"), 400);
    expect(last.finished).toBe(true);
  });

  it("hands the opened tabs back to close when an item ends", () => {
    const run = bindTab(inSteps(3), "b", "N");
    const out = rowEnded(run, 500);
    expect(out.closing).toEqual(["N"]);
    expect(out.run.phase).toBe("unwind");
    expect(out.run.opened).toEqual([]);
    expect(out.run.tabs).toEqual({ h: "H" });
    expect(currentTask(out.run, rec)).toEqual({ type: "unwind" });
    expect(currentTask(listArrived(out.run, 600), rec)).toEqual({ type: "pick-row" });
  });

  it("turns a page: find the next, wait for it, count it", () => {
    let run = startTurning(startRun(rec, me("H"), 0), 10);
    expect(currentTask(run, rec)).toEqual({ type: "turn-page" });
    run = turnStarted(run, me("H", { visit: "p1" }), "a\nb", 20);
    expect(currentTask(run, rec)).toEqual({ type: "await-page" });
    expect(run.turnFrom).toEqual({ visit: "p1", signature: "a\nb", url: A + "/list" });
    run = pageTurned(run, A + "/list?page=2", 30);
    expect(run.page).toBe(2);
    expect(run.listUrl).toBe(A + "/list?page=2");
    expect(currentTask(run, rec)).toEqual({ type: "pick-row" });
  });

  it("starts a resumed run's clock afresh", () => {
    expect(resumed(inSteps(2, { since: 10 }), 999).since).toBe(999);
  });
});

describe("time limits and notes", () => {
  it("fails a step after the recording's timeout", () => {
    const run = inSteps(2, { since: 0 });
    const task = currentTask(run, rec);
    expect(timedOut(run, rec, 30000, task)).toBe(false);
    expect(timedOut(run, rec, 30001, task)).toBe(true);
    expect(failNote(task, rec)).toBe('step 3: "Download" not found in 30 s');
  });

  it("allows 15 s for a list to show items and 20 s for the next page", () => {
    const run = startRun(rec, me("H"), 0);
    expect(timedOut(run, rec, 15001, { type: "pick-row" })).toBe(true);
    expect(timedOut(run, rec, 15001, { type: "await-page" })).toBe(false);
    expect(timedOut(run, rec, 20001, { type: "await-page" })).toBe(true);
  });

  it("reads two addresses as one list page despite a slash or a fragment", () => {
    expect(sameList(A + "/x/?page=2#top", A + "/x?page=2")).toBe(true);
    expect(sameList(A + "/x?page=2", A + "/x?page=3")).toBe(false);
    expect(sameList("not a url", A)).toBe(false);
  });

  it("stops by closing every tab the run opened", () => {
    const live = { mode: "running", run: bindTab(inSteps(3), "b", "N"), closing: ["old"], note: "" };
    expect(stopRun(live, "Stopped.")).toEqual({ mode: "idle", closing: ["old", "N"], note: "Stopped." });
  });
});
