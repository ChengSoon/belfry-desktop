#![cfg_attr(target_os = "windows", allow(linker_messages))]
#![cfg_attr(belfry_cross_check, allow(dead_code, unused_imports))]

mod agent;
mod atomic;
mod background;
mod collab;
mod history;
mod project;
mod provider;
mod resource;
mod terminal;
mod typography;
mod usage;

use terminal::{TerminalRuntime, commands};

#[cfg(not(belfry_cross_check))]
pub fn run() {
    use tauri::Manager;

    let identities = std::sync::Arc::new(collab::SessionIdentities::default());
    let sessions = std::sync::Arc::new(collab::SessionRegistry::default());
    let board = std::sync::Arc::new(collab::TaskBoard::default());
    // 协作是增强功能：socket 起不来（被占用、权限不足）不该让整个应用起不来。
    // 这和「Agent 检测失败不该让你打不开一个 Shell」是同一条取向。
    let endpoint = collab::CollabServer::start(identities.clone(), sessions.clone(), board.clone())
        .map(|server| server.endpoint().to_string());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TerminalRuntime::with_platform_backend())
        .manage(collab::CollabEndpoint(endpoint))
        .manage(identities)
        .manage(sessions)
        .manage(board)
        .invoke_handler(tauri::generate_handler![
            agent::commands::agent_detect,
            agent::commands::agent_descriptors,
            agent::commands::agent_resume_plan,
            background::commands::background_import,
            background::commands::background_read,
            background::commands::background_remove,
            collab::commands::context_list,
            collab::commands::context_put,
            collab::commands::context_get,
            collab::commands::context_remove,
            collab::commands::context_set_pinned,
            collab::commands::collab_sync_sessions,
            collab::commands::collab_pending_tasks,
            collab::commands::collab_mark_dispatched,
            collab::commands::collab_tasks,
            collab::commands::collab_approve,
            collab::commands::collab_reject,
            collab::commands::collab_stop_all,
            typography::commands::font_import,
            typography::commands::font_read,
            typography::commands::font_remove,
            project::commands::project_open,
            project::commands::project_list_directory,
            project::commands::project_read_file,
            provider::commands::provider_list,
            provider::commands::provider_remove,
            provider::commands::provider_config_save,
            provider::commands::provider_config_preview,
            provider::commands::provider_config_preview_for_draft,
            provider::commands::provider_sync_live,
            provider::commands::provider_save,
            provider::commands::provider_switch,
            history::commands::history_list,
            history::commands::history_delete,
            history::commands::history_clear,
            usage::commands::usage_report,
            commands::terminal_shell_profiles,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_set_palette,
            commands::terminal_close,
            commands::ssh_credentials_remove,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Belfry desktop");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            handle.state::<TerminalRuntime>().close_all();
        }
    });
}

#[cfg(belfry_cross_check)]
pub fn run() {}
