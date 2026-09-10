use super::{PluginRuntime, with_host};
use crate::terminal::AppError;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewWindow};

const ALLOWED_METHODS: &[&str] = &[
    "catalog",
    "context",
    "command",
    "tool",
    "skill",
    "panel",
    "surface",
    "surface.drop",
    "settings.get",
    "settings.set",
    "author.scaffold",
    "author.check",
    "author.pack",
    "author.create",
    "management.get",
    "management.plugin",
    "management.source",
    "market.search",
    "market.refresh",
    "market.detail",
    "market.inspect",
    "market.install",
    "market.updates",
    "market.applyUpdates",
    "desktop.openExternal",
    "desktop.reveal",
    "market.personal.info",
    "market.personal.configure",
    "market.personal.publish",
    "market.personal.export",
    "clipboard.capture.text",
    "clipboard.capture.begin",
    "clipboard.capture.chunk",
    "clipboard.capture.finish",
    "clipboard.capture.cancel",
];

pub(super) fn main_window(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::io("插件管理仅允许主窗口调用"))
    }
}
pub(super) async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|e| AppError::io(e.to_string()))?
}
#[tauri::command]
pub async fn plugins_runtime(
    window: WebviewWindow,
    method: String,
    params: Option<Value>,
) -> Result<Value, AppError> {
    main_window(&window)?;
    let app = window.app_handle().clone();
    if method == "launcher.status" {
        return Ok(super::launcher::status(&app));
    }
    if !ALLOWED_METHODS.contains(&method.as_str()) {
        return Err(AppError::io("不允许的插件宿主方法"));
    }
    blocking(move || {
        synchronize(&app, &method)?;
        let params = params.unwrap_or_else(|| json!({}));
        dispatch_request(&app, &method, params)
    })
    .await
}
fn synchronize(app: &AppHandle, method: &str) -> Result<(), AppError> {
    if ["context", "surface.drop"].contains(&method) || method.starts_with("clipboard.capture.") {
        return Ok(());
    }
    let state = app.state::<PluginRuntime>();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| AppError::io("插件操作锁不可用"))?;
    let registry = with_host(app, |host| host.list())?;
    let _ = state.engine.synchronize(app, &registry);
    state
        .engine
        .request(
            app,
            "management.sync",
            super::market_commands::registry_metadata(&registry),
        )
        .map_err(AppError::io)?;
    Ok(())
}
fn dispatch_request(app: &AppHandle, method: &str, params: Value) -> Result<Value, AppError> {
    match method {
        "market.inspect" => return super::market_commands::inspect(app, params),
        "market.install" => return super::market_commands::install(app, params),
        "market.applyUpdates" => return super::market_commands::apply_updates(app),
        "author.create" => return super::author_commands::create(app, params),
        "desktop.openExternal" | "desktop.reveal" => {
            return super::market_commands::desktop(app, method, params);
        }
        _ => {}
    }
    request_engine(app, method, params)
}
fn request_engine(app: &AppHandle, method: &str, params: Value) -> Result<Value, AppError> {
    match app
        .state::<PluginRuntime>()
        .engine
        .request(app, method, params)
    {
        Ok(value) => Ok(value),
        Err(error) if method == "catalog" => Ok(
            json!({"available":false, "error":error, "commands":[], "tools":[], "skills":[], "themes":[], "views":[], "services":[], "plugins":[], "errors":{}}),
        ),
        Err(error) => Err(AppError::io(error)),
    }
}
pub fn start(app: &AppHandle) {
    super::launcher::register(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<PluginRuntime>();
        if let Ok(_operation) = state.operations.lock() {
            if let Ok(registry) = with_host(&app, |host| host.list()) {
                let _ = state.engine.synchronize(&app, &registry);
            }
        }
    });
}
