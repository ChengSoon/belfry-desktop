use super::contracts::ProjectWorkspace;
use super::service::open_project;
use crate::terminal::AppError;

#[tauri::command]
pub fn project_open(path: Option<String>) -> Result<ProjectWorkspace, AppError> {
    open_project(path.as_deref())
}
