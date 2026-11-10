import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capabilities } from "./contracts";
import { useInboxDelivery } from "./useInboxDelivery";

// Exercise the real hook with controllable IPC completion order and timer turns.
const hooks = vi.hoisted(() => ({
  cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void>, dirty: false, writes: 0,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const memo = <T,>(make: () => T, deps: unknown[]) => {
    const index = hooks.cursor++;
    const old = hooks.slots[index] as { deps: unknown[]; value: T } | undefined;
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) hooks.slots[index] = { deps, value: make() };
    return (hooks.slots[index] as { value: T }).value;
  };
  return { ...react,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[index], (next: T | ((value: T) => T)) => {
        const value = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        hooks.writes++;
        if (!Object.is(value, hooks.slots[index])) hooks.dirty = true;
        hooks.slots[index] = value;
      }];
    },
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useCallback: <T,>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const index = hooks.cursor++;
      const old = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        const slot = { deps, cleanup: old?.cleanup };
        hooks.slots[index] = slot;
        hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});
vi.mock("./api", () => ({
  inboxPending: vi.fn(async () => ({ revision: 0, recipients: [] })),
  bindTarget: vi.fn(), offerInput: vi.fn(), revokeOffer: vi.fn(), prepareBatch: vi.fn(), beginSubmit: vi.fn(),
  sendReceipt: vi.fn(), abortPrepared: vi.fn(), activateInbox: vi.fn(), inboxCapabilities: vi.fn(),
}));
import * as api from "./api";

const caps = (capabilities: string[], enabled: boolean): Capabilities => ({ schemaVersion: 1, capabilities, enabled });
let state: ReturnType<typeof useInboxDelivery>;
let probe: () => Promise<Capabilities>, activate: (operationId: string) => Promise<Capabilities>;
function render() {
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    state = useInboxDelivery({ tabs: [], targets: new Map(), promptQueueEmpty: () => true, probe, activate });
    hooks.effects.splice(0).forEach((effect) => effect());
  } while (hooks.dirty);
}
function unmount() { hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.()); }
async function flush(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render(); }

beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false; hooks.writes = 0;
  vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
  vi.mocked(api.inboxPending).mockClear();
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("投递 owner 切换", () => {
  it("探测完成前两条路径都不跑", async () => {
    probe = vi.fn(() => new Promise<Capabilities>(() => {})); activate = vi.fn();
    render(); await flush(3_000);
    expect(state.mode).toBe("probing");
    expect(api.inboxPending).not.toHaveBeenCalled();
  });

  it("旧后端（命令不存在）→ legacy，不调用 activate、不跑收件箱运行时", async () => {
    probe = vi.fn(async () => { throw new Error("unknown command collab_inbox_capabilities"); }); activate = vi.fn();
    render(); await flush(); await flush(3_000);
    expect(state.mode).toBe("legacy");
    expect(activate).not.toHaveBeenCalled();
    expect(api.inboxPending).not.toHaveBeenCalled();
  });

  it("没有能力标记 → legacy", async () => {
    probe = vi.fn(async () => caps([], false)); activate = vi.fn();
    render(); await flush();
    expect(state.mode).toBe("legacy");
  });

  it("支持但未启用 → activate 一次后进入 inbox，并开始轮询 pending", async () => {
    probe = vi.fn(async () => caps(["collaboration-inbox-v1"], false));
    activate = vi.fn(async () => caps(["collaboration-inbox-v1"], true));
    render(); await flush(); await flush(800);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(state.mode).toBe("inbox");
    expect(api.inboxPending).toHaveBeenCalled();
  });

  it("已启用 → 直接 inbox，不再 activate", async () => {
    probe = vi.fn(async () => caps(["collaboration-inbox-v1"], true)); activate = vi.fn();
    render(); await flush();
    expect(state.mode).toBe("inbox");
    expect(activate).not.toHaveBeenCalled();
  });

  it("activate 失败 → halted：不回退旧路径，也不跑收件箱运行时", async () => {
    probe = vi.fn(async () => caps(["collaboration-inbox-v1"], false));
    activate = vi.fn(async () => { throw new Error("store busy"); });
    render(); await flush(); await flush(3_000);
    expect(state.mode).toBe("halted");
    expect(api.inboxPending).not.toHaveBeenCalled();
  });

  it("卸载后停止轮询", async () => {
    probe = vi.fn(async () => caps(["collaboration-inbox-v1"], true)); activate = vi.fn();
    render(); await flush(); await flush(800);
    unmount();
    const calls = vi.mocked(api.inboxPending).mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(vi.mocked(api.inboxPending).mock.calls.length).toBe(calls);
  });
});
