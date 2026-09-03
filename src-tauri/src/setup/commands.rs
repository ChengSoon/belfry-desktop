use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::collab::{CollabEndpoint, SessionIdentities};
use crate::terminal::AppError;

use super::contracts::{EnvironmentReport, SkillInstallOutcome};
use super::{diagnostics, skill};

#[tauri::command]
pub async fn setup_diagnose(app: AppHandle) -> Result<EnvironmentReport, AppError> {
    let endpoint = app.state::<CollabEndpoint>().0.clone();
    let identities = app.state::<Arc<SessionIdentities>>().inner().clone();
    let report = tauri::async_runtime::spawn_blocking(move || {
        diagnostics::run(endpoint.as_deref(), &identities)
    })
    .await
    .unwrap_or_else(|error| EnvironmentReport::failed(format!("环境检查异常退出：{error}")));
    Ok(report)
}

#[tauri::command]
pub async fn setup_install_skill() -> Result<SkillInstallOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(skill::install_all)
        .await
        .map_err(|error| AppError::io(format!("Skill 安装任务异常退出：{error}")))
}
