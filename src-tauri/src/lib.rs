#![cfg_attr(target_os = "windows", allow(linker_messages))]
#![cfg_attr(belfry_cross_check, allow(dead_code, unused_imports))]

mod agent;
mod atomic;
mod background;
mod backup;
mod collab;
mod collaboration_protocol;
mod git;
mod history;
mod plugins;
mod project;
mod provider;
mod resource;
mod setup;
mod ssh;
mod terminal;
mod typography;
mod usage;

use terminal::{TerminalRuntime, commands};

#[cfg(not(belfry_cross_check))]
pub fn run() {
    use tauri::Manager;

    if agent::hooks::run_if_requested() {
        return;
    }
    if terminal::daemon::run_if_requested() { return; }
    setup::install_skill_on_startup();
    let identities = std::sync::Arc::new(collab::SessionIdentities::default());
    let sessions = std::sync::Arc::new(collab::SessionRegistry::default());
    let board = std::sync::Arc::new(collab::TaskBoard::default());
    // 协作是增强功能：socket 起不来（被占用、权限不足）不该让整个应用起不来。
    // 这和「Agent 检测失败不该让你打不开一个 Shell」是同一条取向。
    let endpoint = collab::CollabServer::start(identities.clone(), sessions.clone(), board.clone())
        .map(|server| server.endpoint().to_string());

    let app = tauri::Builder::default()
        .manage(plugins::PluginRuntime::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(plugins::launcher::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(terminal::daemon::lifecycle::ExitState::default())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?.join("terminal-daemon-v1");
            app.manage(TerminalRuntime::with_daemon(root));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if terminal::daemon::lifecycle::request_exit(window.app_handle()) { api.prevent_close(); }
                }
            }
        })
        .manage(history::search::HistorySearchState::default())
        .manage(history::details::HistoryDetailState::default())
        .manage(agent::hooks::HookRuntime::default())
        .manage(usage::session::SessionStatisticsState::default())
        .manage(usage::analytics::UsageAnalyticsState::default())
        .manage(ssh::SshRequests::default())
        .manage(git::worktrees::WorktreeState::default())
        .manage(collab::CollabEndpoint(endpoint))
        .manage(identities)
        .manage(sessions)
        .manage(board)
        .invoke_handler(tauri::generate_handler![
            agent::commands::agent_detect,
            agent::commands::agent_descriptors,
            agent::commands::agent_resume_plan,
            agent::hooks::commands::agent_hooks_report,
            agent::hooks::commands::agent_hooks_preview,
            agent::hooks::commands::agent_hooks_apply,
            agent::hooks::commands::agent_hooks_cancel,
            background::commands::background_import,
            background::commands::background_read,
            background::commands::background_remove,
            backup::backup_export,
            backup::backup_import,
            collaboration_protocol::collaboration_log_read,
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
            git::commands::git_status,
            git::commands::git_diff,
            git::worktrees::commands::worktree_list,
            git::worktrees::commands::worktree_preview_create,
            git::worktrees::commands::worktree_preview_action,
            git::worktrees::commands::worktree_execute,
            provider::commands::provider_list,
            provider::commands::provider_remove,
            provider::commands::provider_config_save,
            provider::commands::provider_config_preview,
            provider::commands::provider_config_preview_for_draft,
            provider::commands::provider_sync_live,
            provider::commands::provider_save,
            provider::commands::provider_switch,
            provider::project::commands::project_provider_report,
            provider::project::commands::project_provider_select,
            history::commands::history_list,
            history::commands::history_search,
            history::commands::history_cancel_search,
            history::commands::history_delete,
            history::commands::history_clear,
            history::details::commands::history_detail_open,
            history::details::commands::history_detail_next,
            history::details::commands::history_detail_close,
            usage::commands::usage_report,
            usage::analytics::commands::usage_analytics,
            usage::analytics::commands::usage_cancel_analytics,
            usage::session::commands::session_statistics,
            setup::commands::setup_diagnose,
            setup::commands::setup_install_skill,
            commands::terminal_shell_profiles,
            commands::terminal_create,
            commands::terminal_write,
            terminal::output_commands::terminal_ack_output,
            commands::terminal_resize,
            commands::terminal_set_palette,
            commands::terminal_close,
            terminal::daemon::lifecycle::terminal_exit,
            terminal::daemon::lifecycle::terminal_detach,
            terminal::daemon::lifecycle::terminal_close_tab,
            terminal::daemon::lifecycle::terminal_background_sessions,
            terminal::daemon::lifecycle::terminal_exit_pending,
            commands::ssh_credentials_remove,
            ssh::commands::ssh_aliases,
            ssh::commands::ssh_probe,
            ssh::commands::ssh_cancel_probe,
            plugins::plugins_list,
            plugins::plugins_inspect,
            plugins::plugins_cancel_preview,
            plugins::plugins_install,
            plugins::plugins_mutate,
            plugins::plugins_skill,
            plugins::runtime_commands::plugins_runtime,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Belfry desktop");
    plugins::start(app.handle());
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = &event {
            if terminal::daemon::lifecycle::request_exit(handle) { api.prevent_exit(); }
        }
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = handle.state::<TerminalRuntime>().prepare_exit(false);
            handle.state::<plugins::PluginRuntime>().stop();
        }
    });
}

#[cfg(belfry_cross_check)]
pub fn run() {}
