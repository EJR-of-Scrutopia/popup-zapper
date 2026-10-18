import { describe, it, expect } from "vitest";
import { createRecorderStore, markRow, ledgerTally, forgetFailed, ledgerLines, undoLast } from "../src/lib/recorder/store.js";

function fakeGm(sync = true) {
  const values = {};
  const gm = {
    values,
    get: async (key, dflt) => (key in values ? values[key] : dflt),
    set: async (key, value) => { values[key] = value; },
    getNow: (key) => (sync ? values[key] : undefined),
    setNow: (key, value) => { values[key] = value; return sync; },
  };
  return gm;
}

describe("recorder store", () => {
  it("reads defaults from empty storage", async () => {
    const store = createRecorderStore(fakeGm());
    expect(await store.readLive()).toEqual({ mode: "idle", closing: [], note: "" });
    expect(await store.readRecording("https://a")).toBeNull();
    expect(await store.readLedger("https://a")).toEqual({ rows: {} });
    expect(await store.readLeaving()).toBeNull();
  });

  it("keeps each value as a JSON string under its own key", async () => {
    const gm = fakeGm();
    const store = createRecorderStore(gm);
    await store.writeRecording("https://a", { id: "r1", steps: [] });
    await store.writeLedger("https://a", { rows: { x: { status: "done" } } });
    store.writeLiveNow({ mode: "running", closing: [], note: "" });
    store.writeLeavingNow({ token: "t", at: 5 });
    store.writeBeatNow({ token: "h", at: 7 });
    expect(typeof gm.values["pz-rec recording https://a"]).toBe("string");
    expect(gm.values["pz-rec live"]).toBe(JSON.stringify({ mode: "running", closing: [], note: "" }));
    expect(await store.readRecording("https://a")).toEqual({ id: "r1", steps: [] });
    expect((await store.readLedger("https://a")).rows.x.status).toBe("done");
    expect((await store.readLive()).mode).toBe("running");
    expect(await store.readLeaving()).toEqual({ token: "t", at: 5 });
    expect(await store.readBeat()).toEqual({ token: "h", at: 7 });
  });

  it("reads a broken value as its default", async () => {
    const gm = fakeGm();
    gm.values["pz-rec live"] = "{oops";
    gm.values["pz-rec ledger https://a"] = "[]";
    const store = createRecorderStore(gm);
    expect((await store.readLive()).mode).toBe("idle");
    expect(await store.readLedger("https://a")).toEqual({ rows: {} });
  });

  it("reads live at once when the manager can", () => {
    const gm = fakeGm(true);
    gm.values["pz-rec live"] = JSON.stringify({ mode: "recording", closing: [], note: "" });
    expect(createRecorderStore(gm).readLiveNow().mode).toBe("recording");
    expect(createRecorderStore(fakeGm(false)).readLiveNow()).toBeNull();
  });
});

describe("ledger", () => {
  const ledger = () => {
    let held = { rows: {} };
    held = markRow(held, "a", { status: "done", title: "A", note: "", at: "t", page: 1 });
    held = markRow(held, "b", { status: "skipped", title: "B", note: 'page says "buy now"', at: "t", page: 1 });
    held = markRow(held, "c", { status: "failed", title: "C", note: 'step 3: "Download" not found in 30 s', at: "t", page: 2 });
    return held;
  };

  it("counts each status", () => {
    expect(ledgerTally(ledger())).toEqual({ done: 1, skipped: 1, failed: 1 });
  });

  it("takes back the most recent done or skipped item, one per press", () => {
    let held = { rows: {} };
    held = markRow(held, "a", { status: "done", title: "A", note: "", at: "2026-10-18T21:14:44.000Z", page: 1 });
    held = markRow(held, "b", { status: "skipped", title: "B", note: "", at: "2026-10-18T21:14:52.000Z", page: 1 });
    held = markRow(held, "c", { status: "done", title: "C", note: "", at: "2026-10-18T21:14:58.000Z", page: 1 });
    held = markRow(held, "d", { status: "failed", title: "D", note: "", at: "2026-10-18T21:15:04.000Z", page: 1 });
    const first = undoLast(held);
    expect(first.row).toEqual({ id: "c", title: "C", status: "done" });
    expect(Object.keys(first.ledger.rows)).toEqual(["a", "b", "d"]);
    const second = undoLast(first.ledger);
    expect(second.row.id).toBe("b");
    const third = undoLast(second.ledger);
    expect(third.row.id).toBe("a");
    expect(undoLast(third.ledger)).toEqual({ ledger: third.ledger, row: null });
  });

  it("forgets only the failed items, so the next Play tries them again", () => {
    expect(Object.keys(forgetFailed(ledger()).rows)).toEqual(["a", "b"]);
  });

  it("lists the skipped and failed items, one line each", () => {
    expect(ledgerLines(ledger())).toEqual([
      'skipped  B: page says "buy now"',
      'failed   C: step 3: "Download" not found in 30 s',
    ]);
  });
});
