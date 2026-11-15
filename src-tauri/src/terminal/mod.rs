mod auto_password;
mod backend;
pub mod commands;
mod contracts;
pub(crate) mod daemon;
#[cfg(test)]
mod inbox_concurrency_test;
pub(crate) mod input_gate;
mod input_gate_vt;
mod input_readiness;
mod launch;
mod native;
#[cfg(all(test, target_os = "macos"))]
mod native_inbox_test;
mod native_lifecycle;
#[cfg(test)]
mod native_test_commands;
#[cfg(test)]
mod native_tests;
mod osc;
pub mod output_commands;
pub(crate) mod overlay;
mod program_status;
mod runtime;
#[cfg(test)]
mod runtime_tests;
mod ssh_auth;

pub(crate) use contracts::{
    AppError, CreateTerminalRequest, LaunchProfileId, SshTarget, TerminalEvent, TerminalStatus,
};
pub(crate) use launch::resolve_ssh_executable;
pub use runtime::TerminalRuntime;
