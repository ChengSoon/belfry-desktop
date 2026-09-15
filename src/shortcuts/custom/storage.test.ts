import { afterEach, expect, it, vi } from "vitest";
import { appShortcutChord, resolveAppShortcut } from "../resolveShortcut";
import { emptyShortcutSettings, loadShortcutSettings, saveShortcutSettings, SHORTCUTS_KEY, subscribeShortcutSettings } from "./storage";

afterEach(() => vi.unstubAllGlobals());
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

it("保存后重新读取保留两个平台的独立键位和停用状态", () => {
  const disk = storage();
  const settings = emptyShortcutSettings();
  settings.macos["new-shell"] = { code: "KeyY", shift: true };
  settings.control["new-shell"] = null;
  saveShortcutSettings(settings, disk);
  expect(loadShortcutSettings(disk)).toEqual({ settings, warning: null });
});

it("损坏或未来版本的存档明确提示并退回默认", () => {
  const disk = storage();
  for (const text of ["not-json", '{"version":99}', '[]']) {
    disk.setItem(SHORTCUTS_KEY, text);
    const loaded = loadShortcutSettings(disk);
    expect(loaded.settings).toEqual(emptyShortcutSettings());
    expect(loaded.warning).toBeTruthy();
  }
});

it("非法存档不能抢占原生 Ctrl 或粘贴快捷键", () => {
  const disk = storage();
  disk.setItem(SHORTCUTS_KEY, JSON.stringify({ version: 1, macos: { "new-shell": { code: "KeyV", shift: false } },
    control: { "toggle-sidebar": { code: "KeyB", shift: false } } }));
  const loaded = loadShortcutSettings(disk);
  expect(loaded.settings.macos["new-shell"]).toBeNull();
  expect(loaded.settings.control["toggle-sidebar"]).toBeNull();
  expect(loaded.warning).toBeTruthy();
});

it("写入失败向界面抛出错误，不伪装为已保存", () => {
  expect(() => saveShortcutSettings(emptyShortcutSettings(), { setItem: () => { throw new Error("storage full"); } })).toThrow("storage full");
});

it("宿主事件和现有按钮标签读取同一份当前键位", () => {
  const disk = storage(); vi.stubGlobal("localStorage", disk);
  const settings = emptyShortcutSettings(); settings.macos["new-shell"] = { code: "KeyY", shift: true };
  saveShortcutSettings(settings, disk);
  expect(appShortcutChord("macos", "T")).toEqual(["⌘", "Shift", "Y"]);
  expect(resolveAppShortcut({ code: "KeyY", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, repeat: false, isComposing: false }, "macos"))
    .toEqual({ kind: "new-shell" });
});

it("同窗口保存、其他窗口修改及清空存档都会通知订阅者", () => {
  const host = new EventTarget(); vi.stubGlobal("window", host);
  const notify = vi.fn(), unsubscribe = subscribeShortcutSettings(notify);
  saveShortcutSettings(emptyShortcutSettings(), storage());
  const changed = (key: string | null) => host.dispatchEvent(Object.assign(new Event("storage"), { key }));
  changed("unrelated"); expect(notify).toHaveBeenCalledTimes(1);
  changed(SHORTCUTS_KEY); changed(null); expect(notify).toHaveBeenCalledTimes(3);
  unsubscribe(); changed(SHORTCUTS_KEY); expect(notify).toHaveBeenCalledTimes(3);
});

it("整个平台损坏时准确提示退回默认，不声称停用整个平台", () => {
  const disk = storage(); disk.setItem(SHORTCUTS_KEY, '{"version":1,"macos":false}');
  const loaded = loadShortcutSettings(disk);
  expect(loaded.settings.macos).toEqual({});
  expect(loaded.warning).toContain("无法读取的平台使用默认值");
});
