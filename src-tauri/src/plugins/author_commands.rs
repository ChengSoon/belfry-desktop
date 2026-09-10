use super::{PluginRuntime, install::InstallOptions, with_host};
use crate::terminal::AppError;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

pub(super) fn create(app: &AppHandle, params: Value) -> Result<Value, AppError> {
    let template = params["template"]
        .as_str()
        .filter(|id| ["panel-basic", "agent-tool-basic", "skill-pack", "full-demo"].contains(id))
        .ok_or_else(|| AppError::io("未知插件模板"))?;
    let folder = app
        .dialog()
        .file()
        .set_title("为新插件选择一个空文件夹")
        .blocking_pick_folder();
    let Some(folder) = folder else {
        return Ok(json!({"canceled":true}));
    };
    let path = folder
        .into_path()
        .map_err(|e| AppError::io(e.to_string()))?;
    let state = app.state::<PluginRuntime>();
    let mut input = json!({"directory":path,"template":template});
    for key in ["id", "name", "author"] {
        if params[key]
            .as_str()
            .is_some_and(|value| !value.trim().is_empty())
        {
            input[key] = params[key].clone();
        }
    }
    let created = state
        .engine
        .request(app, "author.scaffold", input)
        .map_err(AppError::io)?;
    load_created(app, &path)?;
    Ok(json!({"directory":path,"name":created["manifest"]["name"]}))
}
fn load_created(app: &AppHandle, path: &std::path::Path) -> Result<(), AppError> {
    let state = app.state::<PluginRuntime>();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| AppError::io("插件操作锁不可用"))?;
    let registry = with_host(app, |host| {
        let current = host.list()?;
        let preview = host.inspect(path, true)?;
        host.install_with_options(
            (&preview.preview_id, &current.revision),
            InstallOptions {
                enabled: true,
                replace: false,
            },
        )
    })?;
    state
        .engine
        .synchronize(app, &registry)
        .map_err(AppError::io)?;
    let _ = app.emit_to("main", "plugins-changed", ());
    Ok(())
}
