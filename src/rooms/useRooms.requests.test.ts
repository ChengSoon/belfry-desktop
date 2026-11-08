import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { Room, RoomsView, RoomSummary } from "./contracts";
import { useRooms } from "./useRooms";

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
vi.mock("./api", () => ({ roomList: vi.fn(), roomGet: vi.fn(), roomDelete: vi.fn(), roomCreate: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function makeRoom(id: string, name = id): Room {
  return { id, name, projectRoot: "/project", createdAt: 0, brief: { objective: "", currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
    members: [], tasks: [], nextTask: 1, messages: [] };
}
function summary(id: string): RoomSummary {
  return { id, name: id, projectRoot: "/project", createdAt: 0, objective: "", memberCount: 0, memberTabIds: [], memberTitles: [],
    foreman: null, openTasks: 0, doneTasks: 0, lastMessageAt: null, paused: false, lastToUser: null };
}
let state: ReturnType<typeof useRooms>;
function render() {
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    state = useRooms();
    hooks.effects.splice(0).forEach((effect) => effect());
  } while (hooks.dirty);
}
function unmount() {
  hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.());
}
async function flush(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render(); }
beforeEach(async () => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false; hooks.writes = 0;
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
  vi.mocked(api.roomList).mockResolvedValue({ rooms: [summary("A"), summary("B")], loadError: null });
  vi.mocked(api.roomGet).mockImplementation(async (id) => makeRoom(id));
  render(); await flush();
  expect(state.room?.id).toBe("A");
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("room request lifetime", () => {
  it("keeps B selected and displayed when A completes after B", async () => {
    const old = deferred<Room>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    state.select("A"); await flush();
    state.select("B"); await flush();
    old.resolve(makeRoom("A", "stale A")); await flush();
    expect(state.selectedId).toBe("B");
    expect(state.room?.id).toBe("B");
  });

  it("does not apply a stale list or its fallback selection after a newer refresh", async () => {
    const old = deferred<RoomsView>();
    vi.mocked(api.roomList).mockReturnValueOnce(old.promise);
    void state.refresh();
    state.select("B"); await flush();
    old.resolve({ rooms: [summary("A")], loadError: "old load error" }); await flush();
    expect(state.selectedId).toBe("B");
    expect(state.rooms.map((room) => room.id)).toEqual(["A", "B"]);
    expect(state.loadError).toBeNull();
    expect(state.room?.id).toBe("B");
  });

  it("keeps the latest explicit refresh of the same room", async () => {
    const old = deferred<Room>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    void state.refresh(); await flush();
    vi.mocked(api.roomGet).mockResolvedValueOnce(makeRoom("A", "new snapshot"));
    await state.refresh(); render();
    old.resolve(makeRoom("A", "old snapshot")); await flush();
    expect(state.room?.name).toBe("new snapshot");
  });

  it("never starts another poll while the previous request is pending", async () => {
    const old = deferred<Room>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    await flush(1_500);
    const count = vi.mocked(api.roomList).mock.calls.length;
    await flush(9_000);
    expect(api.roomList).toHaveBeenCalledTimes(count);
    old.resolve(makeRoom("A")); await flush(1_500);
    expect(api.roomList).toHaveBeenCalledTimes(count + 1);
  });

  it("invalidates pre-operation snapshots before publishing a successful mutation", async () => {
    const old = deferred<Room>();
    const after = deferred<RoomsView>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    await flush(1_500);
    vi.mocked(api.roomList).mockReturnValueOnce(after.promise);
    await state.run(async () => makeRoom("A", "operation succeeded")); render();
    old.resolve(makeRoom("A", "before operation")); await flush();
    expect(state.room?.name).toBe("operation succeeded");
    after.resolve({ rooms: [summary("A"), summary("B")], loadError: null }); await flush();
  });

  it("cannot restore a deleted room with a late snapshot", async () => {
    const old = deferred<Room>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    void state.refresh(); await flush();
    vi.mocked(api.roomList).mockResolvedValue({ rooms: [summary("B")], loadError: null });
    await state.remove("A"); await flush();
    old.resolve(makeRoom("A")); await flush();
    expect(state.selectedId).toBe("B");
    expect(state.room?.id).toBe("B");
    expect(state.rooms.map((room) => room.id)).toEqual(["B"]);
  });

  it("ignores failures from an old selection", async () => {
    const old = deferred<Room>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    void state.refresh(); await flush();
    state.select("B"); await flush();
    old.reject(new Error("old A failed")); await flush();
    expect(state.error).toBeNull();
    expect(state.room?.id).toBe("B");
  });

  it.each(["success", "failure"])("does not publish a late %s after unmount or keep polling", async (outcome) => {
    const old = deferred<Room>();
    vi.mocked(api.roomGet).mockReturnValueOnce(old.promise);
    void state.refresh(); await flush();
    unmount();
    const writes = hooks.writes;
    const requests = vi.mocked(api.roomList).mock.calls.length;
    if (outcome === "success") old.resolve(makeRoom("A", "unmounted"));
    else old.reject(new Error("unmounted"));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(hooks.writes).toBe(writes);
    expect(api.roomList).toHaveBeenCalledTimes(requests);
  });
});
