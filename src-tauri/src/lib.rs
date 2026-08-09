#![cfg_attr(otty_cross_check, allow(dead_code, unused_imports))]

mod agent;
mod project;
mod resource;
mod terminal;
mod usage;

use terminal::{TerminalRuntime, commands};

#[cfg(not(otty_cross_check))]
pub fn run() {
    use tauri::Manager;

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(TerminalRuntime::with_platform_backend())
        .invoke_handler(tauri::generate_handler![
            agent::commands::agent_detect,
            project::commands::project_open,
            usage::commands::usage_report,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build OTTY desktop");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            handle.state::<TerminalRuntime>().close_all();
        }
    });
}

#[cfg(otty_cross_check)]
pub fn run() {}
