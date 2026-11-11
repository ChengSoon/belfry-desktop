#![cfg_attr(target_os = "windows", allow(linker_messages))]
#![cfg_attr(belfry_cross_check, allow(dead_code, unused_imports))]

mod agent;
mod atomic;
mod background;
mod backup;
mod external;
mod collab;
mod collaboration_protocol;
mod git;
mod history;
mod i18n;
mod logging;
mod plugins;
mod project;
mod provider;
mod resource;
mod rooms;
mod setup;
mod ssh;
mod terminal;
mod typography;
mod usage;

use terminal::{TerminalRuntime, commands};

#[cfg(not(belfry_cross_check))]
pub fn run() {
    use tauri::Manager;

    let context = tauri::generate_context!();
    logging::init(&context.config().identifier);
    i18n::initialize(&context.config().identifier);
    if agent::hooks::run_if_requested() {
        return;
    }
    if terminal::daemon::run_if_requested() { return; }
    setup::install_skill_on_startup();
    let identities = std::sync::Arc::new(collab::SessionIdentities::default());
    let sessions = std::sync::Arc::new(collab::SessionRegistry::default());
    let board = std::sync::Arc::new(collab::TaskBoard::load(dirs::data_dir().map(|root| root.join(&context.config().identifier).join("collab"))));
    // 房间目录先挂空位：服务线程在 setup 之前就要起来，而房间存储要等 app
    // 句柄才拿得到路径；装载完成后挂进去，晚到的请求自动看到真实数据。
    let room_access = std::sync::Arc::new(collab::RoomAccess::default());
    let sessions_for_rooms = sessions.clone();
    let board_for_inbox = board.clone();
    // 协作是增强功能：socket 起不来（被占用、权限不足）不该让整个应用起不来。
    // 这和「Agent 检测失败不该让你打不开一个 Shell」是同一条取向。
    let endpoint = collab::CollabServer::start(
        identities.clone(),
        sessions.clone(),
        board.clone(),
        room_access.clone(),
    )
    .map(|server| server.endpoint().to_string());

    let app = tauri::Builder::default()
        .manage(plugins::PluginRuntime::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(plugins::launcher::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(terminal::daemon::lifecycle::ExitState::default())
        .setup(move |app| {
            let root = app.path()
                .app_local_data_dir()?
                .join(terminal::daemon::directory_name());
            app.manage(TerminalRuntime::with_daemon(root));
            // 房间存储跟着应用数据目录走；读不出来也不让应用起不来——命令层会把
            // 原因原样报给界面，且存储不可写时拒绝修改，不覆盖现场。
            let rooms_root = app.path().app_data_dir().ok().map(|dir| dir.join("rooms"));
            let rooms = std::sync::Arc::new(rooms::RoomStore::load(rooms_root));
            let inbox = std::sync::Arc::new(collab::inbox::InboxService::load(
                app.path().app_data_dir().ok().map(|dir| dir.join("collab")), rooms.clone(), board_for_inbox.clone(), sessions_for_rooms.clone(),
                app.state::<TerminalRuntime>().input_gate.clone()));
            room_access.set(rooms::inbox_directory(rooms.clone(), sessions_for_rooms.clone(), inbox.clone()));
            collab::inbox::InboxService::start(&inbox);
            app.manage(inbox);
            app.manage(rooms);
            if let Err(error) = i18n::refresh_menu(app.handle()) { log::warn!("Cannot initialize native menu language: {error}"); }
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
            logging::app_log_write,
            i18n::app_set_locale,
            logging::diagnostics_export,
            agent::commands::agent_detect,
            agent::commands::agent_descriptors,
            agent::commands::agent_resume_plan,
            agent::release::commands::agent_release_report,
            agent::release::commands::agent_release_install,
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
            collab::inbox::commands::collab_inbox_capabilities,
            collab::inbox::commands::collab_inbox_activate,
            collab::inbox::commands::collab_inbox_sessions,
            collab::inbox::commands::collab_inbox_messages,
            collab::inbox::commands::collab_inbox_pending,
            collab::inbox::commands::collab_inbox_bind_target,
            collab::inbox::commands::collab_inbox_offer,
            collab::inbox::commands::collab_inbox_revoke_offer,
            collab::inbox::commands::collab_inbox_prepare,
            collab::inbox::commands::collab_inbox_begin_submit,
            collab::inbox::commands::collab_inbox_receipt,
            collab::inbox::commands::collab_inbox_abort_prepared,
            collab::inbox::commands::collab_inbox_batch_get,
            collab::inbox::commands::collab_inbox_resolve,
            collab::commands::collab_sync_sessions,
            collab::commands::collab_pending_tasks,
            collab::commands::collab_mark_dispatched,
            collab::commands::collab_claim_delivery,
            collab::commands::collab_release_delivery,
            collab::commands::collab_delivery_update,
            collab::commands::collab_resolve_delivery,
            collab::commands::collab_tasks,
            collab::commands::collab_sessions,
            collab::commands::collab_approve,
            collab::commands::collab_reject,
            collab::commands::collab_stop_all,
            rooms::commands::room_list,
            rooms::commands::room_get,
            rooms::commands::room_history,
            rooms::commands::room_create,
            rooms::commands::room_rename,
            rooms::commands::room_delete,
            rooms::commands::room_add_member,
            rooms::commands::room_update_member,
            rooms::commands::room_set_member_model,
            rooms::commands::room_set_foreman,
            rooms::commands::room_remove_member,
            rooms::commands::room_update_brief,
            rooms::commands::room_say,
            rooms::commands::room_cancel_reply,
            rooms::commands::room_set_paused,
            rooms::commands::room_task,
            rooms::attachment_commands::room_pick_attachments,
            rooms::attachment_commands::room_import_attachment,
            rooms::attachment_commands::room_paste_attachment,
            rooms::attachment_commands::room_read_attachment,
            rooms::attachment_commands::room_discard_attachment,
            rooms::attachment_commands::room_reveal_attachment,
            rooms::attachment_commands::room_clipboard_files,
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
            provider::commands::provider_models,
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
            external::commands::open_external,
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
        .build(context)
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
