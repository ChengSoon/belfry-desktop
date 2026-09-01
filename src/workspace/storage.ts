import type {
  AgentSessionRef,
  ProjectWorkspace,
  RecentProject,
  WorkspaceTab,
  WorkspaceTabKind,
} from "./contracts";
import { isAgentSessionId, isAgentSessionRef } from "../agent/contracts";
import {
  isShellProfileId,
  type LaunchProfileId,
  type SshTarget,
} from "../terminal/contracts";
import { pathKey } from "./path";

export const RECENT_PROJECTS_KEY = "belfry.recent-projects.v1";
export const RECENT_PROJECTS_LIMIT = 6;
export const WORKSPACE_STATE_KEY = "belfry.workspace.v1";

export interface PersistedWorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export function loadRecentProjects(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    return parseRecentProjects(storage.getItem(RECENT_PROJECTS_KEY));
  } catch {
    return [];
  }
}

export function saveRecentProjects(
  projects: RecentProject[],
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects.slice(0, RECENT_PROJECTS_LIMIT)));
}

/**
 * 会话进程不能跨应用重启存活，这里只恢复足以重新拉起它的稳定信息。
 * phase/activity/error 一律回到初始态，随后由新 PTY 的快照接管。
 */
export function loadWorkspaceState(
  storage: Pick<Storage, "getItem"> = localStorage,
): PersistedWorkspaceState | null {
  try {
    return parseWorkspaceState(storage.getItem(WORKSPACE_STATE_KEY));
  } catch {
    return null;
  }
}

export function saveWorkspaceState(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(WORKSPACE_STATE_KEY, serializeWorkspaceState(tabs, activeTabId));
  } catch {
    // localStorage 被禁用时退化为本次运行内有效，不影响终端本身。
  }
}

export function serializeWorkspaceState(tabs: WorkspaceTab[], activeTabId: string | null) {
  return JSON.stringify({
    tabs: tabs.map(({
      id,
      project,
      kind,
      title,
      titleHint,
      customTitle,
      agentName,
      profileId,
      collaborationMode,
      resumeSessionId,
      agentSessionRef,
      sshTarget,
    }) => ({
      id,
      project,
      kind,
      title,
      titleHint,
      customTitle,
      agentName,
      profileId,
      collaborationMode,
      resumeSessionId,
      agentSessionRef,
      // 密码只进系统钥匙串：工作区存档只保留连接目标本身。
      sshTarget: sshTarget ? { host: sshTarget.host, user: sshTarget.user, port: sshTarget.port } : null,
    })),
    activeTabId: tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id ?? null,
  });
}

export function parseWorkspaceState(value: string | null): PersistedWorkspaceState | null {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return null;

  const ids = new Set<string>();
  const tabs = parsed.tabs.flatMap((value): WorkspaceTab[] => {
    if (!isPersistedTab(value) || ids.has(value.id)) return [];
    ids.add(value.id);
    const sessionRef = sessionRefForPersistedTab(value);
    return [{
      id: value.id,
      project: value.project,
      kind: value.kind,
      title: value.title,
      titleHint: value.titleHint,
      customTitle: value.customTitle ?? null,
      agentName: value.agentName ?? null,
      resumeSessionId: sessionRef?.id ?? null,
      agentSessionRef: sessionRef,
      profileId: profileIdForKind(value.kind, value.profileId),
      collaborationMode: value.collaborationMode ?? false,
      sshTarget: value.kind === "ssh" && value.sshTarget
        ? { ...value.sshTarget, password: null, rememberPassword: false }
        : null,
      phase: "idle",
      activity: "idle",
      error: null,
    }];
  });
  const requestedActiveId = typeof parsed.activeTabId === "string" ? parsed.activeTabId : null;
  return {
    tabs,
    activeTabId: tabs.some((tab) => tab.id === requestedActiveId)
      ? requestedActiveId
      : tabs[0]?.id ?? null,
  };
}

function profileIdForKind(kind: WorkspaceTabKind, persisted: LaunchProfileId | undefined): LaunchProfileId {
  if (kind === "shell") return persisted && isShellProfileId(persisted) ? persisted : "system-default";
  if (kind === "ssh") return "ssh";
  return `agent:${kind}`;
}

export function rememberProject(project: ProjectWorkspace, recent: RecentProject[]) {
  const entry = { id: project.id, name: project.name, rootPath: project.rootPath };
  return deduplicateByRootPath([entry, ...recent]);
}

/** 按 id 从最近项目列表移除；不存在时原样返回。 */
export function removeRecentProject(projects: RecentProject[], id: string) {
  return projects.filter((project) => project.id !== id);
}

export function parseRecentProjects(value: string | null): RecentProject[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return deduplicateByRootPath(parsed.filter(isRecentProject));
}

function deduplicateByRootPath(projects: RecentProject[]) {
  const roots = new Set<string>();
  return projects
    .filter((project) => {
      const key = pathKey(project.rootPath);
      if (roots.has(key)) return false;
      roots.add(key);
      return true;
    })
    .slice(0, RECENT_PROJECTS_LIMIT);
}

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== "object" || !value) return false;
  const item = value as Record<string, unknown>;
  return [item.id, item.name, item.rootPath].every((field) => typeof field === "string");
}

interface PersistedTab {
  id: string;
  project: ProjectWorkspace;
  kind: WorkspaceTabKind;
  title: string;
  titleHint: string | null;
  /** 用户手动设置的显示名；旧版本存档没有该字段，解析时按 null 处理。 */
  customTitle: string | null;
  /** 协作里的唯一名；旧版本存档没有该字段，解析时按 null 处理。 */
  agentName?: string | null;
  /** Shell profile；旧版本存档没有该字段，解析时回退系统默认。 */
  profileId?: LaunchProfileId;
  /** 协作专用会话；旧版本存档没有该字段，解析时按 false。 */
  collaborationMode?: boolean;
  /** 旧版本存档没有该字段，解析时按 null 处理。 */
  resumeSessionId: string | null;
  /** v0.14 explicit Agent identity; absent in older saves. */
  agentSessionRef?: AgentSessionRef | null;
  /** SSH 会话的连接目标；旧版本存档没有该字段，解析时按 null 处理。 */
  sshTarget: SshTarget | null;
}

function isPersistedTab(value: unknown): value is PersistedTab {
  if (!isRecord(value) || !isProjectWorkspace(value.project)) return false;
  return typeof value.id === "string"
    && value.id.length > 0
    && isWorkspaceTabKind(value.kind)
    && typeof value.title === "string"
    && value.title.length > 0
    && (value.titleHint === null || typeof value.titleHint === "string")
    && (value.customTitle === undefined
      || value.customTitle === null
      || typeof value.customTitle === "string")
    && (value.agentName === undefined
      || value.agentName === null
      || typeof value.agentName === "string")
    && (value.profileId === undefined
      || (typeof value.profileId === "string"
        && (value.kind !== "shell" || isShellProfileId(value.profileId))))
    && (value.collaborationMode === undefined || typeof value.collaborationMode === "boolean")
    // 旧版本存档没有该字段（undefined 也要放行），解析时按 null 处理。
    && (value.resumeSessionId === undefined
      || value.resumeSessionId === null
      || (typeof value.resumeSessionId === "string"
        && isAgentSessionIdForKind(value.kind, value.resumeSessionId)))
    && (value.agentSessionRef === undefined
      || value.agentSessionRef === null
      || isAgentSessionRef(value.agentSessionRef))
    && ((value.kind === "codex" || value.kind === "claude")
      ? (value.agentSessionRef === undefined
        || value.agentSessionRef === null
        || value.agentSessionRef.agent === value.kind)
      : value.agentSessionRef === undefined || value.agentSessionRef === null)
    && (value.agentSessionRef === undefined
      || value.agentSessionRef === null
      || value.resumeSessionId === undefined
      || value.resumeSessionId === null
      || value.agentSessionRef.id === value.resumeSessionId)
    // SSH 会话必须带目标，否则重启后拉不起进程；旧存档没有 ssh 会话，不受影响。
    && (value.kind !== "ssh" || isSshTarget(value.sshTarget));
}

function sessionRefForPersistedTab(value: PersistedTab): AgentSessionRef | null {
  if (value.kind !== "codex" && value.kind !== "claude") return null;
  if (value.agentSessionRef?.agent === value.kind && value.agentSessionRef.id) {
    return value.agentSessionRef;
  }
  return value.resumeSessionId && isAgentSessionId(value.resumeSessionId)
    ? { agent: value.kind, id: value.resumeSessionId }
    : null;
}

function isAgentSessionIdForKind(kind: WorkspaceTabKind, value: string) {
  return (kind === "codex" || kind === "claude") && isAgentSessionId(value);
}

function isSshTarget(value: unknown): value is SshTarget {
  if (!isRecord(value)) return false;
  return typeof value.host === "string"
    && value.host.length > 0
    && (value.user === undefined || value.user === null || typeof value.user === "string")
    && (value.port === undefined || value.port === null || typeof value.port === "number");
}

function isProjectWorkspace(value: unknown): value is ProjectWorkspace {
  if (!isRecord(value)) return false;
  return [value.id, value.name, value.rootPath, value.rootUri]
    .every((field) => typeof field === "string" && field.length > 0);
}

function isWorkspaceTabKind(value: unknown): value is WorkspaceTabKind {
  return value === "shell" || value === "ssh" || value === "codex" || value === "claude";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
