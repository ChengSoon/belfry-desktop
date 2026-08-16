use std::collections::HashMap;
use std::path::Path;

use portable_pty::CommandBuilder;

use crate::agent::{AgentKind, resolve_agent};
use crate::resource::{canonicalize, file_uri_to_path, path_to_file_uri};

use super::contracts::{AppError, LaunchProfileId, Platform, SshTarget};

pub(super) struct ResolvedLaunch {
    pub command: CommandBuilder,
    pub display_name: String,
}

pub(super) fn resolve_launch(
    profile_id: &str,
    cwd: &Path,
    env: &HashMap<String, String>,
    resume: Option<&str>,
    ssh: Option<&SshTarget>,
) -> Result<ResolvedLaunch, AppError> {
    match LaunchProfileId::parse(profile_id)? {
        LaunchProfileId::SystemDefault => resolve_shell_launch(cwd, env),
        LaunchProfileId::AgentCodex => resolve_agent_launch(AgentKind::Codex, cwd, env, resume),
        LaunchProfileId::AgentClaude => resolve_agent_launch(AgentKind::Claude, cwd, env, resume),
        LaunchProfileId::Ssh => resolve_ssh_launch(cwd, env, ssh),
    }
}

/// SSH 会话直接拉起系统 OpenSSH 客户端：密码只经 PTY 应答提示、不进命令行，
/// 主机指纹、2FA 全在终端里交互；`~/.ssh/config` 的别名、密钥和 agent 都原样继承。
/// 勾选「记住密码」时密码会存进系统钥匙串，但不随工作区状态持久化。
fn resolve_ssh_launch(
    cwd: &Path,
    env: &HashMap<String, String>,
    target: Option<&SshTarget>,
) -> Result<ResolvedLaunch, AppError> {
    let target = target
        .ok_or_else(|| AppError::invalid_argument("ssh launch profile requires an ssh target"))?;
    let mut command = configured_command(resolve_ssh_executable()?, cwd, env);
    command.args(ssh_arguments(target));
    let destination = ssh_destination(target);
    Ok(ResolvedLaunch {
        command,
        display_name: destination,
    })
}

fn ssh_arguments(target: &SshTarget) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(port) = target.port {
        args.push("-p".to_string());
        args.push(port.to_string());
    }
    args.push(ssh_destination(target));
    args
}

fn ssh_destination(target: &SshTarget) -> String {
    match &target.user {
        Some(user) => format!("{user}@{}", target.host),
        None => target.host.clone(),
    }
}

#[cfg(target_os = "macos")]
fn resolve_ssh_executable() -> Result<String, AppError> {
    const SSH_PATH: &str = "/usr/bin/ssh";
    Path::new(SSH_PATH)
        .is_file()
        .then(|| SSH_PATH.to_string())
        .ok_or_else(|| AppError::not_found("OpenSSH client was not found on this system"))
}

/// Windows 上 OpenSSH 客户端是可选功能：先查系统自带位置，找不到再走 PATH，
/// 覆盖用户自装的客户端。与 resolve_default_shell 同理，能给绝对路径就不给裸名。
#[cfg(target_os = "windows")]
fn resolve_ssh_executable() -> Result<String, AppError> {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let bundled = Path::new(&system_root).join("System32\\OpenSSH\\ssh.exe");
    if bundled.is_file() {
        return Ok(bundled.to_string_lossy().to_string());
    }
    crate::agent::find_in_path("ssh")
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| AppError::not_found("OpenSSH client was not found on this system"))
}

fn resolve_shell_launch(
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<ResolvedLaunch, AppError> {
    let shell = resolve_default_shell()?;
    let command = configured_command(&shell, cwd, env);
    Ok(ResolvedLaunch {
        command,
        // 展示用的是可执行文件名：解析结果是绝对路径，整条打出来在标签页里没有信息量。
        display_name: shell_display_name(&shell),
    })
}

fn shell_display_name(shell: &str) -> String {
    Path::new(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(shell)
        .to_string()
}

fn resolve_agent_launch(
    kind: AgentKind,
    cwd: &Path,
    env: &HashMap<String, String>,
    resume: Option<&str>,
) -> Result<ResolvedLaunch, AppError> {
    let executable = resolve_agent(kind)?;
    let mut command = agent_command(&executable, cwd, env);
    command.args(agent_args(kind, resume));
    Ok(ResolvedLaunch {
        command,
        display_name: kind.command_name().to_string(),
    })
}

fn agent_args(kind: AgentKind, resume: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = match kind {
        AgentKind::Codex => Vec::new(),
        AgentKind::Claude => vec!["--dangerously-skip-permissions".to_string()],
    };
    if let Some(session_id) = resume {
        match kind {
            AgentKind::Codex => args.extend(["resume".to_string(), session_id.to_string()]),
            AgentKind::Claude => args.extend(["--resume".to_string(), session_id.to_string()]),
        }
    }
    args
}

fn configured_command(
    executable: impl AsRef<std::ffi::OsStr>,
    cwd: &Path,
    env: &HashMap<String, String>,
) -> CommandBuilder {
    let mut command = CommandBuilder::new(executable);
    command.cwd(cwd);
    // Agent 的 TUI 靠 TERM 判断能力，GUI 进程的环境里通常没有它，得自己补。
    // 放在调用方变量之前，让请求里的同名值覆盖默认。
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    for (key, value) in env {
        command.env(key, value);
    }
    command
}

#[cfg(target_os = "macos")]
fn agent_command(executable: &Path, cwd: &Path, env: &HashMap<String, String>) -> CommandBuilder {
    let mut command = configured_command(executable, cwd, env);
    if !env.contains_key("PATH") {
        if let Some(path) = crate::agent::user_command_path() {
            command.env("PATH", path);
        }
    }
    command
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
    let canonical = canonicalize(&path).map_err(|error| {
        AppError::not_found(format!(
            "terminal working directory was not found: {} ({error})",
            path.display()
        ))
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

/// Windows 默认 shell。
///
/// 给绝对路径而不是裸名：`CreateProcessW` 一旦拿到 `lpApplicationName` 就不再走 PATH 搜索，
/// 而 GUI 进程继承的 PATH 未必包含 System32（被用户改坏或被启动器裁剪都会发生）。
/// 依次尝试 PowerShell、`%ComSpec%`、cmd.exe，全都不在才报错。
#[cfg(target_os = "windows")]
pub(super) fn resolve_default_shell() -> Result<String, AppError> {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let candidates = [
        format!("{system_root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
        std::env::var("ComSpec").unwrap_or_default(),
        format!("{system_root}\\System32\\cmd.exe"),
    ];
    candidates
        .into_iter()
        .find(|path| !path.is_empty() && Path::new(path).is_file())
        .ok_or_else(|| AppError::not_found("default Windows shell was not found"))
}

pub(super) fn map_spawn_error(shell: &str, error: impl std::fmt::Display) -> AppError {
    let message = format!("failed to start {shell}: {error}");
    // 不能匹配错误文案：Windows 上它是本地化的（中文系统会给"系统找不到指定的文件"）。
    // `io::Error` 的 Display 始终附带 `(os error N)`，按错误码判定才跨平台稳定。
    // 2 = ENOENT / ERROR_FILE_NOT_FOUND，3 = ERROR_PATH_NOT_FOUND。
    let text = error.to_string();
    let missing = text.contains("(os error 2)")
        || (cfg!(windows) && text.contains("(os error 3)"))
        || text.contains("No such file");
    if missing {
        AppError::not_found(message)
    } else {
        AppError::io(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_skips_permission_prompts() {
        assert_eq!(
            agent_args(AgentKind::Claude, None),
            &["--dangerously-skip-permissions"]
        );
    }

    #[test]
    fn codex_launch_arguments_are_unchanged() {
        assert!(agent_args(AgentKind::Codex, None).is_empty());
    }

    #[test]
    fn resume_appends_agent_specific_flags() {
        assert_eq!(
            agent_args(
                AgentKind::Codex,
                Some("019ff0d5-dbaf-7893-96db-4fbbbfee03a7")
            ),
            &["resume", "019ff0d5-dbaf-7893-96db-4fbbbfee03a7"]
        );
        assert_eq!(
            agent_args(
                AgentKind::Claude,
                Some("cf32a9a3-0a60-427b-8bba-823e36c66d13")
            ),
            &[
                "--dangerously-skip-permissions",
                "--resume",
                "cf32a9a3-0a60-427b-8bba-823e36c66d13"
            ]
        );
    }

    #[test]
    fn ssh_arguments_carry_port_and_destination() {
        let target = SshTarget {
            host: "example.com".to_string(),
            user: Some("root".to_string()),
            port: Some(2222),
            password: None,
            remember_password: None,
        };
        assert_eq!(ssh_arguments(&target), &["-p", "2222", "root@example.com"]);
        assert_eq!(ssh_destination(&target), "root@example.com");
    }

    #[test]
    fn ssh_without_user_or_port_destinations_to_the_bare_host() {
        let target = SshTarget {
            host: "bastion".to_string(),
            user: None,
            port: None,
            password: None,
            remember_password: None,
        };
        assert_eq!(ssh_arguments(&target), &["bastion"]);
    }

    #[test]
    fn ssh_launch_requires_a_target() {
        let cwd = std::env::current_dir().unwrap();
        assert!(
            resolve_ssh_launch(&cwd, &HashMap::new(), None).is_err(),
            "ssh without a target must not resolve"
        );
    }
}
