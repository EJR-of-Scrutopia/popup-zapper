import { describe, it, expect } from "vitest";
import { buildHeader } from "../src/userscript-header.js";

describe("buildHeader", () => {
  it("injects the version and update URLs", () => {
    const h = buildHeader("2.0.0");
    expect(h).toContain("// @version      2.0.0");
    expect(h).toContain("// @namespace    https://github.com/edrowbo/popup-zapper");
    expect(h).toContain("// @updateURL    https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js");
    expect(h).toContain("// @downloadURL  https://raw.githubusercontent.com/edrowbo/popup-zapper/main/dist/popup-zapper.user.js");
  });
  it("has no unreplaced placeholder", () => {
    expect(buildHeader("2.0.0")).not.toContain("__VERSION__");
  });
});