import { describe, it, expect } from "vitest";
import { buildHeader } from "../src/userscript-header.js";

describe("buildHeader", () => {
  it("injects the version and update URLs", () => {
    const h = buildHeader("2.0.0");
    expect(h).toContain("// @version      2.0.0");
    expect(h).toContain("// @namespace    https://github.com/EJR-of-Scrutopia/popup-zapper");
    expect(h).toContain("// @updateURL    https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js");
    expect(h).toContain("// @downloadURL  https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js");
  });
  it("has no unreplaced placeholder", () => {
    expect(buildHeader("2.0.0")).not.toContain("__VERSION__");
  });
  it("grants both underscore and dotted GM APIs for cross-manager support", () => {
    const header = buildHeader("9.9.9");
    expect(header).toContain("// @grant        GM.setValue");
    expect(header).toContain("// @grant        GM.getValue");
    expect(header).toContain("// @grant        GM.xmlHttpRequest");
    expect(header).toContain("// @grant        GM.setClipboard");
    expect(header).toContain("// @grant        GM.openInTab");
    expect(header).toContain("// @grant        GM.addStyle");
  });
});