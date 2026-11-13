import { isAgentKind } from "../../agent/contracts";
import { useState } from "react";
import type { ProjectWorkspace, WorkspaceTab } from "../../workspace/contracts";
import { pathKey } from "../../workspace/path";
import { WorktreeDialog } from "./WorktreeDialog";

export function useWorktreeReminder({ project, tabs, onOpen }: {
  project: ProjectWorkspace | null; tabs: WorkspaceTab[]; onOpen: (path: string) => Promise<void>;
}) {
  const [manager, setManager] = useState(false);
  const count = project ? tabs.filter((tab) => (isAgentKind(tab.kind))
    && tab.phase !== "exited" && tab.phase !== "error" && pathKey(tab.project.rootPath) === pathKey(project.rootPath)).length : 0;
  return { count, openManager: () => setManager(true),
    dialog: manager && project ? <WorktreeDialog rootPath={project.rootPath} onClose={() => setManager(false)} onOpen={onOpen} /> : null };
}
