pub mod commands;
mod contracts;
mod detection;

pub(crate) use contracts::AgentKind;
pub(crate) use detection::login_shell_env;
pub(crate) use detection::resolve_agent;
pub(crate) use detection::user_command_path;
