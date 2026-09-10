use serde_json::{Value, json};
use std::hash::{Hash, Hasher};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn prefix(id: &str) -> String {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut hash);
    format!("plugin-{:016x}-", hash.finish())
}
pub fn close(app: &AppHandle, id: &str) {
    let prefix = prefix(id);
    for (label, window) in app.webview_windows() {
        if label.starts_with(&prefix) {
            let _ = window.destroy();
        }
    }
}
pub fn open(app: &AppHandle, request: &Value) -> Result<Value, String> {
    let id = request["pluginId"].as_str().ok_or("缺少插件 ID")?;
    let (url, path_prefix) = panel_url(request)?;
    let origin = url.origin();
    let label = format!(
        "{}{}",
        prefix(id),
        prefix(request["viewId"].as_str().unwrap_or("panel"))
    );
    if let Some(window) = app.get_webview_window(&label) {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(request["title"].as_str().unwrap_or("插件"))
        .decorations(false)
        .inner_size(
            request["width"]
                .as_f64()
                .unwrap_or(640.0)
                .clamp(320.0, 1600.0),
            request["height"]
                .as_f64()
                .unwrap_or(480.0)
                .clamp(240.0, 1200.0),
        )
        .min_inner_size(320.0, 240.0)
        .on_navigation(move |target| {
            target.origin() == origin && target.path().starts_with(&path_prefix)
        })
        .build()
        .map_err(|e| e.to_string())?;
    super::surface_files::watch(&window, id);
    Ok(json!(null))
}
pub(super) fn control(app: &AppHandle, request: &Value) -> Result<Value, String> {
    let id = request["pluginId"].as_str().ok_or("缺少插件 ID")?;
    let label = format!("{}{}", prefix(id), prefix("panel"));
    let window = app.get_webview_window(&label).ok_or("插件窗口未打开")?;
    let action = request["args"][0]["action"]
        .as_str()
        .ok_or("缺少窗口动作")?;
    let result = match action {
        "minimize" => window.minimize(),
        "maximize" | "toggleMaximize" => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        "drag" => window.start_dragging(),
        _ => return Err("窗口动作无效".into()),
    };
    result.map_err(|e| e.to_string())?;
    Ok(json!({"maximized": window.is_maximized().unwrap_or(false)}))
}
fn panel_url(request: &Value) -> Result<(tauri::Url, String), String> {
    let url: tauri::Url = request["url"]
        .as_str()
        .ok_or("缺少面板 URL")?
        .parse()
        .map_err(|_| "面板 URL 无效")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("面板只允许访问宿主本地资源".into());
    }
    let segments = url
        .path_segments()
        .ok_or("面板路径无效")?
        .collect::<Vec<_>>();
    if segments.len() < 3
        || segments[0] != "p"
        || segments[1].len() != 64
        || !segments[1].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("面板资源令牌无效".into());
    }
    let path_prefix = format!("/p/{}/", segments[1]);
    Ok((url, path_prefix))
}
