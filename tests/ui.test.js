import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createControlMenu, createActivityPanel, createLearnerToolbar, createManagePanel,
} from "../src/lib/ui.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createControlMenu", () => {
  it("renders actions and fires their handlers", () => {
    const h = {
      onLearn: vi.fn(), onManage: vi.fn(), onToggleUnlock: vi.fn(),
      onToggleSite: vi.fn(), onShowLog: vi.fn(),
    };
    const ctrl = createControlMenu({ enabled: true, unlock: false, ...h });
    document.body.appendChild(ctrl);
    ctrl.querySelector("[data-act='menu']").click(); // open
    ctrl.querySelector("[data-act='learn']").click();
    ctrl.querySelector("[data-act='manage']").click();
    ctrl.querySelector("[data-act='unlock']").click();
    ctrl.querySelector("[data-act='log']").click();
    ctrl.querySelector("[data-act='site']").click();
    expect(h.onLearn).toHaveBeenCalledOnce();
    expect(h.onManage).toHaveBeenCalledOnce();
    expect(h.onToggleUnlock).toHaveBeenCalledOnce();
    expect(h.onShowLog).toHaveBeenCalledOnce();
    expect(h.onToggleSite).toHaveBeenCalledOnce();
  });

  it("reflects disabled state in the badge label", () => {
    const ctrl = createControlMenu({ enabled: false, unlock: false });
    expect(ctrl.querySelector("[data-act='menu']").textContent).toMatch(/off/i);
  });

  it("shows Unlock mode ON when enabled", () => {
    const ctrl = createControlMenu({ enabled: true, unlock: true, onToggleUnlock() {} });
    expect(ctrl.querySelector("[data-act='unlock']").textContent).toMatch(/on/i);
  });
});

describe("createActivityPanel", () => {
  it("lists entries and fires clear/close", () => {
    const onClear = vi.fn(), onClose = vi.fn();
    const entries = [{ t: Date.now(), action: "popup", detail: "removed div#gate" }];
    const panel = createActivityPanel({ entries, onClear, onClose });
    document.body.appendChild(panel);
    expect(panel.textContent).toContain("removed div#gate");
    panel.querySelector("[data-act='clear']").click();
    panel.querySelector("[data-act='close']").click();
    expect(onClear).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a helpful message when empty", () => {
    const panel = createActivityPanel({ entries: [], onClear() {}, onClose() {} });
    expect(panel.textContent).toMatch(/nothing yet/i);
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