import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, updateMessage, updatePlan } from "../src/lib/updates.js";

describe("updates", () => {
  it("parses @version from a header", () => {
    expect(parseVersion("// @name X\n// @version      2.1.0\n")).toBe("2.1.0");
    expect(parseVersion("no header")).toBe(null);
  });
  it("compares versions numerically", () => {
    expect(compareVersions("2.10.0", "2.9.0")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.9.0", "2.0.0")).toBe(-1);
  });
  it("messages by comparison", () => {
    expect(updateMessage("2.0.0", "2.0.0")).toMatch(/up to date/i);
    expect(updateMessage("2.0.0", "2.1.0")).toMatch(/2\.1\.0 available/i);
    expect(updateMessage("2.0.0", null)).toMatch(/couldn.t check/i);
  });
  it("plans an install action only when a newer version exists", () => {
    const up = updatePlan("2.0.1", "2.0.2");
    expect(up.action).toBe("install");
    expect(up.remote).toBe("2.0.2");
    expect(up.message).toMatch(/2\.0\.2/);

    expect(updatePlan("2.0.2", "2.0.2").action).toBe("none");
    expect(updatePlan("2.0.2", "2.0.1").action).toBe("none");
    expect(updatePlan("2.0.2", null).action).toBe("error");
  });
});