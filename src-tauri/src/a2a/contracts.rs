use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroize;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthKind {
    None,
    Bearer,
    ApiKey,
}

// Incoming secrets are neither printable nor serializable and are cleared on drop.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum CredentialEdit {
    Keep,
    Replace { value: String },
    Clear,
}
impl Drop for CredentialEdit {
    fn drop(&mut self) {
        if let Self::Replace { value } = self {
            value.zeroize();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthDraft {
    pub kind: AuthKind,
    pub header_name: Option<String>,
    pub credential: CredentialEdit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionDraft {
    pub id: Option<String>,
    pub name: String,
    pub card_url: String,
    pub interface_url: Option<String>,
    /// The selected interface's tenant, when the Card lists several interfaces
    /// on the same URL. Meaningful only with `interface_url`.
    #[serde(default)]
    pub interface_tenant: Option<String>,
    pub auth: AuthDraft,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthInfo {
    pub kind: AuthKind,
    pub header_name: Option<String>,
    pub has_credential: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub card_url: String,
    pub interface_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface_tenant: Option<String>,
    pub auth: AuthInfo,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<LocalConnectionInfo>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalConnectionInfo {
    pub tab_id: String,
    pub agent: String,
    pub ready: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentInterface {
    pub url: String,
    pub protocol_binding: String,
    pub protocol_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Issue {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub card: Value,
    pub interfaces: Vec<AgentInterface>,
    pub selected_interface: Option<AgentInterface>,
    pub issue: Option<Issue>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentReply {
    #[serde(rename_all = "camelCase")]
    Task {
        connection_id: String,
        task_handle: String,
        task: Value,
        terminal: bool,
    },
    #[serde(rename_all = "camelCase")]
    Message {
        connection_id: String,
        message: Value,
    },
}
