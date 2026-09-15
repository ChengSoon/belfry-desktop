use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWorktree {
    pub id: String, pub name: String, pub root_path: String, pub repository_path: String,
    pub common_dir: String, pub branch: String, pub base_branch: String,
    pub base_head: String, pub state: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingWorktree {
    pub root_path: String, pub branch: Option<String>, pub head: String, pub locked: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeReport {
    pub root_path: String, pub branch: String, pub branches: Vec<String>,
    pub worktrees: Vec<ExistingWorktree>, pub managed: Vec<ManagedWorktree>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput { pub root_path: String, pub name: String, pub branch: String, pub base_branch: String }

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Action { Commit, Merge, Cleanup }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInput {
    pub id: String, pub action: Action, pub message: Option<String>, pub target_path: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePreview {
    pub token: String, pub title: String, pub root_path: String, pub branch: String,
    pub target_path: Option<String>, pub files: Vec<String>, pub diff: String,
    pub notes: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult { pub message: String, pub worktree: Option<ManagedWorktree>, pub conflicts: Vec<String> }
