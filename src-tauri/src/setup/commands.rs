use tauri::{AppHandle, Manager};

use crate::a2a::local::LocalGateway;
use crate::terminal::AppError;

use super::contracts::EnvironmentReport;
use super::diagnostics;

#[tauri::command]
pub async fn setup_diagnose(app: AppHandle) -> Result<EnvironmentReport, AppError> {
    let report = tauri::async_runtime::spawn_blocking(move || {
        let gateway = app.state::<LocalGateway>().diagnostic_status();
        diagnostics::run(&gateway)
    })
    .await
    .unwrap_or_else(|error| {
        EnvironmentReport::failed(belfry_i18n::lformat!("环境检查异常退出：{error}"))
    });
    Ok(report)
}
