use super::contracts::{DiffRequest, GitBranch, GitDiff, GitStatus};
use super::{branch, diff, status};
use crate::terminal::AppError;

#[tauri::command]
pub async fn git_status(root_path: String) -> Result<GitStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || status::read(&root_path))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn git_diff(request: DiffRequest) -> Result<GitDiff, AppError> {
    tauri::async_runtime::spawn_blocking(move || diff::read(request))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}

/// 只读分支名（一到两次极短的 git 调用），给顶栏面包屑用；不扫描工作区。
#[tauri::command]
pub async fn git_branch(root_path: String) -> Result<GitBranch, AppError> {
    tauri::async_runtime::spawn_blocking(move || branch::read(&root_path))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}
