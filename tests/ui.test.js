import { describe, it, expect, beforeEach, vi } from "vitest";
import { createBadge, createLearnerToolbar, createManagePanel } from "../src/lib/ui.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createBadge", () => {
  it("shows enabled/disabled state and toggles on click", () => {
    const onToggle = vi.fn();
    const badge = createBadge({ enabled: true, onToggle });
    document.body.appendChild(badge);
    expect(badge.textContent).toMatch(/on/i);
    badge.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("createLearnerToolbar", () => {
  it("wires confirm / pick / cancel buttons", () => {
    const onConfirm = vi.fn(), onPick = vi.fn(), onCancel = vi.fn();
    const bar = createLearnerToolbar({ onConfirm, onPick, onCancel });
    document.body.appendChild(bar);
    bar.querySelector("[data-act='confirm']").click();
    bar.querySelector("[data-act='pick']").click();
    bar.querySelector("[data-act='cancel']").click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("createManagePanel", () => {
  it("lists rules and fires delete/promote callbacks", () => {
    const onDelete = vi.fn(), onPromote = vi.fn();
    const lib = {
      global: [{ type: "class", value: "g1", action: "remove" }],
      domains: { "site.com": { rules: [{ type: "id", value: "d1", action: "hide" }] } },
    };
    const panel = createManagePanel({ library: lib, hostname: "site.com", onDelete, onPromote });
    document.body.appendChild(panel);
    expect(panel.textContent).toContain("g1");
    expect(panel.textContent).toContain("d1");
    panel.querySelector("[data-act='delete']").click();
    expect(onDelete).toHaveBeenCalled();
  });
});