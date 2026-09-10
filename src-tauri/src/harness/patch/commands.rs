use super::{ApplyRequest, PatchPreview, PatchResult, ProposeRequest};
use crate::harness::HarnessWorkerRuntime;
use tauri::State;

#[tauri::command]
pub fn harness_patch_propose(
    runtime: State<'_, HarnessWorkerRuntime>,
    request: ProposeRequest,
) -> PatchResult<PatchPreview> {
    runtime.patch.propose(&runtime.broker, request)
}

#[tauri::command]
pub fn harness_patch_approve(
    runtime: State<'_, HarnessWorkerRuntime>,
    preview_id: String,
) -> PatchResult<String> {
    runtime.patch.approve(&preview_id)
}

#[tauri::command]
pub fn harness_patch_reject(
    runtime: State<'_, HarnessWorkerRuntime>,
    preview_id: String,
) -> PatchResult<()> {
    runtime.patch.reject(&preview_id)
}

#[tauri::command]
pub fn harness_patch_apply(
    runtime: State<'_, HarnessWorkerRuntime>,
    request: ApplyRequest,
) -> PatchResult<()> {
    runtime.patch.apply(&runtime.broker, request)
}
