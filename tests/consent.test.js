import { describe, it, expect } from "vitest";
import { findRejectButton, CMP_SELECTORS } from "../src/lib/consent.js";

function mount(html) {
  document.body.innerHTML = html;
  return document.body;
}

describe("findRejectButton", () => {
  it("finds a button whose text says Reject all", () => {
    const root = mount(`<div><button>Accept all</button><button>Reject all</button></div>`);
    const btn = findRejectButton(root);
    expect(btn.textContent).toBe("Reject all");
  });
  it("matches Decline / Necessary only variants", () => {
    const root = mount(`<div><a role="button">Necessary only</a></div>`);
    expect(findRejectButton(root).textContent).toBe("Necessary only");
  });
  it("ignores accept-only banners", () => {
    const root = mount(`<div><button>Accept all</button><button>Got it</button></div>`);
    expect(findRejectButton(root)).toBeNull();
  });
  it("exposes known CMP container selectors", () => {
    expect(CMP_SELECTORS).toContain("#onetrust-banner-sdk");
  });
});