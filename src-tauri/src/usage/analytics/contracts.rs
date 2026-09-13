use crate::agent::AgentKind;
use crate::usage::contracts::{AgentQuota, TokenTotals};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    pub agent: AgentKind,
    pub model: String,
    /// UTC 当天零点的 epoch 秒；无有效日期的记录保留为 None。
    pub day: Option<i64>,
    pub project_root: Option<String>,
    pub project_name: Option<String>,
    pub tokens: TokenTotals,
    pub requests: u64,
}

pub struct AnalyticsBuckets {
    pub rows: Vec<UsageBucket>,
    pub undated_records: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsReport {
    pub rows: Vec<UsageBucket>,
    pub quotas: Vec<AgentQuota>,
    pub scanned_files: u32,
    pub skipped_files: u32,
    pub undated_records: u64,
    pub window_days: Option<u32>,
    pub project_root: Option<String>,
    pub start_at: Option<i64>,
    pub end_at: i64,
    pub generated_at: i64,
}
