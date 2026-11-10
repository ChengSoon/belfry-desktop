import { invoke } from "@tauri-apps/api/core";
import type {
  BatchRequest, BatchView, BeginRequest, BeginResult, BindRequest, Binding, Capabilities, MessagesView,
  Offer, OfferRequest, PendingView, PrepareRequest, PrepareResult, ReceiptRequest, ResolveRequest, SessionsView,
} from "./contracts";

/* 人类只读接口：无副作用，不 claim、不触发发送。 */
export function inboxSessions(projectRoot: string, roomId: string | null = null) {
  return invoke<SessionsView>("collab_inbox_sessions", { projectRoot, roomId });
}
export function inboxMessages(args: { sessionKey: string; roomId?: string | null; cursor?: string | null; limit?: number | null; messageId?: string | null }) {
  return invoke<MessagesView>("collab_inbox_messages", {
    sessionKey: args.sessionKey, roomId: args.roomId ?? null, cursor: args.cursor ?? null,
    limit: args.limit ?? null, messageId: args.messageId ?? null,
  });
}

/* 切换与提示。 */
export function inboxCapabilities() { return invoke<Capabilities>("collab_inbox_capabilities"); }
export function activateInbox(operationId: string) {
  return invoke<Capabilities>("collab_inbox_activate", { operationId, legacyQueueDrained: true });
}
export function inboxPending() { return invoke<PendingView>("collab_inbox_pending"); }

/* 输入运行时：统一 {request} 参数。 */
export const bindTarget = (request: BindRequest) => invoke<Binding>("collab_inbox_bind_target", { request });
export const offerInput = (request: OfferRequest) => invoke<Offer>("collab_inbox_offer", { request });
export const revokeOffer = (request: Offer) => invoke<void>("collab_inbox_revoke_offer", { request });
export const prepareBatch = (request: PrepareRequest) => invoke<PrepareResult>("collab_inbox_prepare", { request });
export const beginSubmit = (request: BeginRequest) => invoke<BeginResult>("collab_inbox_begin_submit", { request });
export const sendReceipt = (request: ReceiptRequest) => invoke<BatchView>("collab_inbox_receipt", { request });
export const abortPrepared = (request: BatchRequest) => invoke<BatchView>("collab_inbox_abort_prepared", { request });
export const getBatch = (batchId: string) => invoke<BatchView>("collab_inbox_batch_get", { request: { batchId } });
export const resolveBatch = (request: ResolveRequest) => invoke<BatchView>("collab_inbox_resolve", { request });
