/**
 * 房间的线上形状，与 Rust `rooms::model` 逐字段对应（serde camelCase）。
 *
 * 模型照 CCCC：一位统筹（foreman）拆需求、派活、跟进度，成员（peer）各管一块职责。
 */

import type { DeliveryPhase } from "../collab/api";
export type MemberRole = "foreman" | "peer";
export type TaskStatus = "planned" | "active" | "done" | "archived";
export type MessageKind = "chat" | "notice";
export type MessageMode = "send" | "request_reply";

export interface RoomMember {
  id: string;
  tabId: string;
  agent: string;
  title: string;
  duty: string;
  /** Null/absent inherits the project or CLI model on the next process launch. */
  modelOverride?: string | null;
  role: MemberRole;
  joinedAt: number;
  leftAt: number | null;
}

export interface RoomBrief {
  objective: string;
  currentFocus: string;
  constraints: string[];
  updatedBy: string | null;
  updatedAt: number | null;
}

export interface RoomTask {
  id: string;
  title: string;
  outcome: string;
  status: TaskStatus;
  assignee: string | null;
  blockedBy: string[];
  notes: string;
  result: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  rev: number;
}

/** 随消息发出的文件：房间自己的副本，`path` 是本地绝对路径（成员按路径读取）。 */
export interface RoomAttachment {
  id: string;
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

export interface RoomMessage {
  id: string;
  at: number;
  kind: MessageKind;
  /** `user`、`system` 或 memberId。 */
  by: string;
  text: string;
  /** memberId 或 `user`；系统注记只记在时间线上时为空。 */
  to: string[];
  mode: MessageMode;
  replyTo: string | null;
  attachments?: RoomAttachment[];
  deliveredTo: string[];
  repliedBy: string[];
  replyCancelled: boolean;
}

export interface Room {
  id: string;
  name: string;
  projectRoot: string;
  createdAt: number;
  brief: RoomBrief;
  /** Committed ledger size; older cached projections may omit it. */
  ledgerBytes?: number;
  members: RoomMember[];
  tasks: RoomTask[];
  nextTask: number;
  /** 暂停：消息只记在房间里，不送进成员终端。 */
  paused?: boolean;
  messages: RoomMessage[];
  /** Older unresolved/undelivered messages and quoted messages retained outside the recent timeline. */
  retainedMessages?: RoomMessage[];
  deliveryOutbox?: { messageId: string; memberId: string; phase: DeliveryPhase; message: string | null }[];
}

/** 最近一条发给你的消息（统筹汇报、成员找你）。 */
export interface InboxNote {
  id: string;
  at: number;
  from: string;
  text: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  projectRoot: string;
  createdAt: number;
  ledgerBytes?: number;
  objective: string;
  memberCount: number;
  memberTabIds: string[];
  /** 与 memberTabIds 一一对应的角色名。 */
  memberTitles: string[];
  foreman: string | null;
  openTasks: number;
  doneTasks: number;
  lastMessageAt: number | null;
  paused: boolean;
  lastToUser: InboxNote | null;
}

export interface RoomsView {
  rooms: RoomSummary[];
  loadError: string | null;
}

/** 任务板上的一步操作，与 CLI 的 `belfry room task …` 同一张表。 */
export type RoomTaskOp =
  | { op: "add"; title: string; outcome?: string | null; assignee?: string | null; after?: string[] }
  | { op: "assign"; task: string; assignee: string }
  | { op: "start"; task: string }
  | { op: "done"; task: string; result?: string | null }
  | { op: "reopen"; task: string }
  | { op: "note"; task: string; text: string }
  | { op: "archive"; task: string };
