import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitBranch } from "./contracts";
import { branchLabel, watchBranch } from "./useGitBranch";

// 最小的 window / document 事件桩：只记录监听器，测「什么时候读」。
const listeners = { window: new Map<string, () => void>(), document: new Map<string, () => void>() };
const target = (map: Map<string, () => void>) => ({
  addEventListener: (type: string, fn: () => void) => map.set(type, fn),
  removeEventListener: (type: string) => map.delete(type),
});
let visibility = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  listeners.window.clear(); listeners.document.clear(); visibility = "visible";
  vi.stubGlobal("window", target(listeners.window));
  vi.stubGlobal("document", { ...target(listeners.document), get visibilityState() { return visibility; } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const main: GitBranch = { repository: true, branch: "main", detached: null };
const settle = () => vi.runAllTimersAsync();

it("订阅时读一次，之后不按时间轮询", async () => {
  const read = vi.fn(async () => main), emit = vi.fn();
  const stop = watchBranch("/repo", emit, read);
  await settle();
  expect(emit).toHaveBeenLastCalledWith(main);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
});

it("窗口获焦、重新可见时各读一次；后台不可见时不读；取消后不再读也不回调", async () => {
  const read = vi.fn(async () => main), emit = vi.fn();
  const stop = watchBranch("/repo", emit, read);
  await settle();
  listeners.window.get("focus")!();
  await settle();
  visibility = "hidden"; listeners.document.get("visibilitychange")!();
  await settle();
  visibility = "visible"; listeners.document.get("visibilitychange")!();
  await settle();
  expect(read).toHaveBeenCalledTimes(3);
  stop();
  expect(listeners.window.size + listeners.document.size).toBe(0);
});

it("读取进行中不重复发起；失败给 null 不抛错", async () => {
  let resolve!: (value: GitBranch) => void;
  const read = vi.fn(() => new Promise<GitBranch>((r) => { resolve = r; })), emit = vi.fn();
  watchBranch("/repo", emit, read);
  listeners.window.get("focus")!();
  expect(read).toHaveBeenCalledTimes(1);
  resolve(main);
  await settle();
  const failing = vi.fn(async () => { throw new Error("git missing"); }), emitFail = vi.fn();
  watchBranch("/broken", emitFail, failing);
  await settle();
  expect(emitFail).toHaveBeenLastCalledWith(null);
});

it("标签：分支名、分离 HEAD 的短提交号、非仓库不显示", () => {
  expect(branchLabel(main)).toEqual({ text: "main", detached: false });
  expect(branchLabel({ repository: true, branch: null, detached: "a1b2c3d" })).toEqual({ text: "a1b2c3d", detached: true });
  expect(branchLabel({ repository: false, branch: null, detached: null })).toBeNull();
  expect(branchLabel(null)).toBeNull();
});
