use crate::agent::AgentKind;
use crate::terminal::AppError;

use super::contracts::HistorySession;
use super::service;

/// 列出某 Agent 的历史会话。扫描本地日志可能耗时，放到阻塞线程池避免卡住 UI。
#[tauri::command]
pub async fn history_list(agent: AgentKind) -> Vec<HistorySession> {
    tauri::async_runtime::spawn_blocking(move || service::list(agent))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn history_delete(agent: AgentKind, session_id: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || service::delete(agent, &session_id))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn history_clear(agent: AgentKind) -> Result<u32, AppError> {
    tauri::async_runtime::spawn_blocking(move || service::clear(agent))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}
