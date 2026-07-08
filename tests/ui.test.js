import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createControlMenu, createSettingsPanel, createPickerToolbar, createActivityPanel,
} from "../src/lib/ui.js";

beforeEach(() => { document.body.innerHTML = ""; });

describe("createControlMenu", () => {
  it("renders the three primary buttons and fires their handlers", () => {
    const h = {
      onToggleSite: vi.fn(), onBlock: vi.fn(), onRemovePaywall: vi.fn(),
      onRevert: vi.fn(), onReveal: vi.fn(), onSettings: vi.fn(),
    };
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: true, status: "✓ Blocked div.modal",
      showReveal: false, ...h,
    });
    document.body.appendChild(ctrl);
    ctrl.querySelector("[data-act='block']").click();
    ctrl.querySelector("[data-act='paywall']").click();
    ctrl.querySelector("[data-act='revert']").click();
    ctrl.querySelector("[data-act='site']").click();
    ctrl.querySelector("[data-act='settings']").click();
    expect(h.onBlock).toHaveBeenCalledOnce();
    expect(h.onRemovePaywall).toHaveBeenCalledOnce();
    expect(h.onRevert).toHaveBeenCalledOnce();
    expect(h.onToggleSite).toHaveBeenCalledOnce();
    expect(h.onSettings).toHaveBeenCalledOnce();
  });

  it("shows the status strip text and hides Reveal unless showReveal", () => {
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: true, status: "✓ Blocked div.modal",
      showReveal: false,
      onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    expect(ctrl.textContent).toContain("✓ Blocked div.modal");
    expect(ctrl.querySelector("[data-act='reveal']")).toBeNull();
  });

  it("shows Reveal when showReveal is true", () => {
    const onReveal = vi.fn();
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: true, status: "", showReveal: true,
      onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal, onSettings() {},
    });
    const btn = ctrl.querySelector("[data-act='reveal']");
    expect(btn).not.toBeNull();
    btn.click();
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("badge is a monochrome zap that expands to the name, with state in the title", () => {
    const mk = (enabled) => createControlMenu({
      enabled, hostname: "x.com", open: false, status: "",
      onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    const on = mk(true).querySelector("[data-act='menu']");
    expect(on.querySelector("svg")).not.toBeNull();       // zap icon present
    expect(on.textContent).toContain("Popup Zapper");      // name (hidden until hover)
    expect(on.style.mixBlendMode).toBe("difference");      // adapts to background
    expect(on.title).toMatch(/on/i);
    expect(mk(false).querySelector("[data-act='menu']").title).toMatch(/off/i);
  });
});

describe("createSettingsPanel", () => {
  const base = {
    hostname: "x.com", version: "2.0.0",
    onToggleRule: () => {}, onEditRule: () => {}, onDeleteRule: () => {}, onPromoteRule: () => {},
    onToggleCleanup: () => {}, onCheckUpdates: () => {}, onShowLog: () => {}, onDiagnostics: () => {}, onClose: () => {},
  };

  it("lists rules with toggles and shows the version", () => {
    const library = { global: [], domains: { "x.com": { rules: [{ type: "class", value: "modal", enabled: true }] } } };
    const el = createSettingsPanel({ ...base, library });
    expect(el.textContent).toContain("class: modal");
    expect(el.textContent).toContain("2.0.0");
    expect(el.querySelector("[data-act='toggle-rule']")).not.toBeNull();
    expect(el.querySelector("[data-act='edit-rule']")).not.toBeNull();
    expect(el.querySelector("[data-act='delete-rule']")).not.toBeNull();
  });

  it("fires onToggleRule with the new enabled state", () => {
    const onToggleRule = vi.fn();
    const rule = { type: "class", value: "modal", enabled: true };
    const library = { global: [], domains: { "x.com": { rules: [rule] } } };
    const el = createSettingsPanel({ ...base, library, onToggleRule });
    const cb = el.querySelector("[data-act='toggle-rule']");
    cb.checked = false;
    cb.dispatchEvent(new window.Event("change"));
    expect(onToggleRule).toHaveBeenCalledWith({ rule, scope: "site", enabled: false });
  });

  it("fires onCheckUpdates", () => {
    const onCheckUpdates = vi.fn();
    const library = { global: [], domains: {} };
    const el = createSettingsPanel({ ...base, library, onCheckUpdates });
    el.querySelector("[data-act='check-updates']").click();
    expect(onCheckUpdates).toHaveBeenCalledOnce();
  });
});

describe("createPickerToolbar", () => {
  it("wires nav + block(all-sites flag) + cancel", () => {
    const h = {
      onPrev: vi.fn(), onNext: vi.fn(), onGrow: vi.fn(), onShrink: vi.fn(),
      onBlock: vi.fn(), onCancel: vi.fn(),
    };
    const bar = createPickerToolbar(h);
    document.body.appendChild(bar);
    bar.querySelector("[data-act='next']").click();
    bar.querySelector("[data-act='grow']").click();
    bar.querySelector("[data-act='all-sites']").checked = true;
    bar.querySelector("[data-act='block']").click();
    bar.querySelector("[data-act='cancel']").click();
    expect(h.onNext).toHaveBeenCalledOnce();
    expect(h.onGrow).toHaveBeenCalledOnce();
    expect(h.onBlock).toHaveBeenCalledWith(true); // apply-all checked
    expect(h.onCancel).toHaveBeenCalledOnce();
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