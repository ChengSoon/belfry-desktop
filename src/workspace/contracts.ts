import type { LaunchProfileId, SessionActivity, TerminalPhase } from "../terminal/contracts";

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
  /** 命名所依据的完整输入原文，未截断，只给 tooltip 用。 */
  titleHint: string | null;
  profileId: LaunchProfileId;
  phase: TerminalPhase;
  /** 与 phase 正交：phase 说进程活着没，activity 说它眼下在干什么。 */
  activity: SessionActivity;
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
