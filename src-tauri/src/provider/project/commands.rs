use super::{
    contracts::{ProjectProviderReport, ProjectProviderSelection},
    service,
};
use crate::terminal::AppError;
use tauri::AppHandle;

#[tauri::command]
pub async fn project_provider_report(
    app: AppHandle,
    root_path: String,
) -> Result<ProjectProviderReport, AppError> {
    tauri::async_runtime::spawn_blocking(move || service::report(&app, &root_path))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn project_provider_select(
    app: AppHandle,
    selection: ProjectProviderSelection,
) -> Result<ProjectProviderReport, AppError> {
    tauri::async_runtime::spawn_blocking(move || service::select(&app, selection))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}
