import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ExitConfirmation } from "./ExitConfirmation";

function fixture(busy = false, error: string | null = null) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const props = { dialogRef: { current: null }, busy, error, onConfirm, onCancel };
  return { onConfirm, onCancel, tree: ExitConfirmation(props), html: renderToStaticMarkup(<ExitConfirmation {...props} />) };
}

function buttons(node: ReactNode): Array<{ children?: ReactNode; disabled?: boolean; onClick?: () => void; "aria-label"?: string }> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void; "aria-label"?: string }>(child)) return [];
    return child.type === "button" ? [child.props] : buttons(child.props.children);
  });
}

it("only offers confirm and cancel, with background retention explained", () => {
  const test = fixture();
  expect(test.html).toContain("确认退出");
  expect(test.html).toContain("取消");
  expect(test.html).toContain("下次打开会自动恢复会话");
  expect(test.html).not.toContain("结束任务");
  expect(test.html).not.toContain("保留任务并退出");
  buttons(test.tree).find((button) => button.children === "确认退出")!.onClick!();
  expect(test.onConfirm).toHaveBeenCalledOnce();
  expect(test.onCancel).not.toHaveBeenCalled();
});

it("cancel button and close icon both cancel instead of terminating", () => {
  const test = fixture();
  buttons(test.tree).find((button) => button.children === "取消")!.onClick!();
  buttons(test.tree).find((button) => button["aria-label"] === "取消退出")!.onClick!();
  expect(test.onCancel).toHaveBeenCalledTimes(2);
  expect(test.onConfirm).not.toHaveBeenCalled();
});

it("disables all actions during exit and keeps errors actionable", () => {
  const test = fixture(true, "无法退出，请重试");
  expect(buttons(test.tree).every((button) => button.disabled)).toBe(true);
  expect(test.html).toContain('role="alert"');
  expect(test.html).toContain("无法退出，请重试");
});
