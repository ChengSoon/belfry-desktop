use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRegistration {
    pub session_id: String,
    pub worker_id: String,
    pub project_root: String,
    pub harness_id: String,
    pub harness_version: String,
    pub declared_tools: Vec<String>,
    pub granted_capabilities: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRequest {
    pub session_id: String,
    pub request_id: String,
    pub tool_id: String,
    pub tool: String,
    pub params: Value,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BrokerError {
    pub code: &'static str,
    pub message: &'static str,
}

impl BrokerError {
    pub(crate) fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub phase: &'static str,
    pub session_id: String,
    pub request_id: String,
    pub tool_id: String,
    pub tool: String,
    pub duration_ms: u64,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<&'static str>,
}

pub type BrokerResult = Result<Value, BrokerError>;
