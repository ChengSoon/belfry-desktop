use super::{ApprovalRequired, CommandResult, ExecRequest, ExecResult};
use crate::harness::HarnessWorkerRuntime;
use tauri::State;

#[tauri::command]
pub fn harness_command_request(
    runtime: State<'_, HarnessWorkerRuntime>,
    request: ExecRequest,
) -> CommandResult<ApprovalRequired> {
    runtime.command.request(&runtime.registry, request)
}
#[tauri::command]
pub fn harness_command_approve(
    runtime: State<'_, HarnessWorkerRuntime>,
    approval_id: String,
) -> CommandResult<String> {
    runtime.command.approve(&approval_id)
}
#[tauri::command]
pub fn harness_command_reject(
    runtime: State<'_, HarnessWorkerRuntime>,
    approval_id: String,
) -> CommandResult<()> {
    runtime.command.reject(&approval_id)
}
#[tauri::command]
pub fn harness_command_execute(
    runtime: State<'_, HarnessWorkerRuntime>,
    approval_id: String,
    approval_token: String,
) -> CommandResult<ExecResult> {
    runtime
        .command
        .execute(&runtime.registry, &approval_id, &approval_token)
}
#[tauri::command]
pub fn harness_command_cancel(
    runtime: State<'_, HarnessWorkerRuntime>,
    session_id: String,
) -> CommandResult<()> {
    runtime
        .registry
        .cancel_session(&session_id)
        .map_err(|_| super::CommandError::new("SESSION_NOT_FOUND", "session not found"))?;
    runtime.command.cancel_session(&session_id);
    Ok(())
}
