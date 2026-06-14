import { describe, it, expect, vi } from "vitest";
import { createActivityLog } from "../src/lib/log.js";

describe("createActivityLog", () => {
  it("records entries with action and detail", () => {
    const log = createActivityLog();
    log.add("popup", "removed div#gate");
    const e = log.entries();
    expect(e).toHaveLength(1);
    expect(e[0].action).toBe("popup");
    expect(e[0].detail).toBe("removed div#gate");
    expect(typeof e[0].t).toBe("number");
  });

  it("caps the buffer at max entries", () => {
    const log = createActivityLog(3);
    for (let i = 0; i < 5; i++) log.add("x", String(i));
    const e = log.entries();
    expect(e).toHaveLength(3);
    expect(e[0].detail).toBe("2"); // oldest two dropped
  });

  it("collapses identical consecutive entries with a count", () => {
    const log = createActivityLog();
    log.add("autozap", "auto-removed div.pz-log");
    log.add("autozap", "auto-removed div.pz-log");
    log.add("autozap", "auto-removed div.pz-log");
    const e = log.entries();
    expect(e).toHaveLength(1);
    expect(e[0].count).toBe(3);
  });

  it("notifies subscribers and clears", () => {
    const log = createActivityLog();
    const fn = vi.fn();
    log.subscribe(fn);
    log.add("a", "1");
    expect(fn).toHaveBeenCalled();
    log.clear();
    expect(log.entries()).toHaveLength(0);
  });
});