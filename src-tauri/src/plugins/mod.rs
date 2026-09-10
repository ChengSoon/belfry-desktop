pub mod agent_connection;
mod agent_context;
mod author_commands;
#[cfg(test)]
mod compatibility_tests;
mod engine;
mod files;
mod host;
mod install;
pub mod launcher;
mod manifest;
mod market_commands;
mod owner;
mod package;
#[cfg(test)]
mod package_boundary_tests;
#[cfg(test)]
mod package_test_support;
#[cfg(test)]
mod package_tests;
mod paths;
mod pi_engine;
mod pi_fields;
mod pi_manifest;
#[cfg(test)]
mod pi_manifest_tests;
mod pi_mcp;
mod pi_validation;
pub mod runtime_commands;
pub use runtime_commands::start;
mod store;
mod strict_json;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod update_tests;
mod zip;
use crate::terminal::AppError;
use host::{PluginHost, Preview};
use std::{path::PathBuf, sync::Mutex};
use store::PluginRegistry;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct PluginRuntime {
    host: Mutex<Option<PluginHost>>,
    operations: Mutex<()>,
    engine: engine::Engine,
    sessions: Mutex<std::collections::HashMap<String, String>>,
    launcher_error: Mutex<Option<String>>,
    market_previews: Mutex<std::collections::HashMap<String, market_commands::PreparedMarket>>,
}
impl PluginRuntime {
    pub fn stop(&self) {
        self.engine.stop();
    }
}
fn with_host<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut PluginHost) -> Result<T, String>,
) -> Result<T, AppError> {
    let state = app.state::<PluginRuntime>();
    let mut guard = state
        .host
        .lock()
        .map_err(|_| AppError::io("插件宿主锁不可用"))?;
    if guard.is_none() {
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::io(e.to_string()))?
            .join("plugins");
        *guard = Some(PluginHost::new(base));
    }
    operation(
        guard
            .as_mut()
            .ok_or_else(|| AppError::io("插件宿主不可用"))?,
    )
    .map_err(AppError::io)
}
#[tauri::command]
pub async fn plugins_list(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PluginRegistry, AppError> {
    runtime_commands::main_window(&window)?;
    runtime_commands::blocking(move || {
        let state = app.state::<PluginRuntime>();
        let _operation = state
            .operations
            .lock()
            .map_err(|_| AppError::io("插件操作锁不可用"))?;
        let registry = with_host(&app, |host| host.list())?;
        let _ = state.engine.synchronize(&app, &registry);
        Ok(registry)
    })
    .await
}
#[tauri::command]
pub async fn plugins_inspect(
    app: AppHandle,
    window: tauri::WebviewWindow,
    path: PathBuf,
    development: bool,
) -> Result<Preview, AppError> {
    runtime_commands::main_window(&window)?;
    runtime_commands::blocking(move || with_host(&app, |host| host.inspect(&path, development)))
        .await
}
#[tauri::command]
pub fn plugins_cancel_preview(
    app: AppHandle,
    window: tauri::WebviewWindow,
    preview_id: String,
) -> Result<(), AppError> {
    runtime_commands::main_window(&window)?;
    with_host(&app, |host| {
        host.cancel(&preview_id);
        Ok(())
    })
    .inspect(|_| market_commands::cancel(&app, &preview_id))
}
#[tauri::command]
pub async fn plugins_install(
    app: AppHandle,
    window: tauri::WebviewWindow,
    preview_id: String,
    expected_revision: String,
) -> Result<PluginRegistry, AppError> {
    runtime_commands::main_window(&window)?;
    runtime_commands::blocking(move || {
        let state = app.state::<PluginRuntime>();
        let _operation = state
            .operations
            .lock()
            .map_err(|_| AppError::io("插件操作锁不可用"))?;
        let id = with_host(&app, |host| {
            host::check_revision(&host.store().load()?, &expected_revision)?;
            host.previews
                .get(&preview_id)
                .map(|pending| pending.snapshot.manifest.id.clone())
                .ok_or("预览不存在".into())
        })?;
        state.engine.unload(&app, &id).map_err(AppError::io)?;
        let result = with_host(&app, |host| {
            host.install_with_options(
                (&preview_id, &expected_revision),
                install::InstallOptions {
                    replace: true,
                    enabled: false,
                },
            )
        });
        if let Ok(registry) = with_host(&app, |host| host.list()) {
            let _ = state.engine.synchronize(&app, &registry);
        }
        let _ = app.emit_to("main", "plugins-changed", ());
        result
    })
    .await
}
#[tauri::command]
pub async fn plugins_mutate(
    app: AppHandle,
    window: tauri::WebviewWindow,
    plugin_id: String,
    action: String,
    expected_revision: String,
) -> Result<PluginRegistry, AppError> {
    runtime_commands::main_window(&window)?;
    runtime_commands::blocking(move || {
        let state = app.state::<PluginRuntime>();
        let _operation = state
            .operations
            .lock()
            .map_err(|_| AppError::io("插件操作锁不可用"))?;
        with_host(&app, |host| {
            host::check_revision(&host.store().load()?, &expected_revision)
        })?;
        if ["disable", "reload", "uninstall"].contains(&action.as_str()) {
            state
                .engine
                .unload(&app, &plugin_id)
                .map_err(AppError::io)?;
        }
        let result = with_host(&app, |host| {
            host.mutate(&plugin_id, &action, &expected_revision)
        });
        if let Ok(registry) = with_host(&app, |host| host.list()) {
            let _ = state.engine.synchronize(&app, &registry);
        }
        let _ = app.emit_to("main", "plugins-changed", ());
        result
    })
    .await
}
#[tauri::command]
pub fn plugins_skill(
    app: AppHandle,
    window: tauri::WebviewWindow,
    plugin_id: String,
    skill_id: String,
) -> Result<String, AppError> {
    runtime_commands::main_window(&window)?;
    with_host(&app, |host| {
        let registry = host.list()?;
        let entry = registry
            .plugins
            .iter()
            .find(|e| e.enabled && e.manifest.id == plugin_id)
            .ok_or("插件未启用")?;
        let snapshot = host.snapshot_entry(entry)?;
        if snapshot.manifest != entry.manifest {
            return Err("插件已变化，请刷新".into());
        }
        let skill = snapshot
            .manifest
            .contributes
            .skills
            .iter()
            .find(|s| s.id == skill_id)
            .ok_or("Skill 不存在")?;
        String::from_utf8(
            snapshot
                .files
                .get(&skill.path)
                .ok_or("Skill 文件不存在")?
                .clone(),
        )
        .map_err(|e| e.to_string())
    })
}
