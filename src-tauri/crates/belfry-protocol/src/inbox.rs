//! Shared collaboration inbox DTOs. UI reads never acquire delivery ownership.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const CAPABILITY: &str = "collaboration-inbox-v1";
pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_BATCH_MESSAGES: usize = 20;
pub const MAX_BATCH_BYTES: usize = 32 * 1024;
pub const MAX_BATCH_QUESTIONS: usize = 32;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageClass {
    TaskAssignment,
    #[default]
    Discussion,
    Reply,
    Fyi,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageOptions {
    #[serde(default)]
    pub topic_id: Option<String>,
    #[serde(default)]
    pub class: Option<MessageClass>,
    #[serde(default)]
    pub questions: Vec<String>,
    #[serde(default)]
    pub answers: Vec<String>,
    #[serde(default)]
    pub correction_of: Option<String>,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    pub kind: String,
    pub room_id: Option<String>,
    pub id: String,
    /// Reopening/reassignment cannot be released by an earlier lifecycle receipt.
    pub generation: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub text: String,
    pub recipients: Vec<String>,
    #[serde(default)]
    pub replies: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub cancelled_for: Vec<String>,
    #[serde(default)]
    pub legacy: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSemantics {
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub source_sequence: u64,
    #[serde(default)]
    pub sender_tab: Option<String>,
    #[serde(default)]
    pub sender_name: Option<String>,
    #[serde(default)]
    pub task_instruction: Option<String>,
    pub topic_id: String,
    pub class: MessageClass,
    #[serde(default)]
    pub task_ref: Option<TaskRef>,
    #[serde(default)]
    pub task_recipient: Option<String>,
    #[serde(default)]
    pub questions: Vec<Question>,
    #[serde(default)]
    pub answers: Vec<String>,
    #[serde(default)]
    pub correction_of: Option<String>,
    #[serde(default)]
    pub recipient_tabs: BTreeMap<String, String>,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub operation_hash: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub code: String,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}
impl Status {
    pub fn new(code: &str) -> Self {
        Self { code: code.into(), params: BTreeMap::new() }
    }
    pub fn with(mut self, key: &str, value: impl ToString) -> Self {
        self.params.insert(key.into(), value.to_string());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipient {
    pub id: String,
    pub session_key: String,
    pub project_root: String,
    pub tab_id: String,
    pub room_id: Option<String>,
    pub member_id: Option<String>,
    pub name: String,
    pub agent: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub id: String,
    pub name: String,
    pub tab_id: Option<String>,
    pub member_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: String,
    pub room_id: Option<String>,
    pub name: String,
    pub message_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryPhase {
    #[default]
    Pending,
    Prepared,
    Submitting,
    Submitted,
    Uncertain,
    Withdrawn,
    Abandoned,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Handling {
    #[default]
    Unconfirmed,
    Processing,
    Processed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionView {
    pub id: String,
    pub text: String,
    pub state: String,
    pub reply_message_ids: Vec<String>,
    pub legacy: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mime_type: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyView {
    pub message_id: String,
    pub by: Actor,
    pub created_at: i64,
    pub text: String,
    pub answers: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    /// Entry ID, unique even when the same original has several recipients.
    pub id: String,
    pub message_id: String,
    pub revision: u64,
    pub source: Source,
    pub recipient: Recipient,
    pub topic_id: String,
    pub class: MessageClass,
    pub by: Actor,
    pub created_at: i64,
    pub text: String,
    pub attachments: Vec<Attachment>,
    pub reply_to: Option<String>,
    #[serde(default)]
    pub reply_preview: Option<ReplyView>,
    pub questions: Vec<QuestionView>,
    pub replies: Vec<ReplyView>,
    pub delivery_phase: DeliveryPhase,
    pub delivery_status: Status,
    pub handling_status: Status,
    pub waiting_reason: Option<Status>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub session_key: String,
    pub tab_id: String,
    pub name: String,
    pub agent: String,
    pub project_root: String,
    pub runtime_availability: String,
    pub summary_status: Status,
    pub pending_count: usize,
    pub awaiting_reply_count: usize,
    pub last_message_preview: Option<String>,
    pub last_message_at: Option<i64>,
    pub oldest_pending_at: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsView {
    pub schema_version: u32,
    pub revision: u64,
    pub generated_at: i64,
    pub sessions: Vec<SessionView>,
    pub load_error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagesView {
    pub schema_version: u32,
    pub revision: u64,
    pub messages: Vec<MessageView>,
    pub next_cursor: Option<String>,
    pub load_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub tab_id: String,
    pub terminal_session_id: String,
    pub owner_id: String,
    pub target_epoch: String,
    pub input_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindRequest {
    pub tab_id: String,
    pub terminal_session_id: String,
    pub owner_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferRequest {
    pub binding: Binding,
    pub offer_id: String,
    pub running: bool,
    pub idle: bool,
    pub composer_empty: bool,
    pub awaiting_input: bool,
    pub prompt_queue_empty: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub binding: Binding,
    pub offer_id: String,
    pub expires_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub session_key: String,
    pub offer: Offer,
    pub operation_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchView {
    pub id: String,
    pub attempt_id: String,
    pub revision: u64,
    pub sequence: u64,
    pub recipient: Recipient,
    pub target_epoch: String,
    pub terminal_session_id: String,
    pub topic_id: String,
    pub entry_ids: Vec<String>,
    pub message_ids: Vec<String>,
    pub payload: String,
    pub payload_hash: String,
    pub content_mode: String,
    pub phase: String,
    pub prepared_at: i64,
    pub lease_expires_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResult {
    pub batch: Option<BatchView>,
    pub blocker: Option<Status>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub batch_id: String,
    pub attempt_id: String,
    pub expected_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginRequest {
    pub batch: BatchRequest,
    pub offer: Offer,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteGuard {
    pub batch_id: String,
    pub attempt_id: String,
    pub token: String,
    pub owner_id: String,
    pub target_epoch: String,
    pub input_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginResult {
    pub batch: BatchView,
    pub write_guard: WriteGuard,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRequest {
    pub batch_id: String,
    pub attempt_id: String,
    pub sequence: u64,
    pub phase: String,
    pub payload_hash: String,
    pub message: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub batch: BatchRequest,
    pub sequence: u64,
    pub decision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryVersion {
    pub id: String,
    pub revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum AgentCommand {
    #[serde(rename_all = "camelCase")]
    BatchGet { batch_id: String },
    #[serde(rename_all = "camelCase")]
    Resolve { request: ResolveRequest, operation_id: String },
    #[serde(rename_all = "camelCase")]
    List { room: Option<String>, cursor: Option<String>, limit: Option<usize> },
    #[serde(rename_all = "camelCase")]
    Read { message_id: String, cursor: Option<String>, limit: Option<usize> },
    #[serde(rename_all = "camelCase")]
    Ack { entries: Vec<EntryVersion>, state: Handling, operation_id: String },
    #[serde(rename_all = "camelCase")]
    Wait { question_ids: Vec<String>, task: Option<TaskRef>, clear: bool, operation_id: String },
    #[serde(rename_all = "camelCase")]
    Policy {
        room: Option<String>,
        topic_id: String,
        expected_revision: u64,
        priority: Option<String>,
        hold_until: Option<i64>,
        resume: bool,
        operation_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Withdraw { entries: Vec<EntryVersion>, operation_id: String },
}
