import { formatNumber } from "../../i18n";
import { t, useTranslation } from "../../i18n";
import { isAgentKind } from "../../agent/contracts";
import { GitBranch } from "lucide-react";
import { useState } from "react";
import type { ProjectWorkspace, WorkspaceTab } from "../../workspace/contracts";
import { pathKey } from "../../workspace/path";
import { useFlyout } from "../../components/useFlyout";
import { WorktreeDialog } from "./WorktreeDialog";

export function WorktreeReminder({ project, tabs, onOpen }: {
  project: ProjectWorkspace | null; tabs: WorkspaceTab[]; onOpen: (path: string) => Promise<void>;
}) {
  useTranslation();
  const flyout = useFlyout();
  const [manager, setManager] = useState(false);
  const count = project ? tabs.filter((tab) => (isAgentKind(tab.kind))
    && tab.phase !== "exited" && tab.phase !== "error" && pathKey(tab.project.rootPath) === pathKey(project.rootPath)).length : 0;
  if (!project || count < 2) return null;
  return <div className="worktree-reminder" ref={flyout.root}>
    <button type="button" className="icon-button icon-button--sm" ref={flyout.trigger} aria-label={t("git.WorktreeReminder.text_f324d6b965", { count: count })}
      title={t("git.WorktreeReminder.text_d6542e3d05")} aria-expanded={flyout.open} onClick={flyout.toggle}><GitBranch size={15} /><small>{formatNumber(count)}</small></button>
    {flyout.open ? <div className="worktree-reminder__popover" role="dialog" aria-label={t("git.WorktreeReminder.text_7d27b56c95")}>
      <p>{t("git.WorktreeReminder.text_3d68d81b46", { count: count })}</p>
      <button type="button" data-flyout-focus onClick={() => { flyout.trigger.current?.focus(); flyout.close(); setManager(true); }}>{t("git.WorktreeReminder.text_31d678da77")}</button>
    </div> : null}
    {manager ? <WorktreeDialog rootPath={project.rootPath} onClose={() => setManager(false)} onOpen={onOpen} /> : null}
  </div>;
}
