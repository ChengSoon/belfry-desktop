mod adapter;
pub mod commands;
mod contracts;
mod detection;
mod history_adapter;
pub(crate) mod hooks;
pub(crate) mod integration;
pub(crate) mod native_launch;
pub(crate) mod paths;
pub(crate) mod release;
mod state;

#[cfg(test)]
pub(crate) use adapter::arguments_for;
pub(crate) use adapter::{AgentLaunchContext, adapter_for, descriptors};
pub(crate) use contracts::{AgentKind, AgentSessionRef, validate_agent_session_id};
#[cfg(test)]
pub(crate) use contracts::AgentLifecycleState;
pub(crate) use contracts::AgentStateSource;
pub(crate) use contracts::{ProgramState, ProgramBlockKind, TerminalProgramStatus};
pub(crate) use detection::login_shell_env;
pub(crate) use detection::user_command_path;
pub(crate) use detection::{find_in_path, resolve_agent};
