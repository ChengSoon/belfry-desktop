use super::UsageAnalyticsState;
use super::contracts::AnalyticsReport;
use crate::usage::contracts::UsageQuery;
use crate::terminal::AppError;

#[tauri::command]
pub async fn usage_analytics(
    state: tauri::State<'_, UsageAnalyticsState>,
    query: UsageQuery,
    request_id: Option<String>,
) -> Result<AnalyticsReport, AppError> {
    query_analytics(&state, query, request_id).await
}

#[tauri::command]
pub fn usage_cancel_analytics(
    state: tauri::State<'_, UsageAnalyticsState>,
    request_id: String,
) -> Result<(), AppError> {
    cancel_analytics(&state, &request_id)
}

async fn query_analytics(state: &UsageAnalyticsState, query: UsageQuery, request_id: Option<String>) -> Result<AnalyticsReport, AppError> {
    state.query(query, request_id).await.map_err(AppError::io)
}

fn cancel_analytics(state: &UsageAnalyticsState, request_id: &str) -> Result<(), AppError> {
    state.cancel(request_id).map_err(AppError::io)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regression_analytics_command_errors_use_the_shared_wire_contract() {
        let state = UsageAnalyticsState::default();
        let queried = tauri::async_runtime::block_on(query_analytics(&state, UsageQuery::default(), Some(" ".into()))).unwrap_err();
        let cancelled = cancel_analytics(&state, " ").unwrap_err();
        for error in [queried, cancelled] {
            let wire = serde_json::to_value(error).unwrap();
            assert_eq!(wire["code"], "USAGE_THE_USAGE_REQUEST_ID_IS_INVALID");
            assert_eq!(wire["message"], "The usage request ID is invalid.");
        }
    }
}
