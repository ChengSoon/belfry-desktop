use tauri::AppHandle;
use tauri::ipc::Response;

use super::contracts::ImportedFontAsset;
use super::service;
use crate::terminal::AppError;

#[tauri::command]
pub fn font_import(app: AppHandle, source: String) -> Result<ImportedFontAsset, AppError> {
    service::import(&app, &source)
}

#[tauri::command]
pub fn font_read(app: AppHandle, file_name: String) -> Result<Response, AppError> {
    service::read(&app, &file_name).map(Response::new)
}

#[tauri::command]
pub fn font_remove(app: AppHandle, file_name: String) -> Result<(), AppError> {
    service::remove(&app, &file_name)
}
