import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { openProject } from "../workspace/api";
import type { ProjectWorkspace } from "../workspace/contracts";
import { useRoomProject } from "./useRoomProject";

// Run the hook with controlled picker/IPC completion, without replacing its state transitions.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], writes: 0 }));
vi.mock("react", async original => {
  const react = await original<typeof import("react")>();
  const memo = <T,>(make: () => T, deps: unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as { value: T; deps: unknown[] } | undefined;
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) hooks.slots[index] = { value: make(), deps };
    return (hooks.slots[index] as { value: T }).value;
  };
  return { ...react,
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[index], (next: T | ((current: T) => T)) => {
        hooks.writes++;
        hooks.slots[index] = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
      }];
    },
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useCallback: <T,>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void), deps: unknown[]) => memo(() => {
      const slot = { cleanup: () => {} };
      hooks.effects.push(() => { slot.cleanup = effect(); });
      return slot;
    }, deps),
  };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../workspace/api", () => ({ openProject: vi.fn() }));
const project = (rootPath: string): ProjectWorkspace => ({ id: rootPath, name: rootPath.split("/").at(-1)!, rootPath, rootUri: `file://${rootPath}` });
const current = project("/current");
let state: ReturnType<typeof useRoomProject>;
function render(initial: ProjectWorkspace | null = current) {
  hooks.cursor = 0;
  state = useRoomProject(initial);
  hooks.effects.splice(0).forEach(effect => effect());
}
function unmount() {
  hooks.slots.forEach(slot => (slot as { value?: { cleanup?: () => void } })?.value?.cleanup?.());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.writes = 0; vi.resetAllMocks(); });
afterEach(unmount);

it("defaults to the current project and keeps the dialog selection if the active workspace changes", () => {
  render();
  expect(state.project).toEqual(current);
  expect(state.path).toBe("/current");
  expect(state.canSubmit).toBe(true);
  render(project("/another-active-workspace"));
  expect(state.project).toEqual(current);
});

it("requires a project when no workspace is open, then accepts the canonical directory returned by IPC", async () => {
  render(null);
  expect(state.path).toBe(""); expect(state.canSubmit).toBe(false);
  vi.mocked(open).mockResolvedValue("/link/../project");
  vi.mocked(openProject).mockResolvedValue(project("/canonical"));
  await state.choose(); render(null);
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
  expect(openProject).toHaveBeenCalledWith("/link/../project");
  expect(state.path).toBe("/canonical"); expect(state.canSubmit).toBe(true);
});

it("cannot submit or open duplicate pickers during directory validation", async () => {
  const validation = deferred<ProjectWorkspace>();
  vi.mocked(open).mockResolvedValue("/pending");
  vi.mocked(openProject).mockReturnValue(validation.promise);
  render();
  const first = state.choose();
  await state.choose(); await Promise.resolve(); render();
  expect(open).toHaveBeenCalledTimes(1);
  expect(state.canSubmit).toBe(false);
  expect(state.project).toBeNull();
  validation.resolve(project("/resolved")); await first; render();
  expect(state.canSubmit).toBe(true); expect(state.path).toBe("/resolved");
});

it("invalidates the previous project on failure, preserves the error on cancellation, and recovers on a valid selection", async () => {
  render();
  vi.mocked(open).mockResolvedValue("/missing");
  vi.mocked(openProject).mockRejectedValue(new Error("Directory unavailable"));
  await state.choose(); render();
  expect(state.path).toBe("/missing"); expect(state.project).toBeNull(); expect(state.canSubmit).toBe(false);
  expect(state.error).toBe("Directory unavailable");
  vi.mocked(open).mockResolvedValue(null);
  await state.choose(); render();
  expect(vi.mocked(open).mock.calls.at(-1)?.[0]?.defaultPath).toBeUndefined();
  expect(state.error).toBe("Directory unavailable"); expect(state.canSubmit).toBe(false);
  vi.mocked(open).mockResolvedValue("/restored");
  vi.mocked(openProject).mockResolvedValue(project("/restored"));
  await state.choose(); render();
  expect(state.error).toBeNull(); expect(state.path).toBe("/restored"); expect(state.canSubmit).toBe(true);
});

it.each([null, "", " "])("leaves a valid default intact when the native picker returns no path (%s)", async path => {
  render(); vi.mocked(open).mockResolvedValue(path);
  await state.choose(); render();
  expect(state.project).toEqual(current); expect(state.canSubmit).toBe(true);
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/current" }));
  expect(openProject).not.toHaveBeenCalled();
});

it("reports picker failures and blocks submission", async () => {
  render(); vi.mocked(open).mockRejectedValue(new Error("Picker unavailable"));
  await state.choose(); render();
  expect(state.error).toBe("Picker unavailable"); expect(state.canSubmit).toBe(false);
});

it("ignores a picker that completes after the dialog unmounts", async () => {
  const picker = deferred<string | null>();
  vi.mocked(open).mockReturnValue(picker.promise);
  render(); const choosing = state.choose(); unmount(); const writes = hooks.writes;
  picker.resolve("/late"); await choosing;
  expect(openProject).not.toHaveBeenCalled(); expect(hooks.writes).toBe(writes);
});

it("does not publish a validation result after unmount", async () => {
  const validation = deferred<ProjectWorkspace>();
  vi.mocked(open).mockResolvedValue("/late"); vi.mocked(openProject).mockReturnValue(validation.promise);
  render(); const choosing = state.choose(); await Promise.resolve(); unmount(); const writes = hooks.writes;
  validation.resolve(project("/late")); await choosing;
  expect(hooks.writes).toBe(writes);
});
