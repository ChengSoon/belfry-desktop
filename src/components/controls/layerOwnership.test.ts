import { expect, it } from "vitest";
import { isTopLayer, ownsTarget, registerLayer, shouldDismissOnBlur } from "./layerOwnership";

function node(children: HTMLElement[] = []): HTMLElement {
  const element = { contains: (target: Node) => target === element || children.some((child) => child.contains(target)) };
  return element as HTMLElement;
}

it("嵌套 Portal 属于外层浮窗，兄弟窗口与外部不属于", () => {
  const button = node(), option = node(), panel = node([option]), root = node([button]), outside = node();
  const cleanup = registerLayer({ anchor: button, panel });
  expect(ownsTarget(root, option)).toBe(true);
  expect(ownsTarget(root, outside)).toBe(false);
  expect(ownsTarget(null, option)).toBe(false);
  cleanup(); expect(ownsTarget(root, option)).toBe(false);
});

it("仅顶层消费 Esc，移除后恢复父层身份", () => {
  const anchor = node(), nestedAnchor = node(), first = node([nestedAnchor]), second = node();
  const removeFirst = registerLayer({ anchor, panel: first });
  const removeSecond = registerLayer({ anchor: nestedAnchor, panel: second });
  expect(ownsTarget(anchor, second)).toBe(true);
  expect(isTopLayer(first)).toBe(false);
  expect(isTopLayer(second)).toBe(true);
  removeSecond(); expect(isTopLayer(first)).toBe(true);
  removeFirst(); expect(isTopLayer(first)).toBe(false);
});

it("子层先挂载时，随后挂载的父对话框不会抢走顶层身份", () => {
  const trigger = node(), popup = node(), dialog = node([trigger]);
  const removePopup = registerLayer({ anchor: trigger, panel: popup });
  const removeDialog = registerLayer({ anchor: node(), panel: dialog });
  expect(isTopLayer(popup)).toBe(true);
  expect(isTopLayer(dialog)).toBe(false);
  removePopup(); expect(isTopLayer(dialog)).toBe(true);
  removeDialog();
});

it("WebKit 点击内部按钮产生空焦点时不提前关闭，外部字段仍可关闭", () => {
  const button = node(), panel = node([button]), root = node(), outside = node();
  const cleanup = registerLayer({ anchor: root, panel });
  expect(shouldDismissOnBlur(root, null)).toBe(false);
  expect(shouldDismissOnBlur(root, button)).toBe(false);
  expect(shouldDismissOnBlur(root, outside)).toBe(true);
  cleanup();
});
