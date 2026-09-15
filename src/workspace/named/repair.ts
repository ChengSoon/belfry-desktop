import type { ProjectWorkspace, WorkspaceTab } from "../contracts";

export function canRepairProject(tab: WorkspaceTab | null) {
  return tab !== null && tab.kind !== "ssh" && (tab.phase === "error" || tab.phase === "exited");
}

export function repairTabProject(tab: WorkspaceTab, project: ProjectWorkspace): WorkspaceTab {
  if (!canRepairProject(tab)) throw new Error("只能修复已停止的本地会话");
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
  if (!path.trim()) throw new Error("请选择有效目录");
  const before = editableTab(ports.current());
  const project = await ports.open(path.trim());
  const current = editableTab(ports.current());
  if (before.id !== current.id || before.project.rootUri !== current.project.rootUri) {
    throw new Error("会话目录已经改变，请重新选择");
  }
  if (project.rootUri === current.project.rootUri) throw new Error("目录未改变，请使用终端的重新启动入口");
  await ports.beforeApply?.(current);
  const ready = editableTab(ports.current());
  if (ready.id !== current.id || ready.project.rootUri !== current.project.rootUri) throw new Error("会话目录已经改变，请重新选择");
  ports.apply(ready, project);
}

function editableTab(tab: WorkspaceTab | null) {
  if (!tab) throw new Error("会话已不存在");
  if (!canRepairProject(tab)) throw new Error("只能修复已停止的本地会话");
  return tab;
}
