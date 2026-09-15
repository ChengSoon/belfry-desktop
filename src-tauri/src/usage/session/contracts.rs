use crate::agent::AgentSessionRef;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionStatisticsQuery {
    pub session: AgentSessionRef,
    pub transcript_path: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionTokens {
    pub input: Option<u64>,
    pub cached_input: Option<u64>,
    pub cache_write: Option<u64>,
    pub output: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolStatistics {
    pub name: String,
    pub calls: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionStatistics {
    pub session: AgentSessionRef,
    pub tokens: SessionTokens,
    pub models: Vec<String>,
    pub current_model: Option<String>,
    pub tools: Vec<ToolStatistics>,
    pub tool_count: Option<u64>,
    pub updated_at: Option<i64>,
    pub observed_at: i64,
    pub source_files: usize,
    pub scanned_bytes: u64,
    pub pending: bool,
    pub skipped_lines: usize,
    pub note: Option<String>,
}
