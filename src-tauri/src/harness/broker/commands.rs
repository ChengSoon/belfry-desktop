use super::{BrokerResult, SessionRegistration, ToolRequest};
use crate::harness::HarnessWorkerRuntime;
use tauri::State;

#[tauri::command]
pub fn harness_broker_register(
    runtime: State<'_, HarnessWorkerRuntime>,
    registration: SessionRegistration,
) -> Result<(), super::BrokerError> {
    runtime.broker.register(registration)
}

#[tauri::command]
pub fn harness_broker_update_grants(
    runtime: State<'_, HarnessWorkerRuntime>,
    session_id: String,
    grants: Vec<String>,
) -> Result<(), super::BrokerError> {
    runtime.broker.update_grants(&session_id, grants)
}

#[tauri::command]
pub fn harness_broker_cancel(
    runtime: State<'_, HarnessWorkerRuntime>,
    session_id: String,
) -> Result<(), super::BrokerError> {
    runtime.broker.cancel(&session_id)
}

#[tauri::command]
pub fn harness_broker_handle(
    runtime: State<'_, HarnessWorkerRuntime>,
    worker_id: String,
    request: ToolRequest,
) -> BrokerResult {
    runtime.broker.handle(&worker_id, request)
}
