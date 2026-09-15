import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Workbench } from "../../components/Workbench";
import { createWorkspaceTab } from "../tabs";
import { fixtureCollection } from "./fixtures";
import { currentWorkspace } from "./model";
import { NamedWorkspaceControls, WorkspaceMenu } from "./NamedWorkspaceControls";
import type { NamedWorkspaces } from "./useNamedWorkspaces";
import { WorkspaceNameForm } from "./WorkspaceNameForm";

vi.mock("../../components/TerminalViewport", () => ({ TerminalViewport: ({ launch }: { launch: { tabId: string; cwd: string } }) => (
  <div data-terminal-id={launch.tabId} data-terminal-cwd={launch.cwd} />
) }));
vi.mock("../../plugins/workspace/PluginWorkbenchActions", () => ({ PluginWorkbenchActions: () => null }));

const project = { id: "p", name: "项目", rootPath: "/demo", rootUri: "file:///demo" };
const tabs = ["a", "e"].map((id) => ({ ...createWorkspaceTab(project, "shell", 1), id, phase: "running" as const }));
function model(): NamedWorkspaces {
  const collection = fixtureCollection();
  return { collection, current: currentWorkspace(collection), activeTabId: "b", error: null, actionError: null,
    raw: null, notices: [], select: vi.fn(), create: vi.fn(), rename: vi.fn(), move: vi.fn(),
    setLayout: vi.fn(), setActiveTabId: vi.fn(), registerTab: vi.fn(), reload: vi.fn(), retrySave: vi.fn(), dismissNotices: vi.fn() };
}

it("工作区菜单显示归属、管理入口和存档异常，主界面只保留名称入口", () => {
  const state = model(); state.error = "存档版本不支持"; state.notices = ["1 条会话已不存在"];
  const props = { model: state, activeTab: tabs[0], onRepair: vi.fn(), persistenceError: "quota", onRetryPersistence: vi.fn() };
  const closed = renderToStaticMarkup(<NamedWorkspaceControls {...props} />);
  expect(closed).toContain("当前工作区：开发");
  for (const text of ["新建工作区", "移动当前会话", "管理当前会话", "存档版本不支持"]) expect(closed).not.toContain(text);
  const html = renderToStaticMarkup(<WorkspaceMenu {...props} onSelect={vi.fn()} />);
  for (const text of ["开发", "文档", "4 个会话", "新项目", "新建工作区", "移动当前会话",
    "工作区尚未保存", "存档版本不支持", "备份原存档", "1 条会话已不存在", "重试保存会话"]) expect(html).toContain(text);
  expect(html).not.toContain("选择目录并重新启动");
});

it("只有已停止本地会话显示目录修复入口，新建表单明确会创建空空间", () => {
  const html = renderToStaticMarkup(<WorkspaceMenu model={model()} activeTab={{ ...tabs[0], phase: "error" }}
    onRepair={vi.fn()} persistenceError={null} onRetryPersistence={vi.fn()} onSelect={vi.fn()} />);
  expect(html).toContain("选择目录并重新启动");
  expect(html).toContain("/demo");
  expect(renderToStaticMarkup(<WorkspaceNameForm initial="" mode="create" onSave={vi.fn()} onCancel={vi.fn()} />))
    .toContain("新建空工作区");
});

it("空工作区显示启动入口，同时继续渲染所有后台终端及原启动目录", () => {
  const html = renderToStaticMarkup(<Workbench activeProject={project} activeTabId={null}
    collapsed={false} collabOpen={false} collabWaiting={0} dividers={[]} drag={null}
    opening={false} previewOpen={false} pluginDockOpen={false} quickOpenOpen={false}
    recentProjects={[]} rects={new Map()} shortcutGuideOpen={false} shortcutPlatform="macos"
    split={false} stageRef={{ current: null }} tabs={tabs} onClosePane={vi.fn()} onDragStart={vi.fn()}
    onFocus={vi.fn()} onLaunchShell={vi.fn()} onOpenFile={vi.fn()} onOpenProject={vi.fn()}
    onOpenShortcutGuide={vi.fn()} onRegisterTarget={vi.fn()} onRequestRemove={vi.fn()} onResize={vi.fn()}
    onRevealSidebar={vi.fn()} onSnapshot={vi.fn()} onToggleCollab={vi.fn()} onTogglePreview={vi.fn()} onToggleQuickOpen={vi.fn()} />);
  expect(html).toContain("打开 Shell");
  expect(html).toContain('data-terminal-id="a"');
  expect(html).toContain('data-terminal-id="e"');
  expect((html.match(/data-terminal-cwd="file:\/\/\/demo"/g) ?? []).length).toBe(2);
});
