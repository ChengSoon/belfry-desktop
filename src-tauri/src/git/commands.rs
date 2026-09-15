use super::contracts::{DiffRequest, GitDiff, GitStatus};
use super::{diff, status};
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
