use super::contracts::{ProjectDirectory, ProjectFilePreview, ProjectWorkspace};
use super::files::{list_directory, read_file};
use super::service::open_project;
use crate::terminal::AppError;

#[tauri::command]
pub fn project_open(path: Option<String>) -> Result<ProjectWorkspace, AppError> {
    open_project(path.as_deref())
}

#[tauri::command]
pub fn project_list_directory(
    root_path: String,
    relative_path: Option<String>,
) -> Result<ProjectDirectory, AppError> {
    list_directory(&root_path, relative_path.as_deref())
}

#[tauri::command]
pub fn project_read_file(
    root_path: String,
    relative_path: String,
) -> Result<ProjectFilePreview, AppError> {
    read_file(&root_path, &relative_path)
}
