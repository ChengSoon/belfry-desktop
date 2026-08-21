import type { RecentProject, WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";
import type { QuickOpenItem } from "./model";

const ACTION_ITEMS: QuickOpenItem[] = [
  { id: "action:new-shell", kind: "action", title: "新建 Shell 会话", subtitle: "当前项目", keywords: ["shell", "terminal", "new"], icon: "terminal" },
  { id: "action:composer", kind: "action", title: "打开 Prompt Composer", subtitle: "发送或排队 Agent 指令", keywords: ["prompt", "queue", "消息", "队列"], icon: "composer" },
  { id: "action:recipes", kind: "action", title: "打开 Recipe", subtitle: "可复用的多步 Agent 指令", keywords: ["recipe", "steps", "多步", "指令", "复用", "剧本"], icon: "list-checks" },
  { id: "action:file-preview", kind: "action", title: "打开文件预览", subtitle: "浏览当前项目文件", keywords: ["file", "preview", "文件", "目录", "code"], icon: "file-search" },
  { id: "action:settings", kind: "action", title: "打开设置", subtitle: "Belfry", keywords: ["preferences", "config"], icon: "settings" },
  { id: "action:history", kind: "action", title: "打开历史会话", subtitle: "Codex / Claude", keywords: ["resume", "history"], icon: "history" },
  { id: "action:usage", kind: "action", title: "打开额度用量", subtitle: "按模型和项目查看", keywords: ["tokens", "usage", "quota"], icon: "gauge" },
  { id: "action:sidebar", kind: "action", title: "切换侧栏", subtitle: "显示或隐藏会话列表", keywords: ["sidebar", "panel"], icon: "sidebar" },
  { id: "action:shortcuts", kind: "action", title: "打开快捷指令", subtitle: "Belfry 与 Agent", keywords: ["keyboard", "help", "shortcuts"], icon: "keyboard" },
];

export function buildQuickOpenItems(
  tabs: readonly WorkspaceTab[],
  recentProjects: readonly RecentProject[],
  activeTabId: string | null,
): QuickOpenItem[] {
  const sessions = tabs.map((tab): QuickOpenItem => ({
    id: `session:${tab.id}`,
    kind: "session",
    title: tab.title,
    subtitle: `${sessionKindLabel(tab.kind)} · ${tab.project.name}${tab.id === activeTabId ? " · 当前" : ""}`,
    keywords: [tab.project.name, tab.project.rootPath, tab.titleHint ?? ""],
    value: tab.id,
    icon: "terminal",
  }));
  const projects = recentProjects.map((project): QuickOpenItem => ({
    id: `project:${project.id}`,
    kind: "project",
    title: project.name,
    subtitle: project.rootPath,
    keywords: [project.rootPath],
    value: project.rootPath,
    icon: "folder",
  }));
  return [...sessions, ...projects, ...ACTION_ITEMS];
}

function sessionKindLabel(kind: WorkspaceTabKind) {
  if (kind === "shell") return "Shell";
  if (kind === "ssh") return "SSH";
  return kind === "codex" ? "Codex" : "Claude";
}
