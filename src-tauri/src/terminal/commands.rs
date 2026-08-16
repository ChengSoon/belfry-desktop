use tauri::{State, ipc::Channel};

use super::contracts::{
    AppError, CreateTerminalRequest, SshTarget, TerminalEvent, TerminalPalette, TerminalSession,
    TerminalSize,
};
use super::runtime::TerminalRuntime;

#[tauri::command]
pub fn terminal_create(
    runtime: State<'_, TerminalRuntime>,
    request: CreateTerminalRequest,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSession, AppError> {
    runtime.create(request, on_event)
}

#[tauri::command]
pub fn terminal_write(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    runtime.write(&session_id, &bytes)
}

#[tauri::command]
pub fn terminal_resize(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    runtime.resize(&session_id, TerminalSize { cols, rows })
}

#[tauri::command]
pub fn terminal_set_palette(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    palette: TerminalPalette,
) -> Result<(), AppError> {
    runtime.set_palette(&session_id, &palette)
}

#[tauri::command]
pub fn terminal_close(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
) -> Result<(), AppError> {
    runtime.close(&session_id)
}

/// 清除某个 SSH 目标保存的密码。没有存过也算成功，按钮点击无需区分状态。
#[tauri::command]
pub fn ssh_credentials_remove(target: SshTarget) -> Result<(), AppError> {
    super::ssh_auth::remove(&target).map_err(AppError::io)
}
