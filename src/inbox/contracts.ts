/**
 * 协作收件箱 IPC 契约。逐字段对应 T62 共享 DTO：
 * src-tauri/crates/belfry-protocol/src/inbox.rs（serde camelCase，class/phase 为 snake_case）。
 * 调用约定见 docs/design/collaboration-inbox/implementation-contract.md。
 */
export const INBOX_CAPABILITY = "collaboration-inbox-v1";
export const INBOX_SCHEMA_VERSION = 1;

export type MessageClass = "task_assignment" | "discussion" | "reply" | "fyi";
export type DeliveryPhase = "pending" | "prepared" | "submitting" | "submitted" | "uncertain" | "withdrawn" | "abandoned";
export type RuntimeAvailability = "ready" | "busy" | "needs_input" | "offline" | "unavailable";

/** 后台生成的稳定状态码；前端按 code 查词条，参数用于整句插值。 */
export interface InboxStatus { code: string; params: Record<string, string> }

export interface Recipient {
  id: string; sessionKey: string; projectRoot: string; tabId: string;
  roomId: string | null; memberId: string | null; name: string; agent: string;
}
export interface Actor { id: string; name: string; tabId: string | null; memberId: string | null }
export interface Source { kind: string; roomId: string | null; name: string; messageId: string }
export interface QuestionView { id: string; text: string; state: string; replyMessageIds: string[]; legacy: boolean }
export interface Attachment { id: string; name: string; path: string; size: number; mimeType: string }
export interface ReplyView { messageId: string; by: Actor; createdAt: number; text: string; answers: string[] }

export interface MessageView {
  /** 收件项 ID：同一原文发给多人时各不相同。 */
  id: string;
  /** 原文 ID；replyTo、replyMessageIds 都引用它。 */
  messageId: string;
  revision: number;
  source: Source;
  recipient: Recipient;
  topicId: string;
  class: MessageClass;
  by: Actor;
  createdAt: number;
  text: string;
  attachments: Attachment[];
  replyTo: string | null;
  questions: QuestionView[];
  replies: ReplyView[];
  deliveryPhase: DeliveryPhase;
  deliveryStatus: InboxStatus;
  handlingStatus: InboxStatus;
  waitingReason: InboxStatus | null;
}

export interface SessionView {
  sessionKey: string; tabId: string; name: string; agent: string; projectRoot: string;
  runtimeAvailability: RuntimeAvailability | string;
  summaryStatus: InboxStatus;
  pendingCount: number; awaitingReplyCount: number;
  lastMessagePreview: string | null; lastMessageAt: number | null; oldestPendingAt: number | null;
}
export interface SessionsView { schemaVersion: number; revision: number; generatedAt: number; sessions: SessionView[]; loadError: string | null }
export interface MessagesView { schemaVersion: number; revision: number; messages: MessageView[]; nextCursor: string | null; loadError: string | null }

export interface Capabilities { schemaVersion: number; capabilities: string[]; enabled: boolean }
export interface PendingRecipient { sessionKey: string; tabId: string; projectRoot: string; pendingCount: number }
export interface PendingView { revision: number; recipients: PendingRecipient[] }

export interface Binding { tabId: string; terminalSessionId: string; ownerId: string; targetEpoch: string; inputRevision: number }
export interface BindRequest { tabId: string; terminalSessionId: string; ownerId: string }
export interface OfferRequest {
  binding: Binding; offerId: string;
  running: boolean; idle: boolean; composerEmpty: boolean; awaitingInput: boolean; promptQueueEmpty: boolean;
}
export interface Offer { binding: Binding; offerId: string; expiresAt: number }
export interface PrepareRequest { sessionKey: string; offer: Offer; operationId: string }
export interface BatchView {
  id: string; attemptId: string; revision: number; sequence: number;
  recipient: Recipient; targetEpoch: string; terminalSessionId: string;
  topicId: string; entryIds: string[]; messageIds: string[];
  payload: string; payloadHash: string; contentMode: string;
  phase: string; preparedAt: number; leaseExpiresAt: number;
}
export interface PrepareResult { batch: BatchView | null; blocker: InboxStatus | null }
export interface BatchRequest { batchId: string; attemptId: string; expectedRevision: number }
export interface BeginRequest { batch: BatchRequest; offer: Offer }
export interface WriteGuard { batchId: string; attemptId: string; token: string; ownerId: string; targetEpoch: string; inputRevision: number }
export interface BeginResult { batch: BatchView; writeGuard: WriteGuard }
export interface ReceiptRequest { batchId: string; attemptId: string; sequence: number; phase: "submitted" | "uncertain"; payloadHash: string; message: string | null }
export interface ResolveRequest { batch: BatchRequest; sequence: number; decision: "submitted" | "abandon" }

export const batchRequest = (batch: Pick<BatchView, "id" | "attemptId" | "revision">): BatchRequest =>
  ({ batchId: batch.id, attemptId: batch.attemptId, expectedRevision: batch.revision });
