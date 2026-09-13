use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::agent::AgentKind;
use crate::history::contracts::HistorySession;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchRequest {
    pub request_id: String,
    pub query: HistoryQuery,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub agent: Option<AgentKind>,
    #[serde(default)]
    pub text: String,
    pub project_root: Option<String>,
    pub from: Option<i64>,
    pub until: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchHit {
    pub session: HistorySession,
    pub snippet: Option<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchReport {
    pub hits: Vec<HistorySearchHit>,
    pub projects: Vec<String>,
    pub scanned_files: usize,
    pub indexed_files: usize,
    pub skipped_files: usize,
    pub skipped_lines: usize,
}

#[derive(Default)]
pub(super) struct SearchRoots {
    pub codex: Option<PathBuf>,
    pub claude: Option<PathBuf>,
}
