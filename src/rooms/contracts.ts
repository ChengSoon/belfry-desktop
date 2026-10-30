/**
 * Rust 侧 `rooms::store` 的类型镜像。字段名与 serde `camelCase` 对齐；
 * 改这里之前先改 `src-tauri/src/rooms/store.rs` 并跑那边的单测。
 */

export type MessageKind = "user" | "member" | "system";

/** 一条投递（一位成员）在总线上的状态。 */
export type DeliveryState =
  | "queued"
  | "dispatched"
  | "done"
  | "failed"
  | "abandoned"
  | "unknown";

/** 任务整体状态；派生规则见 rooms/store.rs `refresh_stage`。 */
export type TaskStage =
  | "dispatching"
  | "running"
  | "submitted"
  | "verified"
  | "rejected"
  | "stopped"
  | "failed"
  | "interrupted";

/**
 * 房间视图需要的会话切片：在场状态与展示名。
 * 主窗口传完整的 WorkspaceTab；独立窗口从协作名册还原这一份。
 */
export interface RoomTabView {
  id: string;
  /** Agent 配置名（claude / codex / pi），成员副行显示。 */
  kind: string;
  phase: string;
  activity: string;
  agentName: string | null;
  title: string;
}

export interface RoomMember {
  id: string;
  tabId: string;
  /** 配置名（claude / codex / pi）。 */
  agent: string;
  role: string;
  duty: string;
  joinedAt: number;
  /** 软删除：离开后不再参与派发，历史引用仍可解析。 */
  leftAt: number | null;
}

export interface RoomMessage {
  id: string;
  at: number;
  kind: MessageKind;
  /** `user` / `system` / memberId（成员消息存它，显示时按当前角色名解析）。 */
  author: string;
  text: string;
  /** 派活接收者；讨论消息为空。 */
  memberIds: string[];
  /** 派活消息内嵌的任务卡片指向它。 */
  taskId: string | null;
  /** 群聊送达回执：已进入过哪些成员的终端（Rust 对账写入；只记送达，不假装读过）。 */
  deliveredTo: string[];
  /** 引用回复：指向被引用的消息 id；被引用消息不在时界面如实标注。 */
  replyTo: string | null;
  /** 表情回应（一人一表情最多一条；切换语义）。 */
  reactions: RoomReaction[];
  /** 撤回时刻；非空表示已撤回。只对用户自己刚发的消息生效。 */
  recalledAt: number | null;
}

/** 一条表情回应：谁、什么表情、什么时候。 */
export interface RoomReaction {
  /** memberId，或用户自己的 `user`。 */
  memberId: string;
  emoji: string;
  at: number;
}

/**
 * 成员间的一次转手：谁把哪条总线任务交给了谁。
 * 对方交差时，回复以他的口吻回显进时间线；`echoedAt` 保证只回显一次。
 */
export interface RoomDelegation {
  id: string;
  busTaskId: string;
  fromMemberId: string;
  toMemberId: string;
  /** 转手内容摘要（系统留痕与排错用）。 */
  text: string;
  at: number;
  /** 回显时间；null＝对方还没交差。 */
  echoedAt: number | null;
}

export interface RoomDecision {
  id: string;
  at: number;
  by: string;
  text: string;
  messageId: string | null;
}

export interface Delivery {
  memberId: string;
  busTaskId: string | null;
  state: DeliveryState;
  /** 交差回执（`belfry done --result`）。 */
  result: string | null;
  at: number;
}

export interface RoomTask {
  id: string;
  title: string;
  text: string;
  memberIds: string[];
  acceptance: string[];
  createdAt: number;
  stage: TaskStage;
  /** 第几轮派发（重新派发时 +1）。 */
  attempt: number;
  deliveries: Delivery[];
  verifiedAt: number | null;
  verificationNote: string | null;
  /** 验证不通过时的退回记录；反馈原文在跟进任务的 text 里。 */
  rejectedAt: number | null;
  rejectionNote: string | null;
  stoppedAt: number | null;
  /** 交差时采集的工作区快照；不在 Git 仓库或采集失败时为 null。 */
  artifact: TaskArtifact | null;
}

/** 交差时采集的工作区快照（产物证据）。 */
export interface TaskArtifact {
  capturedAt: number;
  truncated: boolean;
  text: string;
}

export interface Room {
  id: string;
  name: string;
  projectRoot: string;
  /** 建房间之后扩展进来的项目根；接活范围 = projectRoot + 这里，只增不减。 */
  extraRoots: string[];
  createdAt: number;
  members: RoomMember[];
  messages: RoomMessage[];
  decisions: RoomDecision[];
  tasks: RoomTask[];
  /** 成员间互相转手的登记；对账按它把对方的交差回显进时间线。 */
  delegations: RoomDelegation[];
}

export interface RoomSummary {
  id: string;
  name: string;
  projectRoot: string;
  createdAt: number;
  memberCount: number;
  /** 在房成员的会话 tabId：侧栏与 Quick Open 按它隔离成员会话。 */
  memberTabIds: string[];
  activeTaskCount: number;
  /** 时间线最新一条消息的时刻（含成员发言与系统注记）；结合每房间本地的已读位给房间列表画未读标记，无消息为 null。 */
  lastMessageAt: number | null;
}

export interface RoomsView {
  rooms: RoomSummary[];
  /** 存储读不出来时的原因（版本不认识 / 文件损坏）；界面要如实展示。 */
  loadError: string | null;
}
