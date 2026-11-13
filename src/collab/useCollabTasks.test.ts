import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { approveTask, collabTasks, rejectTask, resolveDelivery, stopAllTasks, type TaskView } from "./api";
import { useCollabTasks } from "./useCollabTasks";
import { setLocalePreference } from "../i18n";

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void>, dirty: false }));
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
      return [hooks.slots[index], (next: T | ((old: T) => T)) => {
        const value = typeof next === "function" ? (next as (old: T) => T)(hooks.slots[index] as T) : next;
        if (!Object.is(value, hooks.slots[index])) hooks.dirty = true;
        hooks.slots[index] = value;
      }];
    },
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useCallback: <T,>(value: T, deps: unknown[]) => memo(() => value, deps),
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
vi.mock("./api", () => ({ collabTasks: vi.fn(), approveTask: vi.fn(), rejectTask: vi.fn(), resolveDelivery: vi.fn(), stopAllTasks: vi.fn() }));
let state: ReturnType<typeof useCollabTasks>;
function render() {
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    state = useCollabTasks();
    hooks.effects.splice(0).forEach((effect) => effect());
  } while (hooks.dirty);
}
async function flush(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render(); }
beforeEach(async () => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false;
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
  vi.stubGlobal("navigator", { languages: ["zh-CN"], language: "zh-CN" });
  vi.mocked(collabTasks).mockResolvedValue({ tasks: [] });
  render(); await flush();
});
afterEach(() => {
  hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
  setLocalePreference("zh-CN");
});

it("retranslates a retained action failure without approving again or clearing it on polling", async () => {
  vi.mocked(approveTask).mockRejectedValueOnce({ code: "ROOM_ROLE_NAME_LIMIT", params: { max: 24 }, message: "Role name limit: 24", retryable: false });
  await state.approve("task-a"); await flush();
  expect(state.error).toContain("24");
  expect(state.error).toMatch(/\p{Script=Han}/u);
  setLocalePreference("en"); render();
  expect(state.error).toContain("24");
  expect(state.error).not.toMatch(/\p{Script=Han}/u);
  await flush(3_000);
  expect(state.error).not.toBeNull();
  expect(approveTask).toHaveBeenCalledTimes(1);
  expect(state.actionErrors[0].action).toEqual({ kind: "approve", id: "task-a" });
});

it.each(["approve", "reject", "stopAll"] as const)("%s failure survives successful polling until that action succeeds", async (kind) => {
  const api = { approve: approveTask, reject: rejectTask, stopAll: stopAllTasks }[kind];
  vi.mocked(api).mockRejectedValueOnce(new Error(`${kind} denied`));
  await state[kind]("task-a"); await flush(3_000);
  expect(state.error).toBe(`${kind} denied`);
  await state[kind]("task-a"); await flush();
  expect(state.error).toBeNull();
});

it("allows only one in-flight decision for a task, including repeated clicks", async () => {
  let finish!: () => void;
  vi.mocked(approveTask).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const first = state.approve("task-a");
  void state.approve("task-a"); void state.reject("task-a");
  expect(approveTask).toHaveBeenCalledTimes(1);
  expect(rejectTask).not.toHaveBeenCalled();
  finish(); await first; await flush();
});

it("a successful action on another task cannot dismiss the failed decision", async () => {
  vi.mocked(approveTask).mockRejectedValueOnce(new Error("a denied"));
  await state.approve("a");
  await state.reject("b"); await flush(1_500);
  expect(state.error).toBe("a denied");
});

const uncertain: TaskView = { id: "uncertain-task", shortId: "uncertain", state: "uncertain", fromLabel: "planner", toLabel: "reviewer", instruction: "Review", hop: 1, createdAt: 1, result: null,
  delivery: { phase: "uncertain", attemptId: "original-attempt", sequence: 7, message: "Interrupted" } };
it("sends the exact reviewed receipt and never retries a conflicting manual resolution during polling", async () => {
  vi.mocked(resolveDelivery).mockRejectedValueOnce(new Error("CONFLICT"));
  await state.resolve!(uncertain, "submitted"); await flush(3_000);
  expect(resolveDelivery).toHaveBeenCalledExactlyOnceWith({ id: uncertain.id, attemptId: "original-attempt", sequence: 7, decision: "submitted" });
  expect(state.actionErrors[0]?.action.kind).toBe("resolve");
  expect(state.error).toBe("CONFLICT");
});
it("allows only one manual resolution per task and does not race stop-all", async () => {
  let finish!: () => void;
  vi.mocked(resolveDelivery).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = state.resolve!(uncertain, "cancelled");
  void state.resolve!(uncertain, "submitted"); void state.stopAll();
  expect(resolveDelivery).toHaveBeenCalledTimes(1); expect(stopAllTasks).not.toHaveBeenCalled();
  finish(); await first; await flush();
});
