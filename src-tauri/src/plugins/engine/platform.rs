use serde_json::{Value, json};
use std::process::Command;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

pub fn dispatch(app: &AppHandle, request: Value) -> Result<Value, String> {
    let api = request["api"].as_str().ok_or("缺少 API 名称")?;
    let args = &request["args"];
    if api.starts_with("ui.") {
        return dispatch_ui(app, &request, api);
    }
    match api {
        "models.list" | "models.resolve" => {
            crate::provider::plugin_gateway::dispatch(app, api, args)
        }
        "clipboard.readText" => super::clipboard::access(None).map(Value::String),
        "clipboard.writeText" => {
            super::clipboard::access(Some(args[0].as_str().ok_or("剪贴板文本无效")?))?;
            Ok(Value::Null)
        }
        "fs.requestDirectory" => choose_directory(app),
        "fs.pickFiles" | "browser.pickFiles" => super::surface_files::pick(app, &args[0]),
        "shell.openExternal" | "fs.openDefault" | "fs.reveal" => {
            let target = args[0].as_str().ok_or("缺少目标路径")?;
            open_external(api, target)?;
            Ok(Value::Null)
        }
        _ => Err(format!("当前桌面宿主不提供 {api}")),
    }
}
fn dispatch_ui(app: &AppHandle, request: &Value, api: &str) -> Result<Value, String> {
    match api {
        "ui.openPanel" if request["viewId"].is_string() => {
            app.emit_to("main", "plugin-view-open", &request)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "ui.openPanel" => super::windows::open(app, &request),
        "ui.closePanel" => {
            super::windows::close(app, request["pluginId"].as_str().unwrap_or(""));
            Ok(Value::Null)
        }
        "ui.showToast" => {
            app.emit_to("main", "plugin-notice", &request)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "ui.notify"
        | "ui.showNativeNotification"
        | "ui.getNotificationPermission"
        | "ui.requestNotificationPermission" => {
            super::notifications::dispatch(app, api, &request["args"])
        }
        "ui.windowControl" => super::windows::control(app, request),
        _ => Err(format!("当前桌面宿主不提供 {api}")),
    }
}
fn choose_directory(app: &AppHandle) -> Result<Value, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("选择插件可访问的目录")
        .blocking_pick_folder();
    let path = folder
        .map(|value| value.into_path().map_err(|e| e.to_string()))
        .transpose()?;
    Ok(path.map(|path| json!({"path":path, "name":path.file_name().and_then(|v| v.to_str()).unwrap_or("")})).unwrap_or(Value::Null))
}
fn open_external(api: &str, target: &str) -> Result<(), String> {
    if api == "shell.openExternal" {
        let url: tauri::Url = target.parse().map_err(|_| "URL 无效")?;
        if !["https", "http", "mailto"].contains(&url.scheme()) {
            return Err("外部链接协议不受支持".into());
        }
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut value = Command::new("/usr/bin/open");
        if api == "fs.reveal" {
            value.arg("-R");
        }
        value.arg("--").arg(target);
        value
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = Command::new("explorer.exe");
        if api == "fs.reveal" {
            value.arg("/select,");
        }
        value.arg(target);
        value
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut value = Command::new("xdg-open");
        value.arg(target);
        value
    };
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}
