use super::{
    config,
    install::{InstallPreview, InstallSpec},
    runtime::HookRuntime,
    settings::{self, AgentHookReport},
};
use crate::{agent::AgentKind, terminal::AppError};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn agent_hooks_report() -> Result<Vec<AgentHookReport>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        AgentKind::ALL.into_iter().map(settings::report).collect()
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))
}

#[tauri::command]
pub async fn agent_hooks_preview(
    app: AppHandle,
    kind: AgentKind,
    enabled: bool,
) -> Result<InstallPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if enabled && !settings::report(kind).supported {
            return Err(AppError::unsupported(
                "当前 CLI 版本尚未验证 Hook 接口，请升级后重试",
            ));
        }
        let command = if enabled {
            Some(config::command(
                &std::env::current_exe().map_err(|error| AppError::io(error.to_string()))?,
                kind,
                cfg!(windows),
            )?)
        } else {
            None
        };
        app.state::<HookRuntime>().installer.preview(InstallSpec {
            path: settings::config_path(kind)?,
            kind,
            command,
        })
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn agent_hooks_apply(app: AppHandle, preview_id: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<HookRuntime>().installer.apply(&preview_id)
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub fn agent_hooks_cancel(runtime: State<'_, HookRuntime>, preview_id: String) {
    runtime.installer.cancel(&preview_id);
}
