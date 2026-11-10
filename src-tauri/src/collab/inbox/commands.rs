use super::{Capabilities, InboxService, Pending};
use crate::terminal::AppError;
use belfry_protocol::inbox::*;
use std::sync::Arc;
use tauri::State;
#[tauri::command]
pub(crate) fn collab_inbox_capabilities(inbox: State<'_, Arc<InboxService>>) -> Capabilities {
    inbox.capabilities()
}
#[tauri::command]
pub(crate) fn collab_inbox_activate(
    inbox: State<'_, Arc<InboxService>>,
    operation_id: String,
    legacy_queue_drained: bool,
) -> Result<Capabilities, AppError> {
    inbox.activate(operation_id, legacy_queue_drained)
}
#[tauri::command]
pub(crate) fn collab_inbox_sessions(
    inbox: State<'_, Arc<InboxService>>,
    project_root: String,
    room_id: Option<String>,
) -> Result<SessionsView, AppError> {
    inbox.sessions(&project_root, room_id.as_deref())
}
#[tauri::command]
pub(crate) fn collab_inbox_messages(
    inbox: State<'_, Arc<InboxService>>,
    session_key: String,
    room_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
    message_id: Option<String>,
) -> Result<MessagesView, AppError> {
    inbox.messages(&session_key, room_id.as_deref(), cursor.as_deref(), limit, message_id.as_deref())
}
#[tauri::command]
pub(crate) fn collab_inbox_pending(inbox: State<'_, Arc<InboxService>>) -> Result<Pending, AppError> {
    inbox.pending()
}
#[tauri::command]
pub(crate) fn collab_inbox_bind_target(
    inbox: State<'_, Arc<InboxService>>,
    request: BindRequest,
) -> Result<Binding, AppError> {
    inbox.bind(&request)
}
#[tauri::command]
pub(crate) fn collab_inbox_offer(
    inbox: State<'_, Arc<InboxService>>,
    request: OfferRequest,
) -> Result<Offer, AppError> {
    inbox.offer(&request)
}
#[tauri::command]
pub(crate) fn collab_inbox_revoke_offer(inbox: State<'_, Arc<InboxService>>, request: Offer) {
    inbox.revoke(&request);
}
#[tauri::command]
pub(crate) fn collab_inbox_prepare(
    inbox: State<'_, Arc<InboxService>>,
    request: PrepareRequest,
) -> Result<PrepareResult, AppError> {
    inbox.prepare(&request)
}
#[tauri::command]
pub(crate) fn collab_inbox_begin_submit(
    inbox: State<'_, Arc<InboxService>>,
    request: BeginRequest,
) -> Result<BeginResult, AppError> {
    inbox.begin(&request)
}
#[tauri::command]
pub(crate) fn collab_inbox_receipt(
    inbox: State<'_, Arc<InboxService>>,
    request: ReceiptRequest,
) -> Result<BatchView, AppError> {
    inbox.receipt(&request)
}
#[tauri::command]
pub(crate) fn collab_inbox_abort_prepared(
    inbox: State<'_, Arc<InboxService>>,
    request: BatchRequest,
) -> Result<BatchView, AppError> {
    inbox.abort_prepared(&request)
}
#[tauri::command]
pub(crate) fn collab_inbox_batch_get(
    inbox: State<'_, Arc<InboxService>>,
    batch_id: String,
) -> Result<BatchView, AppError> {
    inbox.batch(&batch_id)
}
#[tauri::command]
pub(crate) fn collab_inbox_resolve(
    inbox: State<'_, Arc<InboxService>>,
    request: ResolveRequest,
) -> Result<BatchView, AppError> {
    inbox.resolve(&request)
}
