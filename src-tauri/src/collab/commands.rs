use super::contracts::{ContextItem, ContextWrite};
use super::identity::SessionIdentities;
use super::registry::{SessionRegistry, SessionSnapshot};
use super::store::{get, list, put, remove, set_pinned};
use crate::terminal::AppError;
use tauri::State;

/// 前端把会话名册同步过来。
///
/// 会话状态只在前端有，而控制 CLI 是从 PTY 里连进来问「现在有谁在」的，
/// 那时前端不在调用栈上——只能靠这份快照。
///
/// 顺带收回已经不在名册里的身份牌：会话关了 token 还有效的话，那条 PTY
/// 里残留的进程仍能以它的名义读写共享上下文。
#[tauri::command]
pub fn collab_sync_sessions(
    registry: State<'_, std::sync::Arc<SessionRegistry>>,
    identities: State<'_, std::sync::Arc<SessionIdentities>>,
    sessions: Vec<SessionSnapshot>,
) {
    let live: Vec<String> = sessions.iter().map(|item| item.tab_id.clone()).collect();
    registry.replace(sessions);
    identities.retain(&live);
}

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
