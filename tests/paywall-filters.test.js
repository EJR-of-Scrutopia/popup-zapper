import { describe, it, expect, beforeEach } from "vitest";
import { findPaywallHosts, buildUblockFilters, PAYWALL_VENDORS } from "../src/lib/paywall-filters.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("findPaywallHosts", () => {
  it("finds vendor hosts from script/iframe tags and ignores unrelated ones", () => {
    document.body.innerHTML =
      `<script src="https://cdn.tinypass.com/api/tinypass.min.js"></script>` +
      `<iframe src="https://buy-eu.piano.io/checkout/x"></iframe>` +
      `<script src="https://example.com/app.js"></script>`;
    const hosts = findPaywallHosts(document, null);
    expect(hosts).toContain("cdn.tinypass.com");
    expect(hosts).toContain("buy-eu.piano.io");
    expect(hosts).not.toContain("example.com");
  });

  it("returns empty when no vendors are present", () => {
    document.body.innerHTML = `<script src="https://example.com/app.js"></script>`;
    expect(findPaywallHosts(document, null)).toEqual([]);
  });

  it("reads from Performance resource entries too", () => {
    const perf = {
      getEntriesByType: () => [{ name: "https://c2.piano.io/xbuilder/experience/load" }],
    };
    expect(findPaywallHosts(document, perf)).toContain("c2.piano.io");
  });
});

describe("buildUblockFilters", () => {
  it("formats hosts as uBlock network rules with a header", () => {
    const text = buildUblockFilters(["cdn.tinypass.com", "buy-eu.piano.io"]);
    expect(text).toContain("! Popup Zapper");
    expect(text).toContain("||cdn.tinypass.com^");
    expect(text).toContain("||buy-eu.piano.io^");
  });

  it("returns empty string for no hosts", () => {
    expect(buildUblockFilters([])).toBe("");
  });
});

describe("PAYWALL_VENDORS", () => {
  it("includes Piano/Tinypass", () => {
    expect(PAYWALL_VENDORS.some((re) => re.test("buy-eu.piano.io"))).toBe(true);
    expect(PAYWALL_VENDORS.some((re) => re.test("cdn.tinypass.com"))).toBe(true);
  });
});