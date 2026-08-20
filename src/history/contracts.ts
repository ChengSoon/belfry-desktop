import type { AgentKind, AgentSessionRef } from "../agent/contracts";

/** 一条历史会话的元数据，来自本机 Agent 会话日志。 */
export interface HistorySession {
  /** Agent + opaque session id，避免不同 Agent 使用相同 id 时发生碰撞。 */
  agent: AgentKind;
  /** resume / 删除用的会话标识：Codex 的 session_id、Claude 的文件名主干。 */
  id: string;
  /** 会话首条用户消息提炼出的标题；读不到用户消息时为空串。 */
  title: string;
  /** 会话所在工程目录；目录可能已被移动或删除，故可空。 */
  cwd: string | null;
  /** 会话开始时间，epoch 秒。 */
  startedAt: number | null;
  /** 最后活跃时间，epoch 秒（文件 mtime）。 */
  lastActiveAt: number;
  /** 后续适配器可携带更多恢复信息；当前 CLI 只需该引用。 */
  sessionRef: AgentSessionRef;
}

export type { AgentKind };
