use super::super::contracts::{AgentKind, AgentLifecycleState, AgentSessionRef, AgentStateSource};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HookSnapshot {
    pub sequence: u64,
    pub agent: AgentKind,
    pub session: Option<AgentSessionRef>,
    pub state: AgentLifecycleState,
    pub source: AgentStateSource,
    pub occurred_at: i64,
    pub reason: String,
    pub transcript_path: Option<String>,
}

#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HookInput {
    pub event: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub source: Option<String>,
    pub agent_id: Option<String>,
    pub tool_key: Option<String>,
    pub tool_name: Option<String>,
    pub transcript_path: Option<String>,
    pub notification_type: Option<String>,
    pub is_interrupt: bool,
    pub background_work: bool,
    pub occurred_at: i64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HookMessage {
    pub version: u16,
    pub token: String,
    pub agent: AgentKind,
    pub input: HookInput,
}
