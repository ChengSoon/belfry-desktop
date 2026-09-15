use super::UsageAnalyticsState;
use super::contracts::AnalyticsReport;
use crate::usage::contracts::UsageQuery;

#[tauri::command]
pub async fn usage_analytics(
    state: tauri::State<'_, UsageAnalyticsState>,
    query: UsageQuery,
    request_id: Option<String>,
) -> Result<AnalyticsReport, String> {
    state.query(query, request_id).await
}

#[tauri::command]
pub fn usage_cancel_analytics(
    state: tauri::State<'_, UsageAnalyticsState>,
    request_id: String,
) -> Result<(), String> {
    state.cancel(&request_id)
}
