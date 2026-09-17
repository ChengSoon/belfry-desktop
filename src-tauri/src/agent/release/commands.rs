use super::{install, package_for, report, AgentRelease, AgentReleaseInstall};
use crate::agent::AgentKind;
use crate::terminal::AppError;

#[tauri::command]
pub async fn agent_release_report() -> Result<Vec<AgentRelease>, AppError> {
    Ok(report().await)
}

#[tauri::command]
pub async fn agent_release_install(kind: AgentKind) -> Result<AgentReleaseInstall, AppError> {
    // 只接收 kind，包名在后端重新反查：接受前端传入的包字符串等于开一个任意
    // npm 包安装接口。
    let package = package_for(kind)?;
    tauri::async_runtime::spawn_blocking(move || install::install(kind, &package))
        .await
        .map_err(|error| AppError::io(format!("安装任务意外终止：{error}")))?
}
