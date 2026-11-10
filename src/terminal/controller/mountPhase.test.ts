import { afterEach, describe, expect, it, vi } from "vitest";
import { measureMountPhase } from "./mountPhase";

const key = "__belfryTerminalMountTrace";
const original = Object.getOwnPropertyDescriptor(globalThis, key);
const host = {} as HTMLElement;
const install = (value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

afterEach(() => {
  if (original) Object.defineProperty(globalThis, key, original);
  else Reflect.deleteProperty(globalThis, key);
});

describe("optional terminal mount observation", () => {
  it("returns the original value and calls the operation once without an observer", () => {
    install(undefined);
    const value = Promise.resolve("unchanged"), run = vi.fn(() => value);
    expect(measureMountPhase(host, "view.construct", run)).toBe(value);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("associates synchronous boundaries with the same host and tab", () => {
    const seen: unknown[] = [], value = {};
    install((entry: unknown) => { seen.push(entry); });
    expect(measureMountPhase(host, "xterm.open", () => value, "terminal-a")).toBe(value);
    expect(seen).toEqual([
      { host, tabId: "terminal-a", stage: "xterm.open", phase: "start" },
      { host, tabId: "terminal-a", stage: "xterm.open", phase: "return" },
    ]);
  });

  it("still returns and executes once if both observer calls throw", () => {
    const observe = vi.fn(() => { throw new Error("diagnostic failed"); });
    install(observe);
    const value = {}, run = vi.fn(() => value);
    expect(measureMountPhase(host, "renderer.attach", run)).toBe(value);
    expect(run).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("retains the identical original exception when diagnostics also fail", () => {
    install(() => { throw new Error("diagnostic failed"); });
    const error = { code: "ORIGINAL" }, run = vi.fn(() => { throw error; });
    let caught: unknown;
    try { measureMountPhase(host, "view.fit", run); } catch (failure) { caught = failure; }
    expect(caught).toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not let an unavailable observer property change mounting", () => {
    Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error("unavailable hook"); } });
    const value = {}, run = vi.fn(() => value);
    expect(measureMountPhase(host, "view.construct", run)).toBe(value);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
