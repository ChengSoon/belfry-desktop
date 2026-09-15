import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { WorkbenchProps } from "./Workbench";
import { WorkbenchMenuItems, WorkbenchToolbar } from "./WorkbenchToolbar";

vi.mock("../theme/ThemeProvider", () => ({ useTheme: () => ({ mode: "dark", toggle: vi.fn() }) }));
function props(): WorkbenchProps {
  return { activeProject: { id: "p", name: "很长的项目名称", rootPath: "/very/long/project/path", rootUri: "file:///very/long/project/path" },
    activeTabId: null, collapsed: false, collabOpen: false, collabWaiting: 2, dividers: [], drag: null,
    opening: false, previewOpen: false, pluginDockOpen: false, quickOpenOpen: false, recentProjects: [], rects: new Map(),
    shortcutGuideOpen: false, shortcutPlatform: "macos", split: false, stageRef: { current: null }, tabs: [],
    onClosePane: vi.fn(), onDragStart: vi.fn(), onFocus: vi.fn(), onLaunchShell: vi.fn(), onOpenFile: vi.fn(),
    onOpenProject: vi.fn(), onOpenShortcutGuide: vi.fn(), onRegisterTarget: vi.fn(), onRequestRemove: vi.fn(),
    onResize: vi.fn(), onRevealSidebar: vi.fn(), onSnapshot: vi.fn(), onToggleCollab: vi.fn(), onTogglePreview: vi.fn(), onToggleQuickOpen: vi.fn() };
}

it("常态保留项目、搜索、文件和更多入口，协作提醒在收起时仍可见", () => {
  const html = renderToStaticMarkup(<WorkbenchToolbar {...props()} />);
  expect((html.match(/<button/g) ?? []).length).toBe(4);
  for (const label of ["很长的项目名称", "Quick Open", "文件预览", "更多工具，2 条协作待确认"]) expect(html).toContain(label);
  for (const label of ["插件启动器", "快捷指令", "切换到亮色主题"]) expect(html).not.toContain(label);
});

it("更多面板保留原工具和主题入口，窄舞台仍有搜索与文件入口", () => {
  const html = renderToStaticMarkup(<WorkbenchMenuItems {...props()} onSelect={vi.fn()} />);
  for (const label of ["会话协作", "2 条待确认", "插件启动器", "插件工作面板", "快捷指令", "切换到亮色主题", "Quick Open", "文件与 Git 改动"]) {
    expect(html).toContain(label);
  }
});
