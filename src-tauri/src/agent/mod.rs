pub mod commands;
mod contracts;
mod detection;

pub(crate) use contracts::AgentKind;
pub(crate) use detection::{resolve_agent, user_command_path};
