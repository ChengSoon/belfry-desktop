use serde_json::{Value, json};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub(super) fn watch(window: &WebviewWindow, plugin_id: &str) {
    let app = window.app_handle().clone();
    let source = window.clone();
    let plugin_id = plugin_id.to_owned();
    window.on_webview_event(move |event| {
        let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) = event else { return; };
        let paths = paths.clone();
        let scale = source.scale_factor().unwrap_or(1.0);
        let position = json!({"x": position.x / scale, "y": position.y / scale});
        let app = app.clone();
        let plugin_id = plugin_id.clone();
        std::thread::spawn(move || {
            let state = app.state::<super::super::PluginRuntime>();
            let _ = state.engine.request(&app, "surface.drop", json!({"pluginId": plugin_id, "paths": paths, "position": position, "surfaceId": "panel"}));
        });
    });
}

pub(super) fn pick(app: &AppHandle, options: &Value) -> Result<Value, String> {
    let mut dialog = app.dialog().file().set_title("选择文件");
    let extensions: Vec<_> = options["accept"]
        .as_str()
        .unwrap_or("")
        .split(',')
        .filter_map(|part| part.trim().strip_prefix('.'))
        .filter(|part| {
            !part.is_empty() && part.len() < 16 && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
        .collect();
    if !extensions.is_empty() {
        dialog = dialog.add_filter("文件", &extensions);
    }
    let selected = if options["directory"] == true {
        dialog.blocking_pick_folder().into_iter().collect()
    } else if options["multiple"] == true {
        dialog.blocking_pick_files().unwrap_or_default()
    } else {
        dialog.blocking_pick_file().into_iter().collect()
    };
    let paths = selected
        .into_iter()
        .take(128)
        .map(|path| path.into_path().map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!(paths))
}
