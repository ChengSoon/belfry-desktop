mod adapter;
pub mod commands;
mod contracts;
mod detection;
mod history_adapter;
mod state;

#[cfg(test)]
pub(crate) use adapter::arguments_for;
pub(crate) use adapter::{AgentLaunchContext, adapter_for, descriptors};
pub(crate) use contracts::{AgentKind, AgentSessionRef, validate_agent_session_id};
pub(crate) use detection::login_shell_env;
#[cfg(target_os = "macos")]
pub(crate) use detection::user_command_path;
pub(crate) use detection::{find_in_path, resolve_agent};
