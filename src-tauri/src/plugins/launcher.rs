use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, Wry, plugin::TauriPlugin};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}

pub fn init() -> TauriPlugin<Wry> {
    let held = Arc::new(AtomicBool::new(false));
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, key, event| {
            if key.id() != shortcut().id() {
                return;
            }
            if event.state == ShortcutState::Released {
                held.store(false, Ordering::Release);
                return;
            }
            if held.swap(true, Ordering::AcqRel) {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                let _ = app.emit_to("main", "plugin-launcher-toggle", ());
            }
        })
        .build()
}
pub(super) fn register(app: &AppHandle) {
    let error = app
        .global_shortcut()
        .register(shortcut())
        .err()
        .map(|error| error.to_string());
    if let Ok(mut current) = app.state::<super::PluginRuntime>().launcher_error.lock() {
        *current = error;
    }
}
pub(super) fn status(app: &AppHandle) -> serde_json::Value {
    let error = app
        .state::<super::PluginRuntime>()
        .launcher_error
        .lock()
        .ok()
        .and_then(|value| value.clone());
    serde_json::json!({"registered": app.global_shortcut().is_registered(shortcut()), "error": error})
}
