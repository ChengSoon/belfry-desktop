use tauri::{AppHandle, Manager, WebviewWindow};

use super::{
    A2aRuntime,
    contracts::{ConnectionDraft, ConnectionInfo, Discovery},
    errors::{error, storage},
    requests::Owner,
    store::Store,
    validation,
};
use crate::terminal::AppError;

pub(super) fn store(app: &AppHandle) -> Result<Store, AppError> {
    Ok(Store::native(
        app.path()
            .app_data_dir()
            .map_err(|_| storage())?
            .join("a2a"),
    ))
}

fn main_window(window: &WebviewWindow) -> Result<(), AppError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(error(
            "A2A_SETTINGS_ACCESS_DENIED",
            "A2A connection settings are available only in the main application window.",
        ))
    }
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| {
            error(
                "A2A_OPERATION_FAILED",
                "The A2A host operation could not finish.",
            )
        })?
}

#[tauri::command]
pub async fn a2a_list_connections(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
) -> Result<Vec<ConnectionInfo>, AppError> {
    main_window(&window)?;
    blocking(move || {
        let root = validation::root(&root_path)?;
        app.state::<A2aRuntime>().list(&store(&app)?, &root)
    })
    .await
}

#[tauri::command]
pub async fn a2a_save_connection(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
    draft: ConnectionDraft,
) -> Result<ConnectionInfo, AppError> {
    main_window(&window)?;
    blocking(move || {
        let root = validation::root(&root_path)?;
        app.state::<A2aRuntime>().save(&store(&app)?, &root, &draft)
    })
    .await
}

#[tauri::command]
pub async fn a2a_remove_connection(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
    connection_id: String,
) -> Result<(), AppError> {
    main_window(&window)?;
    blocking(move || {
        let root = validation::root(&root_path)?;
        app.state::<A2aRuntime>()
            .remove(&store(&app)?, &root, &connection_id)
    })
    .await
}

#[tauri::command]
pub async fn a2a_probe_connection(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
    draft: ConnectionDraft,
    request_id: String,
) -> Result<Discovery, AppError> {
    main_window(&window)?;
    validation::request_id(&request_id)?;
    blocking(move || {
        let owner = Owner::ui(validation::root(&root_path)?);
        tauri::async_runtime::block_on(app.state::<A2aRuntime>().probe(
            &store(&app)?,
            &owner,
            &draft,
            &request_id,
        ))
    })
    .await
}

#[tauri::command]
pub fn a2a_cancel_request(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
    request_id: String,
) -> Result<bool, AppError> {
    main_window(&window)?;
    let owner = Owner::ui(validation::root(&root_path)?);
    app.state::<A2aRuntime>()
        .cancel_request(&owner, &request_id)
}

#[tauri::command]
pub async fn a2a_list_local_agents(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
) -> Result<serde_json::Value, AppError> {
    main_window(&window)?;
    blocking(move || {
        let root = validation::root(&root_path)?;
        app.state::<super::local::LocalGateway>().discovery(&root)
    })
    .await
}

#[tauri::command]
pub async fn a2a_local_task_snapshot(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
) -> Result<serde_json::Value, AppError> {
    main_window(&window)?;
    blocking(move || {
        let root = validation::root(&root_path)?;
        app.state::<super::local::LocalGateway>().snapshot(&root)
    })
    .await
}
