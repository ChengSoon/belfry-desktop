import { afterEach, expect, it, vi } from "vitest";
import { useFlyout } from "./useFlyout";

const ports = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  setOpen: vi.fn(), focus: vi.fn(),
  inside: false,
}));
vi.mock("react", () => ({
  useState: () => [true, ports.setOpen],
  useId: () => "flyout",
  useCallback: (callback: unknown) => callback,
  useRef: () => ({ current: { focus: ports.focus, contains: () => ports.inside,
    querySelector: () => ({ focus: ports.focus }) } }),
  useEffect: (effect: () => (() => void) | undefined) => ports.effects.push(effect),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); ports.effects.length = 0; ports.inside = false; });

function mount() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  vi.stubGlobal("document", { addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name) });
  useFlyout();
  const cleanup = ports.effects[0]();
  return { listeners, cleanup };
}

it("展开后聚焦选项，Esc 关闭并把焦点交回入口", () => {
  const { listeners, cleanup } = mount();
  expect(ports.focus).toHaveBeenCalledTimes(1);
  const event = { key: "Escape", preventDefault: vi.fn() };
  listeners.get("keydown")!(event);
  expect(ports.setOpen).toHaveBeenCalledWith(false);
  expect(ports.focus).toHaveBeenCalledTimes(2);
  expect(event.preventDefault).toHaveBeenCalled();
  cleanup?.(); expect(listeners.size).toBe(0);
});

it("输入法组合输入和内层表单消费的 Esc 不关闭外层浮窗", () => {
  const { listeners } = mount();
  listeners.get("keydown")!({ key: "Escape", isComposing: true });
  listeners.get("keydown")!({ key: "Escape", defaultPrevented: true });
  expect(ports.setOpen).not.toHaveBeenCalled();
});

it("点击内部保持展开，外部点击关闭但不抢点击目标的焦点", () => {
  const { listeners } = mount();
  ports.inside = true; listeners.get("mousedown")!({ target: {} });
  expect(ports.setOpen).not.toHaveBeenCalled();
  ports.inside = false; listeners.get("mousedown")!({ target: {} });
  expect(ports.setOpen).toHaveBeenCalledWith(false);
  expect(ports.focus).toHaveBeenCalledTimes(1);
});
