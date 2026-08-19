use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub root_uri: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectEntryKind {
    Directory,
    File,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: ProjectEntryKind,
    pub size: u64,
    pub modified_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirectory {
    pub relative_path: String,
    pub entries: Vec<ProjectEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFilePreview {
    pub name: String,
    pub relative_path: String,
    pub content: String,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub language: Option<String>,
    pub binary: bool,
    pub truncated: bool,
}
