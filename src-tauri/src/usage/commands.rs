use super::contracts::{UsageQuery, UsageReport};
use super::service::collect;

/// 扫描本地会话日志汇总额度用量。全量扫描可能耗时数百毫秒，放到阻塞线程池避免卡住 UI。
#[tauri::command]
pub async fn usage_report(query: Option<UsageQuery>) -> UsageReport {
    let query = query.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || collect(&query))
        .await
        .unwrap_or_else(|_| collect(&UsageQuery::default()))
}
