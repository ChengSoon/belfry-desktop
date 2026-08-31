import type { LaunchProfileId, SessionActivity, SshLaunch, TerminalPhase } from "../terminal/contracts";
import type {
  AgentKind,
  AgentSessionRef,
} from "../agent/contracts";

export type {
  AgentAvailability,
  AgentCapabilities,
  AgentDescriptor,
  AgentKind,
  AgentSessionRef,
} from "../agent/contracts";
export type WorkspaceTabKind = "shell" | "ssh" | AgentKind;

export interface ProjectWorkspace {
  id: string;
  name: string;
  rootPath: string;
  rootUri: string;
}

export interface WorkspaceTab {
  id: string;
  /** 会话自带项目归属：不同会话可以指向不同目录，改它会重启该会话的 PTY。 */
  project: ProjectWorkspace;
  kind: WorkspaceTabKind;
  title: string;
  /** 命名所依据的完整输入原文，未截断，只给 tooltip 用。 */
  titleHint: string | null;
  /** 用户手动设置的显示名；null 表示用默认命名（SSH 为连接目标）。 */
  customTitle: string | null;
  /**
   * 这条 Agent 会话在协作里的唯一名（`reviewer` / `frontend`）。派活只认它。
   *
   * 与 `title` / `customTitle` 分开存：title 是从最后一条输入自动生成、每敲一条
   * prompt 就变的展示名，而寻址键必须稳定；customTitle 一旦设置还会顺带锁死自动
   * 改名，那是另一件事。null 表示还没命名，此时无法被别的 Agent 寻址。
   */
  agentName: string | null;
  profileId: LaunchProfileId;
  /** true 表示该 Agent 由 Otty 协作调度器独占管理。 */
  collaborationMode: boolean;
  /** SSH 会话的连接目标；其他会话为 null。 */
  sshTarget: SshLaunch | null;
  /** 新建会话时继承的历史会话 id；普通会话为 null。 */
  resumeSessionId: string | null;
  /** Agent 历史身份的显式引用；旧工作区只保留 resumeSessionId 时可为空。 */
  agentSessionRef?: AgentSessionRef | null;
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
