use super::contracts::{ContextItem, ContextWrite};
use super::identity::SessionIdentities;
use super::registry::{SessionRegistry, SessionSnapshot};
use super::task::{self, TaskBoard};
use super::store::{get, list, put, remove, set_pinned};
use crate::terminal::AppError;
use tauri::State;

/// 待投递的协作任务。
///
/// 前端拉而不是 Rust 推：只有前端知道终端目标注册好了没——targets 表在它手上。
/// 每条只给投递需要的东西，调用链和 hop 这类闸门内部状态不外传。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTask {
    pub id: String,
    /// 注入目标终端的完整文本，已经拼好三行协议头。
    pub text: String,
    pub to: String,
    pub from: String,
    pub from_label: String,
    pub instruction: String,
}

#[tauri::command]
pub fn collab_pending_tasks(
    board: State<'_, std::sync::Arc<TaskBoard>>,
    registry: State<'_, std::sync::Arc<SessionRegistry>>,
) -> Vec<PendingTask> {
    board
        .pending()
        .into_iter()
        .map(|entry| {
            // 派活方在目标眼里应该是个认得出的名字，不是一串 tabId。
            let from_label = registry
                .find(&entry.from)
                .map(|session| session.title)
                .unwrap_or_else(|| entry.from.clone());
            PendingTask {
                text: task::injection_text(&entry, &from_label),
                id: entry.id,
                to: entry.to,
                from: entry.from,
                from_label,
                instruction: entry.instruction,
            }
        })
        .collect()
}

/// 前端投递完回执。
#[tauri::command]
pub fn collab_mark_dispatched(board: State<'_, std::sync::Arc<TaskBoard>>, id: String) {
    board.mark_dispatched(&id);
}

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
    board: State<'_, std::sync::Arc<TaskBoard>>,
    sessions: Vec<SessionSnapshot>,
) {
    let live: Vec<String> = sessions.iter().map(|item| item.tab_id.clone()).collect();
    // 会话没了就把派给它、还没结的任务收掉：留着的话派活方会一直等一个
    // 永远不会来的 done。
    let gone: Vec<String> = board
        .snapshot()
        .into_iter()
        .map(|entry| entry.to)
        .filter(|to| !live.iter().any(|alive| alive == to))
        .collect();
    for tab_id in gone {
        board.abandon_for(&tab_id);
    }
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
