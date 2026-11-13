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

it("按稿保留分屏、文件和更多三个工具入口，待确认提示并入更多", () => {
  const html = renderToStaticMarkup(<WorkbenchToolbar {...props()} />);
  expect((html.match(/<button/g) ?? []).length).toBe(4);
  for (const label of ["很长的项目名称", "分屏", "文件预览", "更多工具，2 条协作待确认"]) expect(html).toContain(label);
  for (const label of ["Quick Open", "workbench-collab", "切换到亮色主题", "插件启动器", "快捷指令"]) expect(html).not.toContain(label);
});

it("更多面板在所有尺寸下保留原工具、主题、搜索与文件入口", () => {
  const html = renderToStaticMarkup(<WorkbenchMenuItems {...props()} onSelect={vi.fn()} />);
  for (const label of ["会话协作", "2 条待确认", "插件启动器", "插件工作面板", "快捷指令", "切换到亮色主题", "Quick Open", "文件与 Git 改动"]) {
    expect(html).toContain(label);
  }
});

it("顶栏标签只列与当前会话同项目的会话，点击走同一个切换入口", () => {
  const project = props().activeProject!;
  const other = { ...project, id: "q", name: "另一个项目", rootPath: "/other", rootUri: "file:///other" };
  const tab = (id: string, title: string, owner = project) => ({ id, title, project: owner, kind: "shell", phase: "running", activity: "idle",
    agentName: null, customTitle: null, titleHint: null, profileId: "shell:default", collaborationMode: false, sshTarget: null, resumeSessionId: null, error: null });
  const tabs = [tab("a", "Alpha"), tab("b", "Beta"), tab("c", "Gamma", other)] as unknown as WorkbenchProps["tabs"];
  const html = renderToStaticMarkup(<WorkbenchToolbar {...props()} tabs={tabs} activeTabId="a" onActivateTab={vi.fn()} />);
  expect(html).toContain("Alpha");
  expect(html).toContain("Beta");
  expect(html).not.toContain("Gamma");
  expect(html).toContain('role="group" aria-label="同项目会话"');
  expect(html).toMatch(/aria-current="page"[^>]*title="Alpha"/);
  expect(html).not.toContain('role="tab');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
});
