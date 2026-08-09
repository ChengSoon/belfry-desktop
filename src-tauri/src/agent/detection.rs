use std::path::{Path, PathBuf};
use std::process::Command;

use crate::terminal::AppError;

use super::contracts::{AgentAvailability, AgentKind};

pub fn detect_agents() -> Vec<AgentAvailability> {
    AgentKind::ALL.into_iter().map(detect_agent).collect()
}

pub(crate) fn resolve_agent(kind: AgentKind) -> Result<PathBuf, AppError> {
    find_agent(kind).ok_or_else(|| {
        AppError::not_found(format!(
            "{} is not installed or is not visible in the user command environment",
            kind.command_name()
        ))
    })
}

fn detect_agent(kind: AgentKind) -> AgentAvailability {
    match find_agent(kind) {
        Some(path) => AgentAvailability {
            kind,
            available: true,
            version: read_version(&path),
            executable: Some(path.to_string_lossy().to_string()),
            reason: None,
        },
        None => AgentAvailability {
            kind,
            available: false,
            executable: None,
            version: None,
            reason: Some(format!("未在用户命令环境中找到 {}", kind.command_name())),
        },
    }
}

fn find_agent(kind: AgentKind) -> Option<PathBuf> {
    find_in_path(kind.command_name())
        .or_else(|| find_in_user_environment(kind))
        .and_then(|path| path.canonicalize().ok().or(Some(path)))
}

fn find_in_path(command: &str) -> Option<PathBuf> {
    let search_path = std::env::var_os("PATH")?;
    std::env::split_paths(&search_path)
        .flat_map(|directory| command_candidates(&directory, command))
        .find(|candidate| is_executable(candidate))
}

#[cfg(target_os = "macos")]
fn command_candidates(directory: &Path, command: &str) -> Vec<PathBuf> {
    vec![directory.join(command)]
}

#[cfg(target_os = "windows")]
fn command_candidates(directory: &Path, command: &str) -> Vec<PathBuf> {
    ["exe", "cmd", "bat", "com"]
        .into_iter()
        .map(|extension| directory.join(format!("{command}.{extension}")))
        .collect()
}

#[cfg(target_os = "macos")]
fn find_in_user_environment(kind: AgentKind) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let lookup = format!("command -v {}", kind.command_name());
    let output = Command::new(shell).args(["-lic", &lookup]).output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|path| is_executable(path))
}

#[cfg(target_os = "windows")]
fn find_in_user_environment(kind: AgentKind) -> Option<PathBuf> {
    let app_data = std::env::var_os("APPDATA")?;
    let npm_bin = PathBuf::from(app_data).join("npm");
    command_candidates(&npm_bin, kind.command_name())
        .into_iter()
        .find(|path| is_executable(path))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn read_version(executable: &Path) -> Option<String> {
    let output = version_command(executable).arg("--version").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "macos")]
fn version_command(executable: &Path) -> Command {
    Command::new(executable)
}

#[cfg(target_os = "windows")]
fn version_command(executable: &Path) -> Command {
    let is_script = executable
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);
    if is_script {
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/c"]).arg(executable);
        command
    } else {
        Command::new(executable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_always_reports_both_supported_agents() {
        let result = detect_agents();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].kind, AgentKind::Codex);
        assert_eq!(result[1].kind, AgentKind::Claude);
    }
}
