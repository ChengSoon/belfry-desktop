use tauri::AppHandle;
use tauri::ipc::Response;

use super::contracts::BackgroundAsset;
use super::service;
use crate::terminal::AppError;

#[tauri::command]
pub fn background_import(app: AppHandle, source: String) -> Result<BackgroundAsset, AppError> {
    service::import(&app, &source)
}

/// 原始字节直接回传，不做 base64。
/// `Response` 走的是 IPC 的 raw body，几 MB 的图也不会因为编码膨胀三分之一。
#[tauri::command]
pub fn background_read(app: AppHandle) -> Result<Response, AppError> {
    service::read(&app).map(Response::new)
}

#[tauri::command]
pub fn background_remove(app: AppHandle) -> Result<(), AppError> {
    service::remove(&app)
}
