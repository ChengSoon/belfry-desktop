import { afterEach, beforeEach, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => core);

import { resetNativeBackdropForTest, syncNativeBackdrop } from "./nativeBackdrop";

beforeEach(() => {
  resetNativeBackdropForTest();
  core.invoke.mockReset().mockResolvedValue(null);
  core.isTauri.mockReset().mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

it("waits two frames before the first call so the window reveals an already painted theme", () => {
  const frames: Array<() => void> = [];
  syncNativeBackdrop("light", callback => frames.push(callback));
  expect(core.invoke).not.toHaveBeenCalled();
  frames.shift()!();
  expect(core.invoke).not.toHaveBeenCalled();
  frames.shift()!();
  expect(core.invoke).toHaveBeenCalledWith("app_window_backdrop", { theme: "light" });
});

it("syncs later theme switches immediately", () => {
  syncNativeBackdrop("dark", callback => callback());
  syncNativeBackdrop("light", () => { throw new Error("no frame wait after the first call"); });
  expect(core.invoke.mock.calls.map(([, args]) => args)).toEqual([{ theme: "dark" }, { theme: "light" }]);
});

it("does nothing outside Tauri", () => {
  core.isTauri.mockReturnValue(false);
  syncNativeBackdrop("dark", callback => callback());
  expect(core.invoke).not.toHaveBeenCalled();
});

it("logs instead of throwing when the native call fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  core.invoke.mockRejectedValue(new Error("missing permission"));
  syncNativeBackdrop("dark", callback => callback());
  await vi.waitFor(() => expect(warn).toHaveBeenCalled());
});
