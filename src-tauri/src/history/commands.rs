use crate::agent::AgentKind;
use crate::terminal::AppError;

use super::contracts::HistorySession;
use super::search::{
    HistorySearchState,
    contracts::{HistorySearchReport, HistorySearchRequest},
};
use super::service;

#[tauri::command]
pub async fn history_search(
    state: tauri::State<'_, HistorySearchState>,
    request: HistorySearchRequest,
) -> Result<HistorySearchReport, AppError> {
    state.search(request).await
}

#[tauri::command]
pub fn history_cancel_search(state: tauri::State<'_, HistorySearchState>, request_id: String) {
    state.cancel(&request_id);
}

/// 列出某 Agent 的历史会话。扫描本地日志可能耗时，放到阻塞线程池避免卡住 UI。
#[tauri::command]
pub async fn history_list(agent: AgentKind) -> Vec<HistorySession> {
    tauri::async_runtime::spawn_blocking(move || service::list(agent))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn history_delete(
    runtime: tauri::State<'_, crate::terminal::TerminalRuntime>,
    agent: AgentKind,
    session_id: String,
) -> Result<(), AppError> {
    check_running(&runtime, agent, Some(&session_id))?;
    tauri::async_runtime::spawn_blocking(move || service::delete(agent, &session_id))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn history_clear(
    runtime: tauri::State<'_, crate::terminal::TerminalRuntime>,
    agent: AgentKind,
) -> Result<u32, AppError> {
    check_running(&runtime, agent, None)?;
    tauri::async_runtime::spawn_blocking(move || service::clear(agent))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}

fn check_running(
    runtime: &crate::terminal::TerminalRuntime,
    agent: AgentKind,
    id: Option<&str>,
) -> Result<(), AppError> {
    if !super::native::supported(agent) {
        return Ok(());
    }
    let running = runtime.background_sessions()?.iter().any(|info| {
        info.session.status == crate::terminal::TerminalStatus::Running
            && AgentKind::from_profile_id(&info.profile_id) == Some(agent)
            && id.is_none_or(|id| info.native_session.as_ref().is_none_or(|s| s.id == id))
    });
    if running {
        return Err(AppError::invalid_argument(
            "请先关闭使用该历史的 Agent 会话，再删除历史",
        ));
    }
    Ok(())
}
