import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localTaskSnapshot } from "./api";
import { useTaskReports } from "./useTaskReports";
import type { ProtocolTaskPreview, ProtocolTaskSnapshot } from "./contracts";

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
vi.mock("./api", () => ({ localTaskSnapshot: vi.fn() }));
const preview = (id: string): ProtocolTaskPreview => ({ taskRef: { kind: "direct_task", roomId: null, id, generation: 1 }, protocolTaskId: id, state: "TASK_STATE_WORKING", source: "localA2A", text: "Started", textTruncated: false, artifacts: [] });
let state: ReturnType<typeof useTaskReports>, root: string | null;
function render() {
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    state = useTaskReports(root);
    hooks.effects.splice(0).forEach(effect => effect());
  } while (hooks.dirty);
}
async function flush(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render(); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false; hooks.writes = 0;
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  root = "/project-a";
});
afterEach(() => {
  hooks.slots.forEach(slot => (slot as { cleanup?: () => void } | null)?.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it("hides the previous project immediately and ignores its late snapshot after a scope switch", async () => {
  let release!: (value: ProtocolTaskSnapshot) => void;
  vi.mocked(localTaskSnapshot).mockResolvedValueOnce({ tasks: [preview("a")] });
  render(); await flush(); expect(state.tasks[0].taskRef.id).toBe("a");
  vi.mocked(localTaskSnapshot).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  await flush(5000);
  vi.mocked(localTaskSnapshot).mockResolvedValueOnce({ tasks: [preview("b")] });
  root = "/project-b"; render(); expect(state.tasks).toEqual([]);
  await flush(); expect(state.tasks[0].taskRef.id).toBe("b");
  release({ tasks: [preview("late-a")] }); await flush();
  expect(state.tasks[0].taskRef.id).toBe("b");
  root = null; render(); expect(state.tasks).toEqual([]);
});

it("retains the last preview with a refresh error, never mutates tasks, and stops polling while hidden", async () => {
  const entry = preview("task-a");
  vi.mocked(localTaskSnapshot).mockResolvedValueOnce({ tasks: [entry] });
  render(); await flush();
  const failure = { code: "A2A_LOCAL_UNAVAILABLE" };
  vi.mocked(localTaskSnapshot).mockRejectedValueOnce(failure);
  await flush(5000);
  expect(state.tasks).toEqual([entry]); expect(state.error).toBe(failure);
  Object.assign(document, { visibilityState: "hidden" });
  await flush(15000); expect(localTaskSnapshot).toHaveBeenCalledTimes(2);
  Object.assign(document, { visibilityState: "visible" });
  vi.mocked(localTaskSnapshot).mockResolvedValueOnce({ tasks: [] });
  await flush(5000); expect(state.tasks).toEqual([]); expect(state.error).toBeNull();
  expect(vi.mocked(localTaskSnapshot).mock.calls).toEqual([["/project-a"], ["/project-a"], ["/project-a"]]);
});
