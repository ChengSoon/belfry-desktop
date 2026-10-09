import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsNavigation, SettingsPanel } from "./SettingsPanel";
import { ProviderSection } from "../provider/components/ProviderSection";
import type { UpdaterState } from "../updater/contracts";

// Node-only component harness: exercise production callbacks/effects without native IPC.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[] }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[index], (value: T) => { hooks.slots[index] = value; }];
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        previous?.cleanup?.();
        hooks.slots[index] = { deps, cleanup: effect() };
      }
    },
  };
});

type Props = { children?: ReactNode; className?: string; title?: string; disabled?: boolean; onGuardChange?: (value: boolean) => void };
function find(node: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Props>(child)) continue;
    if (predicate(child)) return child;
    const match = find(child.props.children, predicate);
    if (match) return match;
  }
}
const close = vi.fn();
const keydown = new Set<(event: { key: string; defaultPrevented: boolean }) => void>();
let tree: ReactNode;
function render() {
  hooks.cursor = 0;
  tree = SettingsPanel({ initialSection: "provider", onClose: close, updaterOpen: false,
    updaterState: {} as UpdaterState, onOpenUpdater: () => {} });
}
function navigation() {
  return find(tree, (element) => element.type === SettingsNavigation)! as ReactElement<Parameters<typeof SettingsNavigation>[0]>;
}
function provider() { return find(tree, (element) => element.type === ProviderSection)!; }
function escape(prevented = false) { keydown.forEach((callback) => callback({ key: "Escape", defaultPrevented: prevented })); }
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; keydown.clear(); close.mockClear();
  vi.stubGlobal("document", {
    addEventListener: (_: string, callback: (event: { key: string; defaultPrevented: boolean }) => void) => keydown.add(callback),
    removeEventListener: (_: string, callback: (event: { key: string; defaultPrevented: boolean }) => void) => keydown.delete(callback),
  });
  render();
});
afterEach(() => vi.unstubAllGlobals());

it("search leaves the deep-linked editor in the same reconciliation slot, even with no results", () => {
  const before = provider();
  const contentBefore = find(tree, (element) => element.props.className === "settings-content")!;
  navigation().props.onQuery("no-such-section"); render();
  expect(navigation().props.query).toBe("no-such-section");
  expect(navigation().props.active).toBe("provider");
  const after = provider();
  expect(after.type).toBe(before.type);
  expect(after.key).toBe(before.key);
  const contentAfter = find(tree, (element) => element.props.className === "settings-content")!;
  expect(Children.toArray(contentAfter.props.children).map((child) => isValidElement(child) ? child.type : null))
    .toEqual(Children.toArray(contentBefore.props.children).map((child) => isValidElement(child) ? child.type : null));
});

it("an editing guard survives search and blocks section switching, close and Escape until released", () => {
  provider().props.onGuardChange!(true); render();
  navigation().props.onQuery("外观"); render();
  expect(navigation().props.guarded).toBe(true);
  expect(find(tree, (element) => element.props.title === "关闭设置")!.props.disabled).toBe(true);
  navigation().props.onSelect("appearance"); render();
  expect(provider()).toBeDefined();
  escape(); expect(close).not.toHaveBeenCalled();
  provider().props.onGuardChange!(false); render();
  expect(find(tree, (element) => element.props.title === "关闭设置")!.props.disabled).toBe(false);
  escape(true); expect(close).not.toHaveBeenCalled();
  escape(); expect(close).toHaveBeenCalledTimes(1);
  navigation().props.onSelect("appearance"); render();
  expect(provider()).toBeUndefined();
  expect(navigation().props.active).toBe("appearance");
});
