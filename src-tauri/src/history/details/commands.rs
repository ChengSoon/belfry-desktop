use super::{
    HistoryDetailState,
    contracts::{DetailPage, DetailRequest},
};
use crate::terminal::AppError;

#[tauri::command]
pub async fn history_detail_open(
    state: tauri::State<'_, HistoryDetailState>,
    request: DetailRequest,
) -> Result<DetailPage, AppError> {
    state.open(request).await
}

#[tauri::command]
pub async fn history_detail_next(
    state: tauri::State<'_, HistoryDetailState>,
    reader_id: String,
    page: u32,
) -> Result<DetailPage, AppError> {
    state.next(reader_id, page).await
}

#[tauri::command]
pub fn history_detail_close(state: tauri::State<'_, HistoryDetailState>, reader_id: String) {
    state.close(&reader_id);
}
