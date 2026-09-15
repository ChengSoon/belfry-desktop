use tauri::{AppHandle, Manager};
use crate::terminal::{AppError, TerminalRuntime};
use super::{contracts::*, service::{WorktreeService, WorktreeState}};

#[tauri::command]
pub async fn worktree_list(app: AppHandle, root_path: String) -> Result<WorktreeReport, AppError> {
    tauri::async_runtime::spawn_blocking(move || with_service(&app, |service| service.list(&root_path)))
        .await.map_err(|error| AppError::io(error.to_string()))?
}
#[tauri::command]
pub async fn worktree_preview_create(app: AppHandle, input: CreateInput) -> Result<WorktreePreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || with_service(&app, |service| service.preview(input)))
        .await.map_err(|error| AppError::io(error.to_string()))?
}
#[tauri::command]
pub async fn worktree_preview_action(app: AppHandle, input: ActionInput) -> Result<WorktreePreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || with_service(&app, |service| service.preview_action(input)))
        .await.map_err(|error| AppError::io(error.to_string()))?
}
#[tauri::command]
pub async fn worktree_execute(app: AppHandle, token: String) -> Result<ActionResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<TerminalRuntime>();
        let _guard = runtime.lock_workspace();
        let _daemon_lease = runtime.workspace_lease()?;
        with_service(&app, |service| service.execute(&token, |path| runtime.has_sessions_in(path)))
    }).await.map_err(|error| AppError::io(error.to_string()))?
}

fn with_service<T>(app: &AppHandle, work: impl FnOnce(&mut WorktreeService) -> Result<T, AppError>) -> Result<T, AppError> {
    let state = app.state::<WorktreeState>();
    let mut value = state.0.lock().map_err(|_| AppError::io("Worktree 状态忙，请重试"))?;
    if value.is_none() {
        let data = app.path().app_local_data_dir().map_err(|error| AppError::io(error.to_string()))?.join("worktree-manager");
        *value = Some(WorktreeService::new(data));
    }
    work(value.as_mut().expect("initialized worktree service"))
}
