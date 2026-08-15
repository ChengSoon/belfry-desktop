#![cfg_attr(target_os = "windows", allow(linker_messages))]
#![cfg_attr(belfry_cross_check, allow(dead_code, unused_imports))]

mod agent;
mod background;
mod history;
mod project;
mod provider;
mod resource;
mod terminal;
mod usage;

use terminal::{TerminalRuntime, commands};

#[cfg(not(belfry_cross_check))]
pub fn run() {
    use tauri::Manager;

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TerminalRuntime::with_platform_backend())
        .invoke_handler(tauri::generate_handler![
            agent::commands::agent_detect,
            background::commands::background_import,
            background::commands::background_read,
            background::commands::background_remove,
            project::commands::project_open,
            provider::commands::provider_list,
            provider::commands::provider_remove,
            provider::commands::provider_config_save,
            provider::commands::provider_config_preview,
            provider::commands::provider_sync_live,
            provider::commands::provider_save,
            provider::commands::provider_switch,
            history::commands::history_list,
            history::commands::history_delete,
            history::commands::history_clear,
            usage::commands::usage_report,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_set_palette,
            commands::terminal_close,
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
