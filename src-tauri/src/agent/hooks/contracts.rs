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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub program_status: Option<crate::agent::TerminalProgramStatus>,
}

impl HookSnapshot {
    pub fn terminal_status_for(&self, agent: AgentKind) -> Option<&crate::agent::TerminalProgramStatus> {
        if agent.terminal_status_app().is_none() || self.agent != agent || self.source != AgentStateSource::TerminalProtocol {
            return None;
        }
        self.program_status.as_ref()
    }
}

pub(super) use belfry_protocol::hooks::HookInput;
pub(super) type HookMessage = belfry_protocol::hooks::HookMessage<AgentKind>;
