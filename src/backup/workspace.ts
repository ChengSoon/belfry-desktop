import { isId, parseCollection } from "../workspace/named/validation";
import { initialCollection } from "../workspace/named/model";
import { MAX_COLLECTION_TABS } from "../workspace/named/contracts";
import { parseRecentProjects, parseWorkspaceState } from "../workspace/storage";
import type { ProjectWorkspace, WorkspaceTab } from "../workspace/contracts";
import { cleanTarget } from "../workspace/ssh/model";
import { record, type WorkspaceBackup } from "./contracts";

const MAX_LABEL_LENGTH = 200;
const MAX_PATH_LENGTH = 4096;
const DISPLAY_NAME = { shell: "Shell", ssh: "SSH", claude: "Claude", codex: "Codex", pi: "Pi" };

export function cleanWorkspace(input: unknown): WorkspaceBackup {
  if (!record(input) || !record(input.state) || !Array.isArray(input.state.tabs)) throw new Error("工作区数据无效");
  if (input.state.tabs.length > MAX_COLLECTION_TABS) throw new Error("备份中的会话数量超限");
  const state = parseWorkspaceState(JSON.stringify(input.state));
  if (!state || state.tabs.length !== input.state.tabs.length) throw new Error("备份含无效或重复会话");
  const tabs = state.tabs.map(cleanTab);
  const ids = new Set(tabs.map((tab) => tab.id as string));
  const groups = input.groups === undefined
    ? initialCollection({ tabIds: [...ids], activeTabId: state.activeTabId })
    : parseCollection(JSON.stringify(input.groups));
  const groupedIds = groups.workspaces.flatMap((group) => group.tabIds);
  if (groupedIds.length !== ids.size || groupedIds.some((id) => !ids.has(id))) {
    throw new Error("备份中的工作区与会话引用不一致");
  }
  if (groups.workspaces.some((group) => group.activeTabId !== null && !group.tabIds.includes(group.activeTabId))) {
    throw new Error("备份中的焦点引用了不存在的会话");
  }
  const recent = parseRecentProjects(JSON.stringify(input.recent ?? [])).map((project) => ({
    id: identifier(project.id), name: label(project.name), rootPath: path(project.rootPath),
  }));
  return { state: { tabs, activeTabId: state.activeTabId }, recent, groups };
}

function cleanTab(tab: WorkspaceTab): Record<string, unknown> {
  return {
    id: identifier(tab.id), project: cleanProject(tab.project), kind: tab.kind,
    title: tab.customTitle ? label(tab.customTitle) : DISPLAY_NAME[tab.kind], titleHint: null,
    customTitle: tab.customTitle ? label(tab.customTitle) : null,
    agentName: tab.agentName ? label(tab.agentName) : null, profileId: tab.profileId,
    collaborationMode: tab.collaborationMode ?? false,
    resumeSessionId: tab.resumeSessionId, agentSessionRef: tab.agentSessionRef
      ? { agent: tab.agentSessionRef.agent, id: tab.agentSessionRef.id } : null,
    sshTarget: tab.sshTarget ? cleanTarget(tab.sshTarget) : null,
  };
}

function cleanProject(project: ProjectWorkspace) {
  return { id: identifier(project.id), name: label(project.name), rootPath: path(project.rootPath), rootUri: path(project.rootUri) };
}

function identifier(value: string) {
  if (!isId(value)) throw new Error("备份中的标识无效");
  return value;
}
function label(value: string) { return text(value, MAX_LABEL_LENGTH); }
function path(value: string) { return text(value, MAX_PATH_LENGTH); }
function text(value: string, limit: number) {
  if (!value || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("备份中的名称或路径无效");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|password|secret|token)\s*[:=]/i.test(value)) {
    throw new Error("名称或路径包含凭据内容，请先移除后再备份");
  }
  return value;
}
