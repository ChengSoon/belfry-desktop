use crate::harness::broker::BrokerError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeRequest {
    pub session_id: String,
    pub worker_id: String,
    pub request_id: String,
    pub tool_id: String,
    pub relative_path: String,
    pub expected_digest: String,
    pub replacement: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub session_id: String,
    pub worker_id: String,
    pub request_id: String,
    pub tool_id: String,
    pub preview_id: String,
    pub approval_token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchPreview {
    pub preview_id: String,
    pub generation: u64,
    pub relative_path: String,
    pub original_digest: String,
    pub replacement_digest: String,
    pub old_lines: usize,
    pub new_lines: usize,
    pub final_bytes: usize,
    pub diff: DiffPreview,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPreview {
    pub hunks: Vec<DiffHunk>,
    pub truncated: bool,
    pub omitted_hunks: usize,
    pub omitted_lines: usize,
    pub preview_bytes: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: usize,
    pub new_start: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
    pub content: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffLineKind {
    Context,
    Add,
    Delete,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchAudit {
    pub phase: &'static str,
    pub session_id: String,
    pub request_id: String,
    pub tool_id: String,
    pub preview_id: Option<String>,
    pub duration_ms: u64,
    pub summary: String,
    pub error_code: Option<&'static str>,
}

pub type PatchResult<T> = Result<T, BrokerError>;
