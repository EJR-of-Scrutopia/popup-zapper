import { describe, it, expect } from "vitest";
import {
  startRun, currentTask, whoActs, rowPicked, bindTab, advance, rowEnded, startTurning, turnStarted,
  pageTurned, listArrived, resumed, timedOut, failNote, sameList, stopRun, tokenPlan, overdue,
  adoptToken, beatFresh, tooManyFailures, navigated, pageSettled, stepBack,
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

describe("which pages take part", () => {
  const running = (since) => ({ mode: "running", closing: [], note: "", run: Object.assign(inSteps(2), { since }) });
  const facts = (extra) => Object.assign({ token: null, cloned: false, adopted: null, historyLength: 1, startedAt: 0, now: 0 }, extra);

  it("keeps a tab's own token, but not one copied from the tab that opened it", () => {
    expect(tokenPlan(running(0), facts({ token: "t" }))).toBe("keep");
    expect(tokenPlan(running(0), facts({ token: "t", cloned: true, historyLength: 1 }))).toBe("new");
  });

  it("takes a token the same tab let go of on another site", () => {
    expect(tokenPlan(running(0), facts({ adopted: "t", historyLength: 3 }))).toBe("adopt");
  });

  it("joins a run as a new tab when it opened after the step began, whatever its history", () => {
    expect(tokenPlan(running(5000), facts({ historyLength: 2, startedAt: 5300, now: 5300 }))).toBe("new");
    expect(tokenPlan(running(5000), facts({ historyLength: 2, startedAt: 2000, now: 5300 }))).toBe("none");
    expect(tokenPlan(running(5000), facts({ historyLength: 1, startedAt: 2000, now: 5300 }))).toBe("new");
  });

  it("joins a recording when it opened within 15 s of the last recorded step", () => {
    const live = { mode: "recording", closing: [], note: "", draft: { steps: [{}], lastAt: 10000 } };
    expect(tokenPlan(live, facts({ historyLength: 2, now: 20000 }))).toBe("new");
    expect(tokenPlan(live, facts({ historyLength: 2, now: 30001 }))).toBe("none");
  });

  it("leaves every page alone while idle", () => {
    expect(tokenPlan({ mode: "idle", closing: [], note: "" }, facts({ historyLength: 1 }))).toBe("none");
  });
});

describe("taking over a token the same tab let go of", () => {
  const leaving = { token: "H", at: 1000, origin: "https://www.cibse.org" };
  const facts = (extra) => Object.assign({ origin: "https://login.example", referrerOrigin: "https://www.cibse.org", historyLength: 2, now: 2000, closing: [] }, extra);

  it("takes it on another site, arriving from the site that let it go", () => {
    expect(adoptToken(leaving, facts())).toBe("H");
  });

  it("never takes it on the same site: a tab there keeps its own storage, so it is another tab", () => {
    expect(adoptToken(leaving, facts({ origin: "https://www.cibse.org" }))).toBeNull();
  });

  it("refuses a stale one, one waiting to close, a first page, or another referrer", () => {
    expect(adoptToken(leaving, facts({ now: 6001 }))).toBeNull();
    expect(adoptToken(leaving, facts({ closing: ["H"] }))).toBeNull();
    expect(adoptToken(leaving, facts({ historyLength: 1 }))).toBeNull();
    expect(adoptToken(leaving, facts({ referrerOrigin: "https://elsewhere" }))).toBeNull();
    expect(adoptToken(null, facts())).toBeNull();
  });
});

describe("the home tab's heartbeat", () => {
  it("counts as alive for 150 s", () => {
    expect(beatFresh({ token: "H", at: 0 }, 150000)).toBe(true);
    expect(beatFresh({ token: "H", at: 0 }, 150001)).toBe(false);
    expect(beatFresh(null, 0)).toBe(false);
  });

  it("lets no new page join a run whose home tab has gone", () => {
    const live = { mode: "running", closing: [], note: "", run: Object.assign(inSteps(2), { since: 5000 }) };
    const facts = { token: null, cloned: false, adopted: null, historyLength: 1, startedAt: 5300, now: 5300 };
    expect(tokenPlan(live, Object.assign({ beatFresh: true }, facts))).toBe("new");
    expect(tokenPlan(live, Object.assign({ beatFresh: false }, facts))).toBe("none");
  });
});

describe("runs that go wrong", () => {
  it("stops after three items fail in a row, a done item starting the count again", () => {
    let run = inSteps(2);
    run = rowEnded(run, 1, "failed").run;
    run = rowEnded(run, 2, "failed").run;
    expect(tooManyFailures(run)).toBe(false);
    run = rowEnded(run, 3, "done").run;
    expect(run.failStreak).toBe(0);
    run = rowEnded(rowEnded(rowEnded(run, 4, "failed").run, 5, "failed").run, 6, "failed").run;
    expect(tooManyFailures(run)).toBe(true);
    expect(rowEnded(run, 7, "skipped").run.failStreak).toBe(3);
  });

  it("counts trips back to the list, and starts again on arrival or a new item", () => {
    let run = startRun(rec, me("H"), 0);
    run = navigated(navigated(run, 1), 2);
    expect(run.navigations).toBe(2);
    expect(listArrived(run, 3).navigations).toBe(0);
    expect(rowPicked(run, row, 3).navigations).toBe(0);
  });
});

describe("step back", () => {
  it("goes back one step, so the tab that did it does it again with a fresh timeout", () => {
    const run = Object.assign(inSteps(2), { visits: { h: "item-1" }, since: 0 });
    const out = stepBack(run, rec, 5000);
    expect(out.refused).toBe("");
    expect(out.run.at).toBe(1);
    expect(out.run.visits).toEqual({});
    expect(out.run.since).toBe(5000);
  });

  it("passes over waits to the step before them", () => {
    const run = bindTab(inSteps(4), "b", "N");
    expect(stepBack(run, rec, 1).run.at).toBe(2);
  });

  it("closes a tab opened after the step it goes back to, so that step can open a new one", () => {
    const run = bindTab(inSteps(2), "b", "N");
    const out = stepBack(run, rec, 1);
    expect(out.run.at).toBe(1);
    expect(out.closing).toEqual(["N"]);
    expect(out.run.tabs).toEqual({ h: "H" });
    expect(out.run.opened).toEqual([]);
  });

  it("never goes back to the item click, a Go back or a Close, nor outside an item", () => {
    expect(stepBack(inSteps(1), rec, 1).refused).toBe("That is the item's first step. Use Item back to do the whole item again.");
    expect(stepBack(inSteps(5), rec, 1).refused).toBe("A Go back or Close the tab can't be done again. Use Item back to do the whole item again.");
    expect(stepBack(startRun(rec, me("H"), 0), rec, 1).refused).toBe("No item is under way. Use Item back to do the last one again.");
  });
});

describe("a page ready to be clicked", () => {
  it("waits until the page has loaded and its scripts have stopped changing it", () => {
    expect(pageSettled({ readyState: "interactive", now: 9000, lastChange: 0, completeAt: 0 })).toBe(false);
    expect(pageSettled({ readyState: "complete", now: 1400, lastChange: 1000, completeAt: 1000 })).toBe(false);
    expect(pageSettled({ readyState: "complete", now: 1500, lastChange: 1000, completeAt: 1000 })).toBe(true);
  });

  it("goes ahead 3 s after loading on a page that never stops moving", () => {
    expect(pageSettled({ readyState: "complete", now: 3999, lastChange: 3990, completeAt: 1000 })).toBe(false);
    expect(pageSettled({ readyState: "complete", now: 4000, lastChange: 3990, completeAt: 1000 })).toBe(true);
  });
});

describe("time limits and notes", () => {
  it("lets the home tab end a step nobody took, 5 s after its timeout", () => {
    const run = inSteps(2, { since: 0 });
    const task = currentTask(run, rec);
    expect(overdue(run, rec, 35000, task)).toBe(false);
    expect(overdue(run, rec, 35001, task)).toBe(true);
    expect(overdue(run, rec, 99999, { type: "pick-row" })).toBe(false);
    const waiting = inSteps(3, { since: 0 });
    expect(overdue(waiting, rec, 40000, currentTask(waiting, rec))).toBe(false);
    expect(overdue(waiting, rec, 40001, currentTask(waiting, rec))).toBe(true);
    expect(failNote(currentTask(waiting, rec), rec)).toBe("step 4: wait did not finish in 30 s");
  });

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
