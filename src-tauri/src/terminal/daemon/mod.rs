mod client;
mod endpoint;
mod files;
mod leases;
pub(crate) mod lifecycle;
#[cfg(all(test, target_os = "macos"))]
mod native_subscription_tests;
mod output_budget;
#[cfg(test)]
mod output_budget_tests;
#[cfg(test)]
mod output_stress_tests;
mod protocol;
mod relay;
mod relay_collab;
mod relay_http;
#[cfg(test)]
mod relay_stream_tests;
#[cfg(test)]
mod relay_tests;
mod replay;
mod server;
mod service;
#[cfg(all(test, target_os = "macos"))]
mod service_tests;
mod slot;
mod subscription;
#[cfg(test)]
mod subscription_tests;
mod subscriptions;
mod transport;

pub(crate) use client::DaemonClient;
pub(crate) use leases::LeaseGuard;
pub(crate) use protocol::SessionInfo;
pub(crate) use server::run_if_requested;

/// 后台终端服务的存储目录名。
///
/// dev 构建用独立目录：同一个人经常同时开着正式版和 dev 调试（`collab::server`
/// 里 socket 按 pid 命名就是为这件事）。两者共用后台时，后起的实例会连上先起
/// 那个后台，而那个后台给 Agent 终端推的 CLI 取自它自己的安装位置——dev 里的
/// Agent 于是拿到正式版的旧 CLI，`room` 这类后加的命令当场不认得：成员收得到
/// 消息，却回不了话。
pub(crate) fn directory_name() -> &'static str {
    if cfg!(debug_assertions) {
        "terminal-daemon-v1-dev"
    } else {
        "terminal-daemon-v1"
    }
}

#[cfg(test)]
mod directory_name_tests {
    #[test]
    fn debug_builds_keep_their_own_daemon_directory() {
        // 测试跑在 dev 构建里：必须与正式版分开，否则会复用正式版的后台。
        assert_eq!(super::directory_name(), "terminal-daemon-v1-dev");
    }
}
