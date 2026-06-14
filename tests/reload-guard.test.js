import { describe, it, expect, vi } from "vitest";
import { createReloadGuard } from "../src/lib/reload-guard.js";

function fakeEnv() {
  const store = {};
  let t = 1000;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    reloadCalled: 0,
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: { reload() { this.host.reloadCalled++; } },
  };
}

describe("reload guard", () => {
  it("blocks a programmatic reload with no recent interaction", () => {
    const env = fakeEnv(); env.location.host = env;
    const guard = createReloadGuard({
      now: env.now, sessionStorage: env.sessionStorage,
      hadRecentInteraction: () => false, maxReloads: 3, windowMs: 5000,
    });
    expect(guard.allowReload()).toBe(false);
  });

  it("allows a reload right after user interaction", () => {
    const env = fakeEnv();
    const guard = createReloadGuard({
      now: env.now, sessionStorage: env.sessionStorage,
      hadRecentInteraction: () => true, maxReloads: 3, windowMs: 5000,
    });
    expect(guard.allowReload()).toBe(true);
  });

  it("trips the circuit breaker after maxReloads in the window", () => {
    const env = fakeEnv();
    const guard = createReloadGuard({
      now: env.now, sessionStorage: env.sessionStorage,
      hadRecentInteraction: () => true, maxReloads: 2, windowMs: 5000,
    });
    guard.recordReload();
    guard.recordReload();
    expect(guard.isTripped()).toBe(true);
    expect(guard.allowReload()).toBe(false);
  });
});