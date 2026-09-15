import { expect, it } from "vitest";
import { applyBindingChange } from "./bindings";
import { saveBindingDraft, saveDefaultBindings } from "./changes";
import { emptyShortcutSettings, loadShortcutSettings, saveShortcutSettings } from "./storage";

const context = { platform: "macos" as const, plugins: [] };
const draft = { action: "new-shell" as const, binding: { code: "KeyY", shift: false }, original: undefined };
function disk() {
  let data: string | null = null;
  return { getItem: () => data, setItem: (_key: string, value: string) => { data = value; } };
}

it("保存当前草稿时合并其他窗口的不同动作和另一平台设置", () => {
  const storage = disk(), settings = emptyShortcutSettings();
  settings.macos["toggle-sidebar"] = null;
  settings.control["new-shell"] = null;
  saveShortcutSettings(settings, storage);
  saveBindingDraft(draft, context, storage);
  expect(loadShortcutSettings(storage).settings).toEqual({ ...settings, macos: { ...settings.macos, "new-shell": draft.binding } });
});

it("同一动作在其他窗口修改后拒绝覆盖旧草稿", () => {
  const storage = disk(), settings = emptyShortcutSettings();
  settings.macos["new-shell"] = null;
  saveShortcutSettings(settings, storage);
  expect(() => saveBindingDraft(draft, context, storage)).toThrow("已在其他窗口修改");
  expect(loadShortcutSettings(storage).settings).toEqual(settings);
});

it("保存时重查新出现的宿主和插件冲突", () => {
  const storage = disk(), settings = emptyShortcutSettings();
  settings.macos["toggle-sidebar"] = draft.binding;
  saveShortcutSettings(settings, storage);
  expect(() => saveBindingDraft(draft, context, storage)).toThrow("显示 / 隐藏侧栏");
  expect(() => saveBindingDraft(draft, { ...context, plugins: [{ binding: "Mod+Y", label: "工具插件" }] }, disk())).toThrow("工具插件");
});

it("先释放占用键，再恢复单项默认，恢复后保留其他设置", () => {
  const settings = emptyShortcutSettings();
  settings.macos = { "new-shell": null, "toggle-sidebar": { code: "KeyT", shift: false } };
  expect(() => applyBindingChange(settings, { ...context, action: "new-shell", binding: undefined })).toThrow("显示 / 隐藏侧栏");
  const released = applyBindingChange(settings, { ...context, action: "toggle-sidebar", binding: undefined });
  expect(applyBindingChange(released, { ...context, action: "new-shell", binding: undefined }).macos).toEqual({});
});

it("整体恢复仅修改当前平台，预览后有新改动则拒绝覆盖", () => {
  const storage = disk(), settings = emptyShortcutSettings();
  settings.macos["toggle-sidebar"] = null; settings.control["new-shell"] = null;
  saveShortcutSettings(settings, storage);
  expect(() => saveDefaultBindings({}, context, storage)).toThrow("预览后已发生变化");
  saveDefaultBindings(settings.macos, context, storage);
  expect(loadShortcutSettings(storage).settings).toEqual({ ...settings, macos: {} });
});

it("整体恢复前显示被插件占用的默认键位，失败保留原配置", () => {
  const storage = disk(), settings = emptyShortcutSettings(); settings.macos["new-shell"] = null;
  saveShortcutSettings(settings, storage);
  expect(() => saveDefaultBindings(settings.macos, { ...context, plugins: [{ binding: "Mod+T", label: "快捷启动" }] }, storage)).toThrow("快捷启动");
  expect(loadShortcutSettings(storage).settings).toEqual(settings);
});
