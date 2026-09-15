use serde::{Deserialize, Serialize};

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repository: bool,
    pub root_path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub entries: Vec<GitEntry>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub untracked: bool,
    pub conflicted: bool,
    pub submodule: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiffStage {
    Staged,
    Unstaged,
    Untracked,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub root_path: String,
    pub path: String,
    pub stage: DiffStage,
}

#[derive(Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub text: String,
    pub binary: bool,
    pub truncated: bool,
}
