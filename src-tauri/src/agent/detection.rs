use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "macos")]
use std::sync::OnceLock;

use crate::resource::canonicalize;
use crate::terminal::AppError;

use super::contracts::{AgentAvailability, AgentKind};

#[cfg(target_os = "macos")]
static USER_COMMAND_PATH: OnceLock<Option<OsString>> = OnceLock::new();

pub fn detect_agents() -> Vec<AgentAvailability> {
    // 两个 `--version` 都是独立的外部进程，串行只会把冷启动耗时相加。
    // 保留 AgentKind::ALL 的稳定顺序，避免前端列表在探测完成后跳动。
    std::thread::scope(|scope| {
        AgentKind::ALL
            .into_iter()
            .map(|kind| (kind, scope.spawn(move || detect_agent(kind))))
            .map(|(kind, handle)| {
                handle.join().unwrap_or_else(|_| AgentAvailability {
                    kind,
                    available: false,
                    executable: None,
                    version: None,
                    reason: Some(format!("检测 {} 时后台任务异常退出", kind.command_name())),
                })
            })
            .collect()
    })
}

pub(crate) fn resolve_agent(kind: AgentKind) -> Result<PathBuf, AppError> {
    find_agent(kind).ok_or_else(|| {
        AppError::not_found(format!(
            "{} is not installed or is not visible in the user command environment",
            kind.command_name()
        ))
    })
}

/// Finder 启动的 macOS GUI 进程不会读取用户 shell 配置，导致 NVM/Homebrew 安装的
/// Node 不在 PATH 中。Agent 脚本通常以 `#!/usr/bin/env node` 开头，因此启动前需要
/// 使用登录 shell 的 PATH。其他平台沿用系统继承的环境。
pub(crate) fn user_command_path() -> Option<OsString> {
    #[cfg(target_os = "macos")]
    {
        USER_COMMAND_PATH.get_or_init(login_shell_path).clone()
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
    }
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
        // 解析失败就保留原路径：能找到文件就已经可执行，规范化只是锦上添花。
        .and_then(|path| canonicalize(&path).ok().or(Some(path)))
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
    let shell = login_shell();
    let lookup = format!("command -v {}", kind.command_name());
    let output = Command::new(shell).args(["-lic", &lookup]).output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .map(PathBuf::from)
        .find(|path| is_executable(path))
}

#[cfg(target_os = "macos")]
fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|path| Path::new(path).is_file())
        .unwrap_or_else(|| "/bin/zsh".to_string())
}

#[cfg(target_os = "macos")]
fn login_shell_path() -> Option<OsString> {
    let output = Command::new(login_shell())
        .args(["-lic", "/usr/bin/printf '\\0'; /usr/bin/env -0"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_login_shell_path(&output.stdout)
}

#[cfg(target_os = "macos")]
fn parse_login_shell_path(output: &[u8]) -> Option<OsString> {
    output
        .split(|byte| *byte == 0)
        .rev()
        .find_map(|value| value.strip_prefix(b"PATH="))
        .map(|path| OsString::from(String::from_utf8_lossy(path).into_owned()))
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
    let mut command = version_command(executable);
    if let Some(path) = user_command_path() {
        command.env("PATH", path);
    }
    let output = command.arg("--version").output().ok()?;
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
    use std::os::windows::process::CommandExt;
    /// 不给子进程分配控制台。否则 GUI 进程每探测一次就闪一个黑框。
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let is_script = executable
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "cmd" | "bat"))
        .unwrap_or(false);
    let mut command = if is_script {
        // .cmd/.bat 不是可执行映像，必须由 cmd.exe 解释。
        let mut command = Command::new("cmd.exe");
        command.args(["/d", "/c"]).arg(executable);
        command
    } else {
        Command::new(executable)
    };
    command.creation_flags(CREATE_NO_WINDOW);
    command
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

    #[cfg(target_os = "macos")]
    #[test]
    fn login_shell_path_uses_the_last_nul_terminated_value() {
        let path = parse_login_shell_path(
            b"startup warning\n\0HOME=/Users/test\0PATH=/opt/homebrew/bin:/usr/bin\0",
        )
        .unwrap();
        assert_eq!(path, OsString::from("/opt/homebrew/bin:/usr/bin"));
    }
}
