import { expect, it } from "vitest";
import { resolveAppShortcut } from "../resolveShortcut";
import { bindingIssues, effectiveBindings, recordBinding } from "./bindings";
import type { KeyInput, ShortcutOverrides } from "./contracts";

const mac: KeyInput = { code: "KeyY", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false };

it("覆盖旧键位并释放原组合键，停用后也不会留下旧快捷键", () => {
  const overrides: ShortcutOverrides = { "toggle-sidebar": { code: "KeyY", shift: false }, "new-shell": null };
  expect(resolveAppShortcut(mac, "macos", overrides)).toEqual({ kind: "toggle-sidebar" });
  expect(resolveAppShortcut({ ...mac, code: "KeyB" }, "macos", overrides)).toBeNull();
  expect(resolveAppShortcut({ ...mac, code: "KeyT" }, "macos", overrides)).toBeNull();
});

it("重复映射可见且不随机触发其中某一个动作", () => {
  const overrides: ShortcutOverrides = { "toggle-sidebar": { code: "KeyT", shift: false } };
  expect(bindingIssues({ action: "toggle-sidebar", binding: overrides["toggle-sidebar"], platform: "macos", overrides })[0]).toContain("新建 Shell");
  expect(resolveAppShortcut({ ...mac, code: "KeyT" }, "macos", overrides)).toBeNull();
});

it("默认 / 与 ? 都打开速查，显式停用后两者都释放", () => {
  const guide = effectiveBindings("macos", {}).find((item) => item.action.id === "toggle-shortcuts");
  expect(guide?.bindings).toEqual([{ code: "Slash", shift: false }, { code: "Slash", shift: true }]);
  const overrides: ShortcutOverrides = { "toggle-shortcuts": null };
  expect(resolveAppShortcut({ ...mac, code: "Slash", shiftKey: true }, "macos", overrides)).toBeNull();
  expect(bindingIssues({ action: "new-shell", binding: { code: "Slash", shift: true }, platform: "macos", overrides: {} })[0]).toContain("快捷指令");
});

it("Mac 与 Windows 的宿主修饰键独立，CLI 原生 Ctrl 不被记录", () => {
  expect(recordBinding(mac, "macos").binding).toEqual({ code: "KeyY", shift: false });
  const control = { ...mac, metaKey: false, ctrlKey: true };
  expect(recordBinding(control, "control").error).toContain("Ctrl+Shift");
  expect(recordBinding({ ...control, shiftKey: true }, "control").binding).toEqual({ code: "KeyY", shift: true });
});

it("IME、重复事件、修饰键本身与 AltGr 不录入快捷键", () => {
  for (const event of [{ ...mac, isComposing: true }, { ...mac, keyCode: 229 }, { ...mac, key: "Process" },
    { ...mac, repeat: true }, { ...mac, code: "MetaLeft" }]) {
    expect(recordBinding(event, "macos")).toEqual({ binding: null, error: null });
    expect(resolveAppShortcut(event.code === "MetaLeft" ? event : { ...event, code: "KeyB" }, "macos")).toBeNull();
  }
  expect(recordBinding({ ...mac, altKey: true, ctrlKey: true }, "macos").error).toBeTruthy();
});

it("终端编辑、系统退出和刷新组合键不能绑定为宿主动作", () => {
  for (const code of ["KeyC", "KeyV", "KeyX", "KeyZ", "KeyF", "KeyQ", "KeyW", "KeyR", "KeyM"]) {
    expect(bindingIssues({ action: "new-shell", binding: { code, shift: false }, platform: "macos", overrides: {} }).length).toBeGreaterThan(0);
  }
  expect(bindingIssues({ action: "new-shell", binding: { code: "Digit4", shift: true }, platform: "macos", overrides: {} })[0]).toContain("系统");
});

it("插件的 Mod / Command 别名与宿主记录的物理键一起检查冲突", () => {
  const plugins = [{ label: "Prompt 收藏", binding: "Mod+Shift+Y" }];
  expect(bindingIssues({ action: "new-shell", binding: { code: "KeyY", shift: true }, platform: "macos", overrides: {}, plugins })[0]).toContain("Prompt 收藏");
});
