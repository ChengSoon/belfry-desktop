mod auto_password;
mod backend;
pub mod commands;
mod contracts;
pub(crate) mod daemon;
mod launch;
mod native;
mod native_lifecycle;
#[cfg(test)]
mod native_test_commands;
#[cfg(test)]
mod native_tests;
mod osc;
pub mod output_commands;
pub(crate) mod overlay;
mod runtime;
#[cfg(test)]
mod runtime_tests;
mod ssh_auth;

pub(crate) use contracts::{
    AppError, CreateTerminalRequest, LaunchProfileId, SshTarget, TerminalEvent,
};
pub(crate) use launch::resolve_ssh_executable;
pub use runtime::TerminalRuntime;
