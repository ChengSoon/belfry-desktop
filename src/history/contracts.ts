import type { AgentKind } from "../workspace/contracts";

/** 一条历史会话的元数据，来自本机 Agent 会话日志。 */
export interface HistorySession {
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
}

export type { AgentKind };
