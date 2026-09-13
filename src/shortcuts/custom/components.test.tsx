import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { guideSections } from "../catalog";
import { ShortcutRows } from "./ShortcutSettingsSection";
import { ShortcutEditor } from "./ShortcutEditor";
import { ShortcutResetPreview } from "./ShortcutResetPreview";
import { emptyShortcutSettings } from "./storage";

const context = { platform: "macos" as const, plugins: [] };
const editor = { edit: null, error: null, message: null, begin: vi.fn(), change: vi.fn(), cancel: vi.fn(), save: vi.fn() };
afterEach(() => vi.unstubAllGlobals());

it("每个会话动作单独展示，停用和自定义的状态清楚可见", () => {
  const html = renderToStaticMarkup(<ShortcutRows context={context} editor={editor}
    overrides={{ "new-shell": null, "activate-session-2": { code: "KeyY", shift: true } }} />);
  for (const text of ["已停用", "未分配", "自定义", "⌘+Shift+Y", "切换第 1 个会话", "切换第 9 个会话"]) expect(html).toContain(text);
  expect((html.match(/shortcut-edit-activate-session/g) ?? []).length).toBe(9);
});

it("录制区域显示冲突并禁用保存，同时保留取消和恢复入口", () => {
  const html = renderToStaticMarkup(<ShortcutEditor context={context} overrides={{}} error={null}
    draft={{ action: "toggle-sidebar", binding: { code: "KeyT", shift: false }, original: undefined }}
    onChange={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()} />);
  expect(html).toContain("新建 Shell 会话");
  expect(html).toContain('data-shortcut-recorder="true"');
  expect(html).toContain('disabled="">保存');
  for (const text of ["恢复此项默认", "停用", "取消", "Esc", "Tab", "保存后"]) expect(html).toContain(text);
});

it("整体恢复先展示具体变化，被插件占用的默认键位阻止确认", () => {
  const html = renderToStaticMarkup(<ShortcutResetPreview context={{ ...context, plugins: [{ label: "任务插件", binding: "Command+T" }] }}
    expected={{ "new-shell": null }} error={null} onCancel={vi.fn()} onSave={vi.fn()} />);
  for (const text of ["恢复 1 项", "未分配", "⌘+T", "任务插件"]) expect(html).toContain(text);
  expect(html).toContain('disabled="">确认恢复默认');
});

it("速查面板为第 1–9 个会话显示各自保存的键位", () => {
  const settings = emptyShortcutSettings();
  settings.macos["activate-session-3"] = { code: "KeyY", shift: true };
  settings.macos["new-shell"] = null;
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(settings) });
  const items = guideSections("belfry", "macos").flatMap((section) => section.items);
  expect(items.find((item) => item.label === "切换第 3 个会话")?.keys).toEqual(["⌘", "Shift", "Y"]);
  expect(items.find((item) => item.label === "新建 Shell 会话")?.keys).toEqual(["未分配"]);
  expect(items.filter((item) => item.label.startsWith("切换第 "))).toHaveLength(9);
  expect(items.some((item) => item.keys?.includes("1…9"))).toBe(false);
});
