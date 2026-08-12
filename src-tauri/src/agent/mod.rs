pub mod commands;
mod contracts;
mod detection;

pub(crate) use contracts::AgentKind;
pub(crate) use detection::resolve_agent;
#[cfg(target_os = "macos")]
pub(crate) use detection::user_command_path;
