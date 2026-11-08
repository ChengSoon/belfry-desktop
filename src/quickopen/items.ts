import { localized, t } from "../i18n";
import type { RecentProject, WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";
import type { QuickOpenItem } from "./model";
import { AGENT_METADATA, AGENT_KINDS } from "../agent/contracts";

const ACTION_ITEMS: QuickOpenItem[] = localized(() => ([
  { id: "action:collab", kind: "action", title: t("quickopen.items.text_18a62218d6"), subtitle: t("quickopen.items.text_42564646a7"), keywords: ["agent", "collab", t("quickopen.items.text_19bf536853"), t("quickopen.items.text_b0f69e4f23"), "belfry", "peers", "send"], icon: "bot" },
  { id: "action:room", kind: "action", title: t("quickopen.items.text_63235691ff"), subtitle: t("quickopen.items.text_6f4524af55"), keywords: ["room", "rooms", t("quickopen.items.text_96b2d40604"), t("quickopen.items.text_63235691ff"), t("quickopen.items.text_b0f69e4f23"), t("quickopen.items.text_8153348240"), t("quickopen.items.text_0f45344baf")], icon: "list-checks" },
  { id: "action:new-shell", kind: "action", title: t("quickopen.items.text_5f38508162"), subtitle: t("quickopen.items.text_bf962b2b91"), keywords: ["shell", "terminal", "new"], icon: "terminal" },
  { id: "action:file-preview", kind: "action", title: t("quickopen.items.text_35b7a07a75"), subtitle: t("quickopen.items.text_b52c5be208"), keywords: ["file", "preview", t("quickopen.items.text_39932f24fe"), t("quickopen.items.text_52daa71ebc"), "code"], icon: "file-search" },
  { id: "action:settings", kind: "action", title: t("quickopen.items.text_37aa6ad6a3"), subtitle: "Belfry", keywords: ["preferences", "config"], icon: "settings" },
  { id: "action:history", kind: "action", title: t("quickopen.items.text_6a532bdfaf"), subtitle: AGENT_KINDS.map((kind) => AGENT_METADATA[kind].name).join(" / "), keywords: ["resume", "history"], icon: "history" },
  { id: "action:usage", kind: "action", title: t("quickopen.items.text_2125271c19"), subtitle: t("quickopen.items.text_9194bc6a68"), keywords: ["tokens", "usage", "quota"], icon: "gauge" },
  { id: "action:sidebar", kind: "action", title: t("quickopen.items.text_32e60fd2b9"), subtitle: t("quickopen.items.text_e2b6f8c929"), keywords: ["sidebar", "panel"], icon: "sidebar" },
  { id: "action:shortcuts", kind: "action", title: t("quickopen.items.text_2b604575fb"), subtitle: t("quickopen.items.text_8543782e67"), keywords: ["keyboard", "help", "shortcuts"], icon: "keyboard" },
  { id: "action:about", kind: "action", title: t("quickopen.items.text_dd21f6641e"), subtitle: t("quickopen.items.text_2905a2a1ab"), keywords: ["about", "version", "update", "license", t("quickopen.items.text_52d25a9e30")], icon: "info" },
]));

export function buildQuickOpenItems(
  tabs: readonly WorkspaceTab[],
  recentProjects: readonly RecentProject[],
  activeTabId: string | null,
): QuickOpenItem[] {
  const sessions = tabs.map((tab): QuickOpenItem => ({
    id: `session:${tab.id}`,
    kind: "session",
    title: tab.title,
    subtitle: t(tab.id === activeTabId ? "quickopen.items.currentSession" : "quickopen.items.session", { kind: sessionKindLabel(tab.kind), project: tab.project.name }),
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
  return kind === "claude" ? "Claude" : AGENT_METADATA[kind].name;
}
