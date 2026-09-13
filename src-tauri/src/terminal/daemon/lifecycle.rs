use crate::terminal::{AppError, TerminalRuntime};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct ExitState {
    approved: AtomicBool,
    asking: AtomicBool,
}

pub fn request_exit(app: &AppHandle) -> bool {
    let state = app.state::<ExitState>();
    if state.approved.load(Ordering::Acquire) {
        return false;
    }
    if !state.asking.swap(true, Ordering::AcqRel) {
        let _ = app.emit_to("main", "terminal-exit-requested", ());
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    true
}

#[tauri::command]
pub async fn terminal_exit(app: AppHandle, choice: String) -> Result<(), AppError> {
    if choice == "cancel" {
        app.state::<ExitState>()
            .asking
            .store(false, Ordering::Release);
        return Ok(());
    }
    if choice != "retain" && choice != "terminate" {
        return Err(AppError::invalid_argument("退出选择无效"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<TerminalRuntime>()
            .prepare_exit(choice == "terminate")?;
        app.state::<ExitState>()
            .approved
            .store(true, Ordering::Release);
        app.exit(0);
        Ok(())
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub fn terminal_detach(
    runtime: tauri::State<'_, TerminalRuntime>,
    session_id: String,
    connection_id: String,
) {
    runtime.detach(&session_id, &connection_id);
}

#[tauri::command]
pub async fn terminal_close_tab(app: AppHandle, tab_id: String) -> Result<(), AppError> {
    app.state::<TerminalRuntime>().cancel_pending(&tab_id);
    tauri::async_runtime::spawn_blocking(move || {
        let ids = app.state::<TerminalRuntime>().close_tab(&tab_id)?;
        for id in ids {
            crate::plugins::agent_connection::release(&app, &id);
        }
        Ok(())
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub async fn terminal_background_sessions(
    app: AppHandle,
) -> Result<Vec<super::SessionInfo>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<TerminalRuntime>().background_sessions()
    })
    .await
    .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub fn terminal_exit_pending(state: tauri::State<'_, ExitState>) -> bool {
    state.asking.load(Ordering::Acquire)
}
