import { AlertTriangle, PanelLeftOpen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { WindowTitlebar } from "./components/WindowTitlebar";
import "./workspace/workspace.css";
import { TerminalStage } from "./layout/components/TerminalStage";
import { useSessionDrag } from "./layout/useSessionDrag";
import { useSplitLayout } from "./layout/useSplitLayout";
import { ICON } from "./theme/sizing";
import { UsagePanel } from "./usage/components/UsagePanel";
import { ProjectSwitcher } from "./workspace/components/ProjectSwitcher";
import { Sidebar } from "./workspace/components/Sidebar";
import { failureLabel } from "./workspace/errors";
import { useFoldedProjects } from "./workspace/useFoldedProjects";
import { useProjectWorkspace } from "./workspace/useProjectWorkspace";

export default function App() {
  const workspace = useProjectWorkspace();
  const { foldedProjects, toggleFold, unfold } = useFoldedProjects();
  const [collapsed, setCollapsed] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const layout = useSplitLayout(workspace.tabs, workspace.activeTabId, workspace.setActiveTabId);
  const { drag, startDrag, consumedClick } = useSessionDrag(stageRef, sidebarRef, layout.panes, {
    onDrop: layout.dropTab,
    onEject: layout.closePane,
    // 只有分屏里的会话摘得动：没分屏时舞台始终跟着活动会话，摘掉也没地方去。
    canEject: (tabId) => layout.panes.length > 1 && layout.rects.has(tabId),
  });

  // 新会话继承 activeProject，那组要是折叠着就会开出一个侧栏里看不见的会话。
  const launch = useCallback((kind: Parameters<typeof workspace.launch>[0]) => {
    if (workspace.activeProject) unfold(workspace.activeProject.id);
    void workspace.launch(kind);
  }, [unfold, workspace.activeProject, workspace.launch]);

  // ⌘B / ⌘U 走捕获阶段，避免按键先被 xterm 吞进 shell。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "b" && key !== "u") return;
      event.preventDefault();
      event.stopPropagation();
      if (key === "b") setCollapsed((value) => !value);
      else setUsageOpen((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <main
      className={`app-shell${collapsed ? " is-collapsed" : ""}${usageOpen ? " has-usage" : ""}`}
    >
      <WindowTitlebar />

      {collapsed ? null : (
        <Sidebar
          activeId={workspace.activeTabId}
          agents={workspace.agents}
          draggingId={drag?.tabId ?? null}
          ejecting={drag?.target?.kind === "sidebar"}
          foldedProjects={foldedProjects}
          onActivate={layout.activateTab}
          onClose={workspace.closeTab}
          onCollapse={() => setCollapsed(true)}
          onConsumeClick={consumedClick}
          onDragStart={startDrag}
          onLaunch={launch}
          onRefresh={workspace.redetectAgents}
          onToggleFold={toggleFold}
          onToggleUsage={() => setUsageOpen((value) => !value)}
          ref={sidebarRef}
          tabs={workspace.tabs}
          usageOpen={usageOpen}
        />
      )}

      <section className="workbench">
        {collapsed ? (
          <button
            className="icon-button icon-button--sm reveal-handle"
            onClick={() => setCollapsed(false)}
            title="展开侧栏 ⌘B"
            type="button"
          >
            <PanelLeftOpen aria-hidden="true" size={ICON.md} />
          </button>
        ) : null}
        <div className="stage-caption">
          <ProjectSwitcher
            onOpen={workspace.selectProject}
            opening={workspace.opening}
            project={workspace.activeProject}
            recentProjects={workspace.recentProjects}
          />
        </div>
        <TerminalStage
          activeTabId={workspace.activeTabId}
          dividers={layout.dividers}
          drag={drag}
          onClosePane={layout.closePane}
          onDragStart={startDrag}
          onFocus={workspace.setActiveTabId}
          onResize={layout.resizeSplit}
          onSnapshot={workspace.updateTab}
          rects={layout.rects}
          split={layout.split}
          stageRef={stageRef}
          tabs={workspace.tabs}
        />
        {workspace.tabs.length === 0 ? <EmptyStage onLaunch={() => launch("shell")} /> : null}
      </section>

      {usageOpen ? (
        <UsagePanel onClose={() => setUsageOpen(false)} project={workspace.activeProject} />
      ) : null}

      {workspace.failure ? (
        <div className="failure-toast" role="alert">
          <AlertTriangle aria-hidden="true" size={ICON.lg} />
          <p>{failureLabel(workspace.failure)}</p>
          <button onClick={workspace.dismissFailure} title="关闭错误提示" type="button">
            <X size={ICON.sm} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

function EmptyStage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="empty-stage">
      <button onClick={onLaunch} type="button">打开 Shell</button>
    </div>
  );
}
