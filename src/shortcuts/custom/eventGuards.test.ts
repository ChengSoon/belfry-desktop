import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppShortcuts } from "../useAppShortcuts";
import { useLauncherShortcut } from "../../plugins/workspace/useLauncherShortcut";

const ports = vi.hoisted(() => ({ effects: [] as (() => (() => void) | void)[], setState: vi.fn(), listen: vi.fn(), runtime: vi.fn() }));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void) | void) => ports.effects.push(effect),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, ports.setState],
  useRef: (current: unknown) => ({ current }), useCallback: (callback: unknown) => callback,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: ports.listen }));
vi.mock("../../plugins/useDirectoryRegistry", () => ({ pluginHost: { requestRuntime: ports.runtime } }));

let recording = false;
let cleanups: (() => void)[] = [];
beforeEach(() => {
  ports.effects.length = 0; recording = false;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { documentElement: { dataset: { platform: "macos" } }, querySelector: () => recording ? {} : null });
  ports.listen.mockResolvedValue(() => {});
  ports.runtime.mockReturnValue(new Promise(() => {}));
});
afterEach(() => { cleanups.forEach((cleanup) => cleanup()); cleanups = []; vi.unstubAllGlobals(); vi.clearAllMocks(); });

function mountEffects() { cleanups = ports.effects.map((effect) => effect()).filter((value): value is () => void => Boolean(value)); }
function key(code: string, modifiers: { metaKey?: boolean; altKey?: boolean } = { metaKey: true }) {
  return Object.assign(new Event("keydown", { cancelable: true }), { code, key: code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false }, modifiers);
}
function appActions() {
  return { blocked: false, quickOpenOpen: false, onActivateSession: vi.fn(), onNewShell: vi.fn(), onOpenSettings: vi.fn(),
    onToggleHistory: vi.fn(), onToggleQuickOpen: vi.fn(), onToggleSidebar: vi.fn(), onToggleUsage: vi.fn() };
}

it("录制时宿主不抢走按键，包括刷新保护；离开录制后恢复正常", () => {
  const actions = appActions(); useAppShortcuts(actions); mountEffects();
  recording = true;
  const reload = key("KeyR"), shell = key("KeyT"); window.dispatchEvent(reload); window.dispatchEvent(shell);
  expect(reload.defaultPrevented).toBe(false);
  expect(shell.defaultPrevented).toBe(false);
  expect(actions.onNewShell).not.toHaveBeenCalled();
  recording = false; const normal = key("KeyT"); window.dispatchEvent(normal);
  expect(actions.onNewShell).toHaveBeenCalledTimes(1);
  expect(normal.defaultPrevented).toBe(true);
});

it("已被上层处理的事件不会再触发宿主动作", () => {
  const actions = appActions(); useAppShortcuts(actions); mountEffects();
  const event = key("KeyT"); event.preventDefault(); window.dispatchEvent(event);
  expect(actions.onNewShell).not.toHaveBeenCalled();
});

it("全局插件启动器事件在录制时不打开，离开录制后恢复", () => {
  useLauncherShortcut(); mountEffects();
  const toggle = ports.listen.mock.calls[0][1] as () => void;
  recording = true; toggle();
  expect(ports.setState).not.toHaveBeenCalled();
  recording = false; toggle();
  expect(ports.setState).toHaveBeenCalledTimes(1);
});
