use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub(crate) const MAX_SESSION_ID_LENGTH: usize = 512;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Codex,
    Claude,
    Pi,
    Antigravity,
    Opencode,
    Kimi,
}

impl AgentKind {
    pub const ALL: [Self; 6] = [
        Self::Codex,
        Self::Claude,
        Self::Pi,
        Self::Antigravity,
        Self::Opencode,
        Self::Kimi,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Antigravity => "antigravity",
            _ => self.command_name(),
        }
    }

    pub fn from_profile_id(profile: &str) -> Option<Self> {
        let id = profile.strip_prefix("agent:")?;
        Self::ALL.into_iter().find(|kind| kind.id() == id)
    }

    pub fn command_name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Pi => "pi",
            Self::Antigravity => "agy",
            Self::Opencode => "opencode",
            Self::Kimi => "kimi",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude Code",
            Self::Pi => "Pi",
            Self::Antigravity => "Antigravity CLI",
            Self::Opencode => "OpenCode",
            Self::Kimi => "Kimi Code",
        }
    }

    pub fn terminal_status_app(self) -> Option<&'static str> {
        match self {
            Self::Codex => Some("codex"),
            Self::Claude => Some("claude-code"),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    pub launch: bool,
    pub resume: bool,
    pub history: bool,
    pub prompt: bool,
    pub structured_state: bool,
}

impl AgentCapabilities {
    pub fn cli_foundation() -> Self {
        Self {
            launch: true,
            resume: true,
            history: true,
            prompt: true,
            // The descriptor selects OSC status for supported adapters; a missing report stays unknown.
            structured_state: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDescriptor {
    pub id: String,
    pub kind: AgentKind,
    pub display_name: String,
    pub command: String,
    pub capabilities: AgentCapabilities,
}

impl AgentDescriptor {
    pub fn for_kind(kind: AgentKind) -> Self {
        Self {
            id: format!("agent:{}", kind.id()),
            kind,
            display_name: kind.display_name().to_string(),
            command: kind.command_name().to_string(),
            capabilities: AgentCapabilities { structured_state: kind.terminal_status_app().is_some(), ..AgentCapabilities::cli_foundation() },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRef {
    pub agent: AgentKind,
    pub id: String,
}

impl AgentSessionRef {
    pub fn validate(&self) -> Result<(), String> {
        validate_agent_session_id(&self.id)
    }
}

pub(crate) fn validate_agent_session_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value == "."
        || value.len() > MAX_SESSION_ID_LENGTH
        || value.chars().any(char::is_control)
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
    {
        return Err("agent session id is invalid".to_string());
    }
    Ok(())
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentLifecycleState {
    Starting,
    Processing,
    AwaitingInput,
    Completed,
    Failed,
    Interrupted,
    Unknown,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStateSource {
    Hook,
    TerminalProtocol,
    ScreenHeuristic,
    Process,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgramState { Idle, Working, Blocked, Done, Error, Clear }

impl ProgramState {
    pub fn allows_input(self) -> bool {
        matches!(self, Self::Idle | Self::Done)
    }

    pub fn lifecycle(self) -> AgentLifecycleState {
        match self {
            Self::Idle | Self::Done => AgentLifecycleState::Completed,
            Self::Working => AgentLifecycleState::Processing,
            Self::Blocked => AgentLifecycleState::AwaitingInput,
            Self::Error => AgentLifecycleState::Failed,
            Self::Clear => AgentLifecycleState::Unknown,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgramBlockKind { Permission, Question, Auth }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProgramStatus {
    pub state: ProgramState,
    pub kind: Option<ProgramBlockKind>,
    pub progress: Option<u8>,
    pub title: Option<String>,
    pub message: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStateSnapshot {
    pub lifecycle: AgentLifecycleState,
    pub source: AgentStateSource,
    pub confidence: Option<f32>,
    pub reason: Option<String>,
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLifecycleEvent {
    pub schema_version: u16,
    pub agent: AgentKind,
    pub session: AgentSessionRef,
    pub state: AgentLifecycleState,
    pub source: AgentStateSource,
    pub occurred_at: i64,
    pub reason: Option<String>,
    pub metadata: Option<Map<String, Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResumePlan {
    pub schema_version: u16,
    pub session: AgentSessionRef,
    pub supported: bool,
    pub arguments: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAvailability {
    pub descriptor: AgentDescriptor,
    pub kind: AgentKind,
    pub available: bool,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptor_serializes_the_stable_frontend_shape() {
        let value = serde_json::to_value(AgentDescriptor::for_kind(AgentKind::Claude)).unwrap();
        assert_eq!(value["id"], "agent:claude");
        assert_eq!(value["displayName"], "Claude Code");
        assert_eq!(value["capabilities"]["structuredState"], true);
    }

    #[test]
    fn session_refs_reject_path_like_ids_but_keep_opaque_ids() {
        let valid = AgentSessionRef {
            agent: AgentKind::Codex,
            id: "019ff0d5-dbaf-7893-96db-4fbbbfee03a7".to_string(),
        };
        assert!(valid.validate().is_ok());
        for id in ["", "../session", "a\\b", ".", "line\nbreak", "nul\0byte"] {
            let invalid = AgentSessionRef {
                agent: AgentKind::Codex,
                id: id.to_string(),
            };
            assert!(invalid.validate().is_err(), "{id} should be rejected");
        }
        let overlong_utf8 = AgentSessionRef {
            agent: AgentKind::Codex,
            id: "会".repeat(171),
        };
        assert!(overlong_utf8.validate().is_err());
    }
}
