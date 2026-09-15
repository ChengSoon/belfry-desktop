use serde::{Deserialize, Serialize};

use crate::agent::AgentSessionRef;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRequest {
    pub reader_id: String,
    pub session: AgentSessionRef,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub role: String,
    pub timestamp: Option<i64>,
    pub text: String,
    pub tools: Vec<HistoryTool>,
    pub omitted_blocks: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTool {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub text: String,
    pub success: Option<bool>,
    pub changes: Vec<HistoryChange>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChange {
    pub path: String,
    pub original_path: Option<String>,
    pub kind: String,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
    pub patch: Option<String>,
    pub note: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailPage {
    pub reader_id: String,
    pub page: u32,
    pub entries: Vec<HistoryEntry>,
    pub has_more: bool,
    pub scanned_bytes: u64,
    pub total_bytes: u64,
    pub skipped_lines: usize,
    pub note: Option<String>,
}
