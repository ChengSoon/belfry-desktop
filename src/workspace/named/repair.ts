import { TranslationError } from "../../i18n";
import type { ProjectWorkspace, WorkspaceTab } from "../contracts";

export function canRepairProject(tab: WorkspaceTab | null) {
  return tab !== null && tab.kind !== "ssh" && (tab.phase === "error" || tab.phase === "exited");
}

export function repairTabProject(tab: WorkspaceTab, project: ProjectWorkspace): WorkspaceTab {
  if (!canRepairProject(tab)) throw new TranslationError("workspace.repair.text_ac4451e0ed");
  return { ...tab, project, projectLaunch: undefined, daemonSessionId: null, restoreSessionId: null, phase: "idle", activity: "idle", error: null, agentState: null };
}

interface RepairPorts {
  current: () => WorkspaceTab | null;
  open: (path: string) => Promise<ProjectWorkspace>;
  apply: (expected: WorkspaceTab, project: ProjectWorkspace) => void;
  beforeApply?: (tab: WorkspaceTab) => Promise<void>;
}

export async function requestProjectRepair(path: string | null, ports: RepairPorts) {
  if (path === null) return;
  if (!path.trim()) throw new TranslationError("workspace.repair.text_82d4a733ba");
  const before = editableTab(ports.current());
  const project = await ports.open(path.trim());
  const current = editableTab(ports.current());
  if (before.id !== current.id || before.project.rootUri !== current.project.rootUri) {
    throw new TranslationError("workspace.repair.text_6240aaf39f");
  }
  if (project.rootUri === current.project.rootUri) throw new TranslationError("workspace.repair.text_db24781bc7");
  await ports.beforeApply?.(current);
  const ready = editableTab(ports.current());
  if (ready.id !== current.id || ready.project.rootUri !== current.project.rootUri) throw new TranslationError("workspace.repair.text_6240aaf39f");
  ports.apply(ready, project);
}

function editableTab(tab: WorkspaceTab | null) {
  if (!tab) throw new TranslationError("workspace.repair.text_1600e8a69d");
  if (!canRepairProject(tab)) throw new TranslationError("workspace.repair.text_ac4451e0ed");
  return tab;
}
