import type { TerminalSnapshot } from "../components/TerminalViewport";
import type { SshLaunch } from "../terminal/contracts";
import { sshDisplayName } from "../terminal/contracts";
import type { ProjectWorkspace, WorkspaceTab, WorkspaceTabKind } from "./contracts";
import { pathKey } from "./path";
import { toSessionTitle } from "./sessionTitle";

export interface ProjectGroup {
  project: ProjectWorkspace;
  tabs: WorkspaceTab[];
}

/** SSH 会话不属于任何本地项目，侧栏单独成组。 */
export const SSH_GROUP_PROJECT: ProjectWorkspace = {
  id: "ssh",
  name: "SSH",
  rootPath: "",
  rootUri: "",
};

export function createWorkspaceTab(
  project: ProjectWorkspace,
  kind: WorkspaceTabKind,
  ordinal: number,
  resumeSessionId: string | null = null,
  sshTarget: SshLaunch | null = null,
): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    project,
    kind,
    title: tabTitle(kind, ordinal, sshTarget),
    titleHint: null,
    customTitle: null,
    profileId: kind === "shell" ? "system-default" : kind === "ssh" ? "ssh" : `agent:${kind}`,
    resumeSessionId,
    sshTarget,
    phase: "idle",
    activity: "idle",
    error: null,
  };
}

/** 切换目录时固定创建 Shell；原 tab 不变，调用方把新 tab 追加到列表。 */
export function createProjectSwitchTab(
  tabs: WorkspaceTab[],
  project: ProjectWorkspace,
) {
  return createWorkspaceTab(project, "shell", nextOrdinal(tabs, "shell"));
}

/**
 * 把终端快照合进会话：phase/error/activity 直接覆盖，标题只在这条输入够格时才换。
 * 全程没变就返回原对象，避免 phase 抖动时白白重渲染整条侧栏。
 */
export function applySnapshot(tab: WorkspaceTab, snapshot: TerminalSnapshot): WorkspaceTab {
  // SSH 标签认连接目标，不随远程命令改名；手动改过的名字同样不再被自动顶掉。
  // toSessionTitle 返回 null 同理保留上一个。
  const title = tab.kind === "ssh" || tab.customTitle
    ? tab.title
    : (snapshot.lastInput && toSessionTitle(snapshot.lastInput)) || tab.title;
  if (
    tab.phase === snapshot.phase
    && tab.error === snapshot.error
    && tab.activity === snapshot.activity
    && title === tab.title
  ) return tab;
  return {
    ...tab,
    phase: snapshot.phase,
    activity: snapshot.activity,
    error: snapshot.error,
    title,
    titleHint: title === tab.title ? tab.titleHint : snapshot.lastInput,
  };
}

/** 修改 SSH 目标时重置旧终端状态；自定义显示名不随连接地址变化。 */
export function updateSshTarget(tab: WorkspaceTab, target: SshLaunch): WorkspaceTab {
  if (tab.kind !== "ssh") return tab;
  return {
    ...tab,
    sshTarget: target,
    title: tab.customTitle ? tab.title : sshDisplayName(target),
    titleHint: null,
    phase: "idle",
    activity: "idle",
    error: null,
  };
}

export function nextActiveTab(tabs: WorkspaceTab[], closingId: string) {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingId);
  const remaining = tabs.filter((tab) => tab.id !== closingId);
  const nextIndex = Math.min(Math.max(closingIndex, 0), remaining.length - 1);
  return { remaining, activeId: remaining[nextIndex]?.id ?? null };
}

/**
 * 关闭指定目录下的全部会话。活动会话在其中时，活动切到剩余会话的第一个——
 * 逐个 closeTab 会经 nextActiveTab 把活动切到同目录的下一个会话，它随后也被
 * 关掉，活动就悬空成一个已删除的 id，切换器会显示"正在定位…"。
 */
export function closeTabsForPath(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  rootPath: string,
) {
  const targetKey = pathKey(rootPath);
  const remaining = tabs.filter((tab) => pathKey(tab.project.rootPath) !== targetKey);
  const activeSurvives = activeTabId !== null && remaining.some((tab) => tab.id === activeTabId);
  return { remaining, activeId: activeSurvives ? activeTabId : (remaining[0]?.id ?? null) };
}

/** 侧栏分组：按项目首次出现的顺序排列，组内保持会话原有顺序。 */
export function groupTabsByProject(tabs: WorkspaceTab[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const sshTabs = tabs.filter((tab) => tab.kind === "ssh");
  if (sshTabs.length > 0) {
    groups.push({ project: SSH_GROUP_PROJECT, tabs: sshTabs });
  }
  const byProject = new Map<string, ProjectGroup>();
  for (const tab of tabs) {
    if (tab.kind === "ssh") continue;
    const group = byProject.get(tab.project.id);
    if (group) group.tabs.push(tab);
    else byProject.set(tab.project.id, { project: tab.project, tabs: [tab] });
  }
  groups.push(...byProject.values());
  return groups;
}

/** 序号按 kind 全局递增，不按项目重置——否则两个项目组里会同时出现 Shell 01。 */
export function nextOrdinal(tabs: WorkspaceTab[], kind: WorkspaceTabKind) {
  return tabs.filter((tab) => tab.kind === kind).length + 1;
}

function tabTitle(kind: WorkspaceTabKind, ordinal: number, sshTarget: SshLaunch | null) {
  if (kind === "ssh") {
    return sshTarget ? sshDisplayName(sshTarget) : `SSH ${String(ordinal).padStart(2, "0")}`;
  }
  const label = { shell: "Shell", codex: "Codex", claude: "Claude" }[kind];
  return `${label} ${String(ordinal).padStart(2, "0")}`;
}
