#![cfg_attr(target_os = "windows", allow(linker_messages))]
#![cfg_attr(belfry_cross_check, allow(dead_code, unused_imports))]

mod agent;
mod project;
mod resource;
mod terminal;
mod usage;

use terminal::{TerminalRuntime, commands};

#[cfg(not(belfry_cross_check))]
pub fn run() {
    use tauri::Manager;

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(TerminalRuntime::with_platform_backend())
        .invoke_handler(tauri::generate_handler![
            agent::commands::agent_detect,
            project::commands::project_open,
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
