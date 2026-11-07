/**
 * 房间的线上形状，与 Rust `rooms::model` 逐字段对应（serde camelCase）。
 *
 * 模型照 CCCC：一位统筹（foreman）拆需求、派活、跟进度，成员（peer）各管一块职责。
 */

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
  members: RoomMember[];
  tasks: RoomTask[];
  nextTask: number;
  messages: RoomMessage[];
}

export interface RoomSummary {
  id: string;
  name: string;
  projectRoot: string;
  createdAt: number;
  objective: string;
  memberCount: number;
  memberTabIds: string[];
  /** 与 memberTabIds 一一对应的角色名。 */
  memberTitles: string[];
  foreman: string | null;
  openTasks: number;
  doneTasks: number;
  lastMessageAt: number | null;
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
