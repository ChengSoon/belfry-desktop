use super::{CreateTerminalRequest, runtime::TerminalRuntime};
use tauri::ipc::Channel;

fn request() -> CreateTerminalRequest {
    serde_json::from_value(
        serde_json::json!({ "platform": "macos", "profileId": "shell:bash", "tabId": "closing-tab",
        "cwd": "file:///tmp", "cols": 80, "rows": 24, "elevation": "normal" }),
    )
    .unwrap()
}

#[test]
fn closing_a_tab_invalidates_prepared_creates_before_they_spawn_or_bind_plugins() {
    let runtime = TerminalRuntime::with_platform_backend();
    let mut prepared = request();
    prepared.launch_overlay.launch_epoch = runtime.launch_epoch("closing-tab");
    runtime.cancel_pending("closing-tab");
    let result = runtime.create(prepared, Channel::new(|_| Ok(())), |_| {
        panic!("cancelled creates cannot bind plugins")
    });
    assert!(result.unwrap_err().message.contains("取消迟到"));
    assert_eq!(1, runtime.launch_epoch("closing-tab"));
}

#[test]
fn confirmed_exit_rejects_new_creates_without_launching_a_process() {
    let runtime = TerminalRuntime::with_platform_backend();
    runtime.prepare_exit(false).unwrap();
    let result = runtime.create(request(), Channel::new(|_| Ok(())), |_| {
        panic!("exit must prevent launches")
    });
    assert!(result.unwrap_err().message.contains("正在退出"));
}
