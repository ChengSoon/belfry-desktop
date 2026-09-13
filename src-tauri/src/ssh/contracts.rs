use serde::{Deserialize, Serialize};

use crate::terminal::SshTarget;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRequest {
    pub id: String,
    pub target: SshTarget,
    pub browse: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteReport {
    pub path: String,
    pub directories: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct SshAlias {
    pub name: String,
    pub source: String,
}

#[derive(Default, Debug, Serialize)]
pub struct AliasReport {
    pub aliases: Vec<SshAlias>,
    pub warnings: Vec<String>,
}
