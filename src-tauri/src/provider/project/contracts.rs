use super::super::contracts::EnvConflict;
use crate::agent::AgentKind;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProviderSelection {
    pub root_path: String,
    pub kind: AgentKind,
    pub provider_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProviderReport {
    pub root_path: String,
    pub agents: Vec<ProjectAgentProvider>,
    pub env_conflicts: Vec<EnvConflict>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgentProvider {
    pub kind: AgentKind,
    pub provider_id: Option<String>,
    pub source: &'static str,
    pub effective_name: String,
    pub missing: bool,
    pub choices: Vec<ProjectProviderChoice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProviderChoice {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub configured: bool,
}
