import { afterEach, expect, it, vi } from "vitest";
import { shortcutConflict, shortcutMatches } from "../../plugins/center/shortcuts";
import { bindingIssues } from "./bindings";
import { emptyShortcutSettings } from "./storage";

afterEach(() => vi.unstubAllGlobals());

it("插件不能占用宿主重绑定后的标点键，包括修饰键别名", () => {
  const settings = emptyShortcutSettings();
  settings.macos["new-shell"] = { code: "Period", shift: false };
  settings.control["toggle-sidebar"] = { code: "BracketLeft", shift: true };
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(settings) });
  expect(shortcutConflict(["Command+."], true)).toBe(true);
  expect(shortcutConflict(["Ctrl+Shift+["], false)).toBe(true);
  expect(shortcutConflict(["Command+T"], true)).toBe(false);
});

it("问号别名与物理 Shift+/ 的重复冲突一致", () => {
  const plugins = [{ label: "搜索插件", binding: "Mod+?" }];
  expect(bindingIssues({ action: "toggle-shortcuts", binding: undefined, platform: "macos", overrides: {}, plugins })[0]).toContain("搜索插件");
  expect(shortcutMatches("Command+?", { key: "?", code: "Slash", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true }, true)).toBe(true);
  expect(shortcutConflict(["Mod+?", "Command+Shift+/"], true)).toBe(true);
});

it("旧插件录制的 Shift 标点键继续匹配物理键，不被新解析方式废弃", () => {
  const keys = { Period: ">", Comma: "<", Semicolon: ":", Quote: '"', BracketLeft: "{", BracketRight: "}", Backslash: "|", Minus: "_", Backquote: "~" };
  for (const [code, key] of Object.entries(keys)) {
    const binding = `Mod+Shift+${key}`;
    expect(shortcutMatches(binding, { key, code, ctrlKey: false, metaKey: true, altKey: false, shiftKey: true }, true)).toBe(true);
    expect(bindingIssues({ action: "new-shell", binding: { code, shift: true }, platform: "macos", overrides: {}, plugins: [{ binding, label: "原有插件" }] })[0]).toContain("原有插件");
  }
});

it("插件设置也识别始终被宿主保护的刷新组合键", () => {
  expect(shortcutConflict(["Command+Shift+R"], true)).toBe(true);
  expect(shortcutConflict(["Ctrl+Shift+R"], false)).toBe(true);
});
