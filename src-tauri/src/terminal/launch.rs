use std::collections::HashMap;
use std::path::Path;

use portable_pty::CommandBuilder;

use crate::agent::{AgentKind, resolve_agent};
use crate::resource::{file_uri_to_path, path_to_file_uri};

use super::contracts::{AppError, LaunchProfileId, Platform};

pub(super) struct ResolvedLaunch {
    pub command: CommandBuilder,
    pub display_name: String,
}

pub(super) fn resolve_launch(
    profile_id: &str,
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<ResolvedLaunch, AppError> {
    match LaunchProfileId::parse(profile_id)? {
        LaunchProfileId::SystemDefault => resolve_shell_launch(cwd, env),
        LaunchProfileId::AgentCodex => resolve_agent_launch(AgentKind::Codex, cwd, env),
        LaunchProfileId::AgentClaude => resolve_agent_launch(AgentKind::Claude, cwd, env),
    }
}

fn resolve_shell_launch(
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<ResolvedLaunch, AppError> {
    let shell = resolve_default_shell()?;
    let command = configured_command(&shell, cwd, env);
    Ok(ResolvedLaunch {
        command,
        display_name: shell,
    })
}

fn resolve_agent_launch(
    kind: AgentKind,
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<ResolvedLaunch, AppError> {
    let executable = resolve_agent(kind)?;
    let command = agent_command(&executable, cwd, env);
    Ok(ResolvedLaunch {
        command,
        display_name: kind.command_name().to_string(),
    })
}

fn configured_command(
    executable: impl AsRef<std::ffi::OsStr>,
    cwd: &Path,
    env: &HashMap<String, String>,
) -> CommandBuilder {
    let mut command = CommandBuilder::new(executable);
    command.cwd(cwd);
    for (key, value) in env {
        command.env(key, value);
    }
    command
}

#[cfg(target_os = "macos")]
fn agent_command(executable: &Path, cwd: &Path, env: &HashMap<String, String>) -> CommandBuilder {
    configured_command(executable, cwd, env)
}

#[cfg(target_os = "windows")]
fn agent_command(executable: &Path, cwd: &Path, env: &HashMap<String, String>) -> CommandBuilder {
    let is_script = executable
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);
    if is_script {
        let mut command = configured_command("cmd.exe", cwd, env);
        command.arg("/d");
        command.arg("/c");
        command.arg(executable);
        command
    } else {
        configured_command(executable, cwd, env)
    }
}

pub(super) fn resolve_cwd(uri: Option<&str>) -> Result<std::path::PathBuf, AppError> {
    let path = match uri {
        Some(value) => file_uri_to_path(value),
        None => std::env::current_dir().map_err(|error| AppError::io(error.to_string())),
    }?;
    let canonical = path.canonicalize().map_err(|error| {
        AppError::not_found(format!("terminal working directory was not found: {error}"))
    })?;
    canonical
        .is_dir()
        .then_some(canonical)
        .ok_or_else(|| AppError::invalid_argument("terminal cwd must be a directory"))
}

pub(super) fn path_to_resource_uri(path: &Path) -> String {
    path_to_file_uri(path)
}

pub(super) fn validate_platform(platform: Platform) -> Result<(), AppError> {
    if platform == Platform::current() {
        Ok(())
    } else {
        Err(AppError::invalid_argument(
            "request platform does not match this build",
        ))
    }
}

#[cfg(target_os = "macos")]
pub(super) fn resolve_default_shell() -> Result<String, AppError> {
    let configured = std::env::var("SHELL")
        .ok()
        .filter(|path| Path::new(path).is_file());
    let shell = configured.unwrap_or_else(|| "/bin/zsh".to_string());
    Path::new(&shell)
        .is_file()
        .then_some(shell)
        .ok_or_else(|| AppError::not_found("default macOS shell was not found"))
}

#[cfg(target_os = "windows")]
pub(super) fn resolve_default_shell() -> Result<String, AppError> {
    Ok("powershell.exe".to_string())
}

pub(super) fn map_spawn_error(shell: &str, error: impl std::fmt::Display) -> AppError {
    let message = format!("failed to start {shell}: {error}");
    if error.to_string().contains("No such file") {
        AppError::not_found(message)
    } else {
        AppError::io(message)
    }
}
