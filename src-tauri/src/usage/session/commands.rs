use super::{
    contracts::{SessionStatistics, SessionStatisticsQuery},
    service::SessionStatisticsState,
};
use crate::terminal::AppError;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn session_statistics(
    app: AppHandle,
    query: SessionStatisticsQuery,
) -> Result<SessionStatistics, AppError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<SessionStatisticsState>().read(query))
        .await
        .map_err(|error| AppError::io(error.to_string()))?
}
