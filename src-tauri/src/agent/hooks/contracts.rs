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

pub(super) use belfry_protocol::hooks::HookInput;
pub(super) type HookMessage = belfry_protocol::hooks::HookMessage<AgentKind>;
