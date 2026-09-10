use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginDefinition {
    pub plugin_id: String,
    pub version: String,
    pub manifest_digest: String,
    pub harness_api: u32,
    pub min_app_version: String,
    pub trusted: bool,
    pub enabled: bool,
    pub source: String,
    pub tools: Vec<String>,
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryState {
    pub schema_version: u32,
    pub revision: String,
    pub plugins: Vec<PluginDefinition>,
    pub history: Vec<PluginDefinition>,
    #[serde(default)]
    pub sessions: Vec<SessionSnapshot>,
}

impl Default for RegistryState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: "0".into(),
            plugins: vec![],
            history: vec![],
            sessions: vec![],
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session_id: String,
    pub agent_id: String,
    pub plugin: PluginDefinition,
    pub worker_id: String,
    pub project_root: String,
    pub grants: Vec<String>,
    pub cancelled: bool,
    pub resumable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAudit {
    pub action: String,
    pub plugin_id: Option<String>,
    pub revision: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RegistryError {
    pub code: &'static str,
    pub message: &'static str,
}
impl RegistryError {
    pub(crate) fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}
pub type RegistryResult<T> = Result<T, RegistryError>;
