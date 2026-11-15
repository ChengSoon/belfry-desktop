use crate::plugins::agent_connection::AuthorizedAgent;
use belfry_protocol::inbox::TaskRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

#[derive(Clone)]
pub(super) struct AgentRecord {
    pub id: String,
    pub owner: AuthorizedAgent,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum Progress {
    #[default]
    Submitted,
    Working,
    InputRequired,
    Completed,
    Failed,
    Canceled,
}
impl Progress {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Submitted => "TASK_STATE_SUBMITTED",
            Self::Working => "TASK_STATE_WORKING",
            Self::InputRequired => "TASK_STATE_INPUT_REQUIRED",
            Self::Completed => "TASK_STATE_COMPLETED",
            Self::Failed => "TASK_STATE_FAILED",
            Self::Canceled => "TASK_STATE_CANCELED",
        }
    }
    pub fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Canceled)
    }
}

#[derive(Clone)]
pub(super) struct Link {
    pub id: String,
    pub context_id: String,
    pub sender: Option<AuthorizedAgent>,
    pub recipient: AuthorizedAgent,
    pub target_id: String,
    pub reference: TaskRef,
    pub report_handle: String,
    pub instruction: String,
    pub progress: Progress,
    pub status_text: Option<String>,
    pub artifacts: Vec<Value>,
    pub history: Vec<Value>,
    pub question_ids: Vec<String>,
    pub room_name: Option<String>,
    pub used: Instant,
}
#[derive(Clone)]
pub(super) struct Replay {
    pub signature: String,
    pub task_id: String,
    pub used: Instant,
}
pub(super) struct BusinessReplay {
    pub signature: String,
    pub value: Value,
    pub used: Instant,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RoomContext {
    pub room: String,
    pub title: String,
    #[serde(default)]
    pub after: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct TextArtifact {
    pub name: Option<String>,
    pub text: String,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ReportState {
    Working,
    InputRequired,
    Completed,
    Failed,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReportInput {
    pub report_handle: String,
    pub generation: u64,
    pub state: ReportState,
    pub text: Option<String>,
    #[serde(default)]
    pub artifacts: Vec<TextArtifact>,
    pub operation_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalTask {
    pub report_handle: String,
    pub generation: u64,
    pub task_ref: TaskRef,
    pub task: Value,
    pub instruction: String,
    pub source: Value,
}
