import { GitBranch } from "lucide-react";
import { useState } from "react";
import type { ProjectWorkspace, WorkspaceTab } from "../../workspace/contracts";
import { pathKey } from "../../workspace/path";
import { useFlyout } from "../../components/useFlyout";
import { WorktreeDialog } from "./WorktreeDialog";

export function WorktreeReminder({ project, tabs, onOpen }: {
  project: ProjectWorkspace | null; tabs: WorkspaceTab[]; onOpen: (path: string) => Promise<void>;
}) {
  const flyout = useFlyout();
  const [manager, setManager] = useState(false);
  const count = project ? tabs.filter((tab) => (tab.kind === "codex" || tab.kind === "claude")
    && tab.phase !== "exited" && tab.phase !== "error" && pathKey(tab.project.rootPath) === pathKey(project.rootPath)).length : 0;
  if (!project || count < 2) return null;
  return <div className="worktree-reminder" ref={flyout.root}>
    <button type="button" className="icon-button icon-button--sm" ref={flyout.trigger} aria-label={`${count} 条 Agent 会话共用目录，查看隔离提醒`}
      title="多条 Agent 会话共用目录" aria-expanded={flyout.open} onClick={flyout.toggle}><GitBranch size={15} /><small>{count}</small></button>
    {flyout.open ? <div className="worktree-reminder__popover" role="dialog" aria-label="并行任务目录提醒">
      <p>{count} 条 Agent 会话正在共用这个目录，文件改动会相互可见。</p>
      <button type="button" data-flyout-focus onClick={() => { flyout.trigger.current?.focus(); flyout.close(); setManager(true); }}>使用独立任务目录</button>
    </div> : null}
    {manager ? <WorktreeDialog rootPath={project.rootPath} onClose={() => setManager(false)} onOpen={onOpen} /> : null}
  </div>;
}
