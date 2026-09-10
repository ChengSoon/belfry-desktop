use serde_json::Value;
use tauri::State;

use super::HarnessWorkerRuntime;
use super::{AuditPage, AuditQuery};

#[tauri::command]
pub fn harness_audit_query(
    runtime: State<'_, HarnessWorkerRuntime>,
    query: AuditQuery,
) -> Result<AuditPage, crate::harness::registry::RegistryError> {
    let session_id = query.session_id.as_deref().ok_or_else(|| {
        crate::harness::registry::RegistryError::new(
            "AUDIT_SCOPE_REQUIRED",
            "audit session scope is required",
        )
    })?;
    let session = runtime.registry.session(session_id).ok_or_else(|| {
        crate::harness::registry::RegistryError::new(
            "AUDIT_SCOPE_DENIED",
            "audit session is unavailable",
        )
    })?;
    if session.cancelled
        || !session.resumable
        || query
            .worker_id
            .as_ref()
            .is_some_and(|worker| worker != &session.worker_id)
        || query
            .plugin_id
            .as_ref()
            .is_some_and(|plugin| plugin != &session.plugin.plugin_id)
        || query
            .version
            .as_ref()
            .is_some_and(|version| version != &session.plugin.version)
    {
        return Err(crate::harness::registry::RegistryError::new(
            "AUDIT_SCOPE_DENIED",
            "audit scope is unavailable",
        ));
    }
    Ok(runtime.audit.query(&query))
}

#[tauri::command]
pub fn harness_worker_start(
    runtime: State<'_, HarnessWorkerRuntime>,
    entry: String,
    args: Vec<String>,
) -> Result<String, String> {
    runtime.manager.start(&entry, &args)
}

#[tauri::command]
pub fn harness_worker_send(
    runtime: State<'_, HarnessWorkerRuntime>,
    worker_id: String,
    request: Value,
) -> Result<(), String> {
    runtime.manager.send(&worker_id, &request)
}

#[tauri::command]
pub fn harness_worker_stop(
    runtime: State<'_, HarnessWorkerRuntime>,
    worker_id: String,
) -> Result<(), String> {
    runtime.manager.stop(&worker_id)
}
