use belfry_protocol::inbox::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    #[serde(default)]
    pub source_revision: u64,
    pub view: MessageView,
    pub enqueue_seq: u64,
    pub received_at: i64,
    pub answers: Vec<String>,
    pub task: Option<TaskRef>,
    pub batch_id: Option<String>,
    pub handling: Handling,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Batch {
    pub view: BatchView,
    pub offer: Option<Offer>,
    pub operation_id: String,
    pub operation_hash: String,
    pub priority: bool,
    pub receipt_hash: Option<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Policy {
    pub revision: u64,
    pub high: bool,
    pub hold_until: Option<i64>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Wait {
    pub questions: Vec<String>,
    pub task: Option<TaskRef>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Operation {
    pub hash: String,
    pub result: serde_json::Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Mirror {
    pub entry_id: String,
    pub batch_id: String,
    pub source: Source,
    pub recipient: Recipient,
    pub submitted: bool,
    #[serde(default)]
    pub withdrawn_by: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Data {
    pub schema_version: u32,
    pub revision: u64,
    pub enabled: bool,
    pub next_seq: u64,
    pub entries: BTreeMap<String, Entry>,
    pub batches: BTreeMap<String, Batch>,
    pub slots: BTreeMap<String, Vec<TaskRef>>,
    pub policies: BTreeMap<String, Policy>,
    pub waits: BTreeMap<String, Wait>,
    pub priority_streak: BTreeMap<String, u8>,
    pub operations: BTreeMap<String, Operation>,
    pub mirrors: BTreeMap<String, Mirror>,
}
impl Default for Data {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            enabled: false,
            next_seq: 1,
            entries: BTreeMap::new(),
            batches: BTreeMap::new(),
            slots: BTreeMap::new(),
            policies: BTreeMap::new(),
            waits: BTreeMap::new(),
            priority_streak: BTreeMap::new(),
            operations: BTreeMap::new(),
            mirrors: BTreeMap::new(),
        }
    }
}

pub(super) fn policy_key(entry: &Entry) -> String {
    format!(
        "{}\n{}\n{}",
        entry.view.recipient.session_key,
        entry.view.source.room_id.as_deref().unwrap_or("direct"),
        entry.view.topic_id
    )
}
pub(super) fn task_key(task: &TaskRef) -> String {
    serde_json::to_string(task).expect("task identity serialization")
}
pub(super) fn new_id() -> String {
    ulid::Ulid::generate().to_string().to_lowercase()
}
pub(super) fn now() -> i64 {
    crate::rooms::model::now_millis()
}
pub(super) fn hash(value: impl AsRef<[u8]>) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(value.as_ref()))
}
pub(super) fn operation_hash(value: &impl Serialize) -> String {
    hash(serde_json::to_vec(value).expect("inbox DTO serialization"))
}
pub(super) fn pending(phase: &DeliveryPhase) -> bool {
    matches!(
        phase,
        DeliveryPhase::Pending | DeliveryPhase::Prepared | DeliveryPhase::Submitting | DeliveryPhase::Uncertain
    )
}

pub(super) fn abort(data: &mut Data, id: &str) {
    let Some(batch) = data.batches.get_mut(id) else {
        return;
    };
    if batch.view.phase != "prepared" {
        return;
    }
    batch.view.phase = "aborted".into();
    batch.view.revision += 1;
    for id in &batch.view.entry_ids {
        if let Some(entry) = data.entries.get_mut(id)
            && entry.view.delivery_phase == DeliveryPhase::Prepared
            && entry.batch_id.as_deref() == Some(&batch.view.id)
        {
            entry.view.delivery_phase = DeliveryPhase::Pending;
            entry.batch_id = None;
            entry.view.revision += 1;
        }
    }
}
pub(super) fn set_phase(data: &mut Data, batch_id: &str, phase: &str) {
    let Some(batch) = data.batches.get_mut(batch_id) else {
        return;
    };
    batch.view.phase = phase.into();
    batch.view.revision += 1;
    for id in &batch.view.entry_ids {
        if let Some(entry) = data.entries.get_mut(id) {
            entry.view.delivery_phase = match phase {
                "submitting" => DeliveryPhase::Submitting,
                "submitted" => DeliveryPhase::Submitted,
                "abandoned" => DeliveryPhase::Abandoned,
                _ => DeliveryPhase::Uncertain,
            };
            entry.view.revision += 1;
            if matches!(phase, "submitted" | "abandoned") {
                data.mirrors.insert(
                    id.clone(),
                    Mirror {
                        entry_id: id.clone(),
                        batch_id: batch_id.into(),
                        source: entry.view.source.clone(),
                        recipient: entry.view.recipient.clone(),
                        submitted: phase == "submitted",
                        withdrawn_by: None,
                    },
                );
            }
        }
    }
}
