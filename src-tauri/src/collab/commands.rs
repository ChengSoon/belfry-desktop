use super::contracts::{ContextItem, ContextWrite};
use super::store::{get, list, put, remove, set_pinned};
use crate::terminal::AppError;

#[tauri::command]
pub async fn context_list(root_path: String) -> Result<Vec<ContextItem>, AppError> {
    blocking(move || list(&root_path)).await
}

#[tauri::command]
pub async fn context_put(
    root_path: String,
    write: ContextWrite,
) -> Result<ContextItem, AppError> {
    blocking(move || put(&root_path, write)).await
}

#[tauri::command]
pub async fn context_get(root_path: String, id: String) -> Result<String, AppError> {
    blocking(move || get(&root_path, &id)).await
}

#[tauri::command]
pub async fn context_remove(root_path: String, id: String) -> Result<(), AppError> {
    blocking(move || remove(&root_path, &id)).await
}

#[tauri::command]
pub async fn context_set_pinned(
    root_path: String,
    id: String,
    pinned: bool,
) -> Result<ContextItem, AppError> {
    blocking(move || set_pinned(&root_path, &id, pinned)).await
}

/// 文件读写别占着 IPC 线程：索引可能有两百条，正文可能几百 KB。
async fn blocking<T, F>(work: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| AppError::io(format!("共享上下文任务异常退出：{err}")))?
}
