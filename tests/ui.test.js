import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createControlMenu, createSettingsPanel, createPickerToolbar, createActivityPanel,
  formatStatus, palette, setTheme, getTheme, setTouch, getTouch, detectTouch,
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

  it("badge is a bordered zap chip that expands to the name, with state in the title", () => {
    const mk = (enabled, blocked) => createControlMenu({
      enabled, blocked, hostname: "x.com", open: false, status: "",
      onToggleMenu() {}, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    const on = mk(true, false).querySelector("[data-act='menu']");
    expect(on.querySelector("svg")).not.toBeNull();          // zap icon present
    expect(on.textContent).toContain("Popup Zapper");         // name (hidden until hover)
    expect(on.style.border).toMatch(/solid/);                 // visible border
    expect(on.title).toMatch(/on/i);
    expect(mk(false, false).querySelector("[data-act='menu']").title).toMatch(/off/i);
  });

  it("fires onToggleMenu when the badge is clicked", () => {
    const onToggleMenu = vi.fn();
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: false, status: "", showReveal: false,
      onToggleMenu, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    ctrl.querySelector("[data-act='menu']").click();
    expect(onToggleMenu).toHaveBeenCalledOnce();
  });

  it("shows the red blocked-dot only when blocked is true", () => {
    const mk = (blocked) => createControlMenu({
      enabled: true, blocked, hostname: "x.com", open: false, status: "",
      onToggleMenu() {}, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    expect(mk(true).querySelector("[data-pz-dot]").style.display).toBe("block");
    expect(mk(false).querySelector("[data-pz-dot]").style.display).toBe("none");
  });
});

describe("theme", () => {
  it("forces light/dark palettes and reports the current mode", () => {
    const light = (setTheme("light"), palette());
    const dark = (setTheme("dark"), palette());
    expect(getTheme()).toBe("dark");
    expect(light.bg).not.toBe(dark.bg);
    expect(setTheme("nonsense")).toBe("auto"); // invalid falls back to auto
  });
});

describe("touch adaptation", () => {
  it("setTouch toggles the flag and getTouch reports it", () => {
    expect(setTouch(true)).toBe(true);
    expect(getTouch()).toBe(true);
    setTouch(false);
  });

  it("badge shows its label immediately on touch (no hover needed)", () => {
    setTouch(true);
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: false, status: "", blocked: false,
      onToggleMenu() {}, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    const name = [...ctrl.querySelectorAll("span")].find((s) => s.textContent === "Popup Zapper");
    expect(name.style.maxWidth).not.toBe("0px");
    expect(name.style.opacity).toBe("1");
    setTouch(false);
  });

  it("menu items get a larger min-height on touch", () => {
    setTouch(true);
    const ctrl = createControlMenu({
      enabled: true, hostname: "x.com", open: true, status: "", blocked: false,
      onToggleMenu() {}, onToggleSite() {}, onBlock() {}, onRemovePaywall() {}, onRevert() {}, onReveal() {}, onSettings() {},
    });
    const block = ctrl.querySelector("[data-act='block']");
    expect(block.style.minHeight).toBe("44px");
    setTouch(false);
  });
});

describe("formatStatus", () => {
  it("maps raw log actions to friendly phrases", () => {
    expect(formatStatus("popup", "removed div.modal (matched rule)")).toBe("Blocked a popup");
    expect(formatStatus("paywall", "removed 1 veil overlay(s): .piano-meter")).toBe("Removed a paywall veil");
    expect(formatStatus("deblur", "removed blur from 3 element(s)")).toBe("Un-blurred the page");
  });
  it("falls back to the detail for unknown actions", () => {
    expect(formatStatus("mystery", "something happened")).toBe("something happened");
  });
});

describe("createSettingsPanel", () => {
  const base = {
    hostname: "x.com", version: "2.0.0",
    onToggleRule: () => {}, onEditRule: () => {}, onDeleteRule: () => {}, onPromoteRule: () => {},
    onToggleCleanup: () => {}, onSetTheme: () => {}, onCheckUpdates: () => {},
    onInstallUpdate: () => {}, onReloadPage: () => {}, onCopyUpdate: () => {},
    onShowLog: () => {}, onDiagnostics: () => {}, onClose: () => {},
  };

  it("lists rules with toggles and shows the version", () => {
    const library = { global: [], domains: { "x.com": { rules: [{ type: "class", value: "modal", enabled: true }] } } };
    const el = createSettingsPanel({ ...base, library });
    expect(el.textContent).toMatch(/class .*modal/);
    expect(el.textContent).toContain("this site");
    expect(el.textContent).toContain("2.0.0");
    expect(el.querySelector("[data-act='toggle-rule']")).not.toBeNull();
    expect(el.querySelector("[data-act='edit-rule']")).not.toBeNull();
    expect(el.querySelector("[data-act='delete-rule']")).not.toBeNull();
  });

  it("offers a theme control and fires onSetTheme with the chosen mode", () => {
    const onSetTheme = vi.fn();
    const library = { global: [], domains: {} };
    const el = createSettingsPanel({ ...base, library, theme: "auto", onSetTheme });
    el.querySelector("[data-act='theme-dark']").click();
    expect(onSetTheme).toHaveBeenCalledWith("dark");
    // The currently-selected mode is inert (no re-fire).
    onSetTheme.mockClear();
    el.querySelector("[data-act='theme-auto']").click();
    expect(onSetTheme).not.toHaveBeenCalled();
  });

  it("drives the in-panel update flow without native dialogs", () => {
    const onInstallUpdate = vi.fn(), onReloadPage = vi.fn();
    const library = { global: [], domains: {} };
    const avail = createSettingsPanel({ ...base, library, update: { state: "available", remote: "2.0.4" }, onInstallUpdate });
    const installBtn = avail.querySelector("[data-act='install-update']");
    expect(installBtn.textContent).toContain("2.0.4");
    installBtn.click();
    expect(onInstallUpdate).toHaveBeenCalledOnce();

    const opened = createSettingsPanel({ ...base, library, update: { state: "opened", remote: "2.0.4" }, onReloadPage });
    opened.querySelector("[data-act='reload-page']").click();
    expect(onReloadPage).toHaveBeenCalledOnce();

    const current = createSettingsPanel({ ...base, library, update: { state: "current" } });
    expect(current.textContent).toMatch(/latest version/i);
  });

  it("on touch, an available update offers Copy update link instead of the install page", () => {
    setTouch(true);
    const onCopyUpdate = vi.fn();
    const library = { global: [], domains: {} };
    const el = createSettingsPanel({ ...base, library, update: { state: "available", remote: "2.1.0" }, onCopyUpdate });
    const copyBtn = el.querySelector("[data-act='copy-update']");
    expect(copyBtn).not.toBeNull();
    expect(el.querySelector("[data-act='install-update']")).toBeNull();
    copyBtn.click();
    expect(onCopyUpdate).toHaveBeenCalledOnce();
    setTouch(false);
  });

  it("shows the copied confirmation note", () => {
    const library = { global: [], domains: {} };
    const el = createSettingsPanel({ ...base, library, update: { state: "copied" } });
    expect(el.textContent).toMatch(/copied/i);
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