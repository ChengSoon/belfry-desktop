import type { LaunchProfileId, TerminalPhase } from "../terminal/contracts";

export type AgentKind = "codex" | "claude";
export type WorkspaceTabKind = "shell" | AgentKind;

export interface ProjectWorkspace {
  id: string;
  name: string;
  rootPath: string;
  rootUri: string;
}

export interface AgentAvailability {
  kind: AgentKind;
  available: boolean;
  executable: string | null;
  version: string | null;
  reason: string | null;
}

export interface WorkspaceTab {
  id: string;
  /** 会话自带项目归属：不同会话可以指向不同目录，改它会重启该会话的 PTY。 */
  project: ProjectWorkspace;
  kind: WorkspaceTabKind;
  title: string;
  profileId: LaunchProfileId;
  phase: TerminalPhase;
  error: string | null;
}

export interface RecentProject {
  id: string;
  name: string;
  rootPath: string;
}

export interface AppFailure {
  code: string;
  message: string;
  retryable: boolean;
}
