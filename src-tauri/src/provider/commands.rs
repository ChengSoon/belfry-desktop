use tauri::AppHandle;

use crate::agent::AgentKind;
use crate::terminal::AppError;

use super::contracts::{ProviderCatalog, ProviderDraft, SwitchOutcome};
use super::service;

#[tauri::command]
pub fn provider_list(app: AppHandle) -> Result<ProviderCatalog, AppError> {
    service::catalog(&app)
}

#[tauri::command]
pub fn provider_save(
    app: AppHandle,
    kind: AgentKind,
    draft: ProviderDraft,
) -> Result<ProviderCatalog, AppError> {
    service::save_provider(&app, kind, draft)
}

#[tauri::command]
pub fn provider_remove(
    app: AppHandle,
    kind: AgentKind,
    id: String,
) -> Result<ProviderCatalog, AppError> {
    service::remove_provider(&app, kind, id)
}

/// `id` 为 None 表示切回官方：把 Belfry 写进去的那几个字段撤掉。
#[tauri::command]
pub fn provider_switch(
    app: AppHandle,
    kind: AgentKind,
    id: Option<String>,
) -> Result<SwitchOutcome, AppError> {
    service::switch(&app, kind, id)
}
