mod auto_password;
mod backend;
pub mod commands;
mod contracts;
mod launch;
mod native;
mod native_lifecycle;
#[cfg(test)]
mod native_test_commands;
#[cfg(test)]
mod native_tests;
mod osc;
mod runtime;
mod ssh_auth;

pub(crate) use contracts::AppError;
pub use runtime::TerminalRuntime;
