use super::contracts::AnalyticsReport;
use crate::usage::contracts::UsageQuery;

#[tauri::command]
pub async fn usage_analytics(query: UsageQuery) -> Result<AnalyticsReport, String> {
    tauri::async_runtime::spawn_blocking(move || super::service::collect(&query))
        .await
        .map_err(|error| format!("用量扫描失败：{error}"))?
}
