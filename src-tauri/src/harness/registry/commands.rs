use super::{PluginDefinition, RegistryError, RegistryResult, RegistryState, SessionSnapshot};
use crate::harness::HarnessWorkerRuntime;
use tauri::State;

#[tauri::command]
pub fn harness_registry_list(
    runtime: State<'_, HarnessWorkerRuntime>,
) -> RegistryResult<RegistryState> {
    runtime.registry.list()
}
#[tauri::command]
pub fn harness_registry_install(
    runtime: State<'_, HarnessWorkerRuntime>,
    expected_revision: String,
    plugin: PluginDefinition,
) -> RegistryResult<RegistryState> {
    runtime.registry.install(&expected_revision, plugin)
}
#[tauri::command]
pub fn harness_registry_update(
    runtime: State<'_, HarnessWorkerRuntime>,
    expected_revision: String,
    plugin: PluginDefinition,
) -> RegistryResult<RegistryState> {
    runtime.registry.update(&expected_revision, plugin)
}
#[tauri::command]
pub fn harness_registry_disable(
    runtime: State<'_, HarnessWorkerRuntime>,
    expected_revision: String,
    plugin_id: String,
) -> RegistryResult<RegistryState> {
    runtime.registry.disable(&expected_revision, &plugin_id)
}
#[tauri::command]
pub fn harness_registry_uninstall(
    runtime: State<'_, HarnessWorkerRuntime>,
    expected_revision: String,
    plugin_id: String,
) -> RegistryResult<RegistryState> {
    runtime.registry.uninstall(&expected_revision, &plugin_id)
}
#[tauri::command]
pub fn harness_session_snapshot(
    runtime: State<'_, HarnessWorkerRuntime>,
    session_id: String,
    agent_id: String,
    plugin_id: String,
    worker_id: String,
    project_root: String,
) -> RegistryResult<SessionSnapshot> {
    runtime
        .registry
        .snapshot(session_id, agent_id, &plugin_id, worker_id, project_root)
}
#[tauri::command]
pub fn harness_session_authorize(
    runtime: State<'_, HarnessWorkerRuntime>,
    session_id: String,
    grants: Vec<String>,
) -> RegistryResult<SessionSnapshot> {
    runtime.registry.authorize(&session_id, grants)
}

#[tauri::command]
pub fn harness_session_worker_start(
    runtime: State<'_, HarnessWorkerRuntime>,
    session_id: String,
) -> Result<String, RegistryError> {
    let launch = runtime.registry.worker_launch(&session_id)?;
    runtime
        .manager
        .start_registered(launch.worker_id, &launch.executable, &launch.args)
        .map_err(|_| RegistryError::new("WORKER_START_FAILED", "worker could not start"))
}

#[tauri::command]
pub fn harness_registry_install_preview(
    runtime: State<'_, HarnessWorkerRuntime>,
    manifest_path: String,
    worker_path: String,
) -> RegistryResult<super::install::InstallPreview> {
    runtime.registry.preview_install(manifest_path, worker_path)
}

#[tauri::command]
pub fn harness_registry_install_commit(
    runtime: State<'_, HarnessWorkerRuntime>,
    preview_id: String,
) -> RegistryResult<RegistryState> {
    runtime.registry.commit_install(&preview_id)
}

#[tauri::command]
pub fn harness_registry_install_cancel(
    runtime: State<'_, HarnessWorkerRuntime>,
    preview_id: String,
) -> RegistryResult<()> {
    runtime.registry.cancel_install(&preview_id)
}
