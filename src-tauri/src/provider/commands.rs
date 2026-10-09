use tauri::AppHandle;

use crate::agent::AgentKind;
use crate::terminal::AppError;

use super::contracts::{ConfigFilePreview, ProviderCatalog, ProviderDraft, SwitchOutcome};
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

/// 当前生效的配置文件原文（只读）。Claude Code 是 settings.json；
/// Codex 是 config.toml + auth.json。
#[tauri::command]
pub fn provider_config_preview(
    kind: AgentKind,
    reveal_secrets: Option<bool>,
) -> Result<Vec<ConfigFilePreview>, AppError> {
    service::config_files(kind, reveal_secrets.unwrap_or(false))
}

/// 根据正在编辑的 Provider 草稿生成内存预览，不写入实际配置文件。
#[tauri::command]
pub fn provider_config_preview_for_draft(
    app: AppHandle,
    kind: AgentKind,
    draft: ProviderDraft,
    reveal_secrets: Option<bool>,
) -> Result<Vec<ConfigFilePreview>, AppError> {
    service::config_files_for_draft(&app, kind, draft, reveal_secrets.unwrap_or(false))
}

/// 保存用户在界面上编辑后的配置文件全文。路径白名单与格式校验在服务端，
/// 校验失败时原文件保持不动。
#[tauri::command]
pub fn provider_config_save(
    app: AppHandle,
    kind: AgentKind,
    path: String,
    content: String,
) -> Result<(), AppError> {
    service::save_config_file(&app, kind, path, content)
}

/// 配置文件被手动编辑后，把当前生效的 live 配置同步进库并返回新目录。
#[tauri::command]
pub fn provider_sync_live(app: AppHandle, kind: AgentKind) -> Result<ProviderCatalog, AppError> {
    service::sync_live(&app, kind)
}

/// 读取草稿端点公布的模型，不修改 Provider 或 CLI 配置。
#[tauri::command]
pub async fn provider_models(
    app: AppHandle,
    kind: AgentKind,
    draft: ProviderDraft,
) -> Result<Vec<String>, AppError> {
    let api_key = service::draft_api_key(&app, kind, &draft)?;
    super::models::fetch(kind, &draft.base_url, &api_key).await
}
