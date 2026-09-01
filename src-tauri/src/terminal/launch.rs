use std::collections::HashMap;
use std::fs;
use std::path::Path;

use portable_pty::CommandBuilder;

#[cfg(test)]
use crate::agent::arguments_for;
use crate::agent::{AgentKind, AgentLaunchContext, adapter_for};
use crate::resource::{canonicalize, file_uri_to_path, path_to_file_uri};

use super::contracts::{AppError, LaunchProfileId, Platform, ShellProfile, SshTarget};

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
    collaboration_mode: bool,
) -> Result<ResolvedLaunch, AppError> {
    let profile = LaunchProfileId::parse(profile_id)?;
    if profile.is_shell() {
        return if profile == LaunchProfileId::SystemDefault {
            resolve_shell_launch(cwd, env)
        } else {
            resolve_named_shell_launch(profile, cwd, env)
        };
    }
    match profile {
        LaunchProfileId::AgentCodex => {
            resolve_agent_launch(AgentKind::Codex, cwd, env, resume, collaboration_mode)
        }
        LaunchProfileId::AgentClaude => {
            resolve_agent_launch(AgentKind::Claude, cwd, env, resume, collaboration_mode)
        }
        LaunchProfileId::Ssh => resolve_ssh_launch(cwd, env, ssh),
        _ => Err(AppError::invalid_argument(
            "unsupported terminal launch profile",
        )),
    }
}

pub(super) fn detect_shell_profiles() -> Vec<ShellProfile> {
    [
        LaunchProfileId::SystemDefault,
        LaunchProfileId::ShellZsh,
        LaunchProfileId::ShellBash,
        LaunchProfileId::ShellFish,
        LaunchProfileId::ShellPwsh,
        LaunchProfileId::ShellPowershell,
        LaunchProfileId::ShellCmd,
        LaunchProfileId::ShellWsl,
        LaunchProfileId::ShellGitBash,
    ]
    .into_iter()
    .map(|id| {
        let is_default = id == LaunchProfileId::SystemDefault;
        match resolve_shell_executable(id) {
            Ok(executable) => ShellProfile {
                id: id.as_str().to_string(),
                available: true,
                executable: Some(executable),
                is_default,
                reason: None,
            },
            Err(error) => ShellProfile {
                id: id.as_str().to_string(),
                available: false,
                executable: None,
                is_default,
                reason: Some(error.message),
            },
        }
    })
    .collect()
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

fn resolve_named_shell_launch(
    profile: LaunchProfileId,
    cwd: &Path,
    env: &HashMap<String, String>,
) -> Result<ResolvedLaunch, AppError> {
    let executable = resolve_shell_executable(profile)?;
    let mut command = configured_command(&executable, cwd, env);
    match profile {
        LaunchProfileId::ShellZsh | LaunchProfileId::ShellBash | LaunchProfileId::ShellFish => {
            command.arg("-l");
        }
        LaunchProfileId::ShellPwsh | LaunchProfileId::ShellPowershell => {
            command.arg("-NoLogo");
        }
        LaunchProfileId::ShellCmd => {
            command.arg("/d");
        }
        LaunchProfileId::ShellWsl => {}
        LaunchProfileId::ShellGitBash => {
            command.args(["--login", "-i"]);
        }
        LaunchProfileId::SystemDefault
        | LaunchProfileId::AgentCodex
        | LaunchProfileId::AgentClaude
        | LaunchProfileId::Ssh => {
            return Err(AppError::invalid_argument("profile is not a named shell"));
        }
    }
    Ok(ResolvedLaunch {
        command,
        display_name: shell_display_name(&executable),
    })
}

fn resolve_shell_executable(profile: LaunchProfileId) -> Result<String, AppError> {
    match profile {
        LaunchProfileId::SystemDefault => resolve_default_shell(),
        LaunchProfileId::ShellZsh => resolve_fixed_executable(profile, "/bin/zsh"),
        LaunchProfileId::ShellBash => resolve_fixed_executable(profile, "/bin/bash"),
        LaunchProfileId::ShellFish => resolve_fish_executable(),
        LaunchProfileId::ShellPwsh => resolve_windows_command(profile, "pwsh"),
        LaunchProfileId::ShellPowershell => resolve_windows_powershell(),
        LaunchProfileId::ShellCmd => resolve_windows_cmd(),
        LaunchProfileId::ShellWsl => resolve_windows_wsl(),
        LaunchProfileId::ShellGitBash => resolve_git_bash(),
        LaunchProfileId::AgentCodex | LaunchProfileId::AgentClaude | LaunchProfileId::Ssh => {
            Err(AppError::invalid_argument("profile is not a shell"))
        }
    }
}

#[cfg(target_os = "macos")]
fn resolve_fixed_executable(profile: LaunchProfileId, path: &str) -> Result<String, AppError> {
    Path::new(path)
        .is_file()
        .then_some(path.to_string())
        .ok_or_else(|| AppError::not_found(format!("{} was not found at {path}", profile.as_str())))
}

#[cfg(not(target_os = "macos"))]
fn resolve_fixed_executable(profile: LaunchProfileId, _path: &str) -> Result<String, AppError> {
    Err(AppError::unsupported(format!(
        "{} is only available on macOS",
        profile.as_str()
    )))
}

#[cfg(target_os = "macos")]
fn resolve_fish_executable() -> Result<String, AppError> {
    let candidates = [
        Some(Path::new("/opt/homebrew/bin/fish").to_path_buf()),
        Some(Path::new("/usr/local/bin/fish").to_path_buf()),
        crate::agent::find_in_path("fish"),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| {
            AppError::not_found("fish was not found in common install locations or PATH")
        })
}

#[cfg(not(target_os = "macos"))]
fn resolve_fish_executable() -> Result<String, AppError> {
    Err(AppError::unsupported("fish is only available on macOS"))
}

#[cfg(target_os = "windows")]
fn resolve_windows_command(profile: LaunchProfileId, command: &str) -> Result<String, AppError> {
    crate::agent::find_in_path(command)
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| AppError::not_found(format!("{} was not found in PATH", profile.as_str())))
}

#[cfg(not(target_os = "windows"))]
fn resolve_windows_command(profile: LaunchProfileId, _command: &str) -> Result<String, AppError> {
    Err(AppError::unsupported(format!(
        "{} is only available on Windows",
        profile.as_str()
    )))
}

#[cfg(target_os = "windows")]
fn resolve_windows_powershell() -> Result<String, AppError> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let path = Path::new(&root).join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    path.is_file()
        .then(|| path.to_string_lossy().to_string())
        .ok_or_else(|| AppError::not_found("Windows PowerShell was not found"))
}

#[cfg(not(target_os = "windows"))]
fn resolve_windows_powershell() -> Result<String, AppError> {
    Err(AppError::unsupported(
        "Windows PowerShell is only available on Windows",
    ))
}

#[cfg(target_os = "windows")]
fn resolve_windows_cmd() -> Result<String, AppError> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let candidates = [
        std::env::var("ComSpec").unwrap_or_default(),
        format!("{root}\\System32\\cmd.exe"),
    ];
    candidates
        .into_iter()
        .find(|path| !path.is_empty() && Path::new(path).is_file())
        .ok_or_else(|| AppError::not_found("Command Prompt was not found"))
}

#[cfg(not(target_os = "windows"))]
fn resolve_windows_cmd() -> Result<String, AppError> {
    Err(AppError::unsupported(
        "Command Prompt is only available on Windows",
    ))
}

#[cfg(target_os = "windows")]
fn resolve_windows_wsl() -> Result<String, AppError> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let candidates = [
        format!("{root}\\System32\\wsl.exe"),
        format!("{root}\\Sysnative\\wsl.exe"),
    ];
    candidates
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .ok_or_else(|| AppError::not_found("WSL was not found"))
}

#[cfg(not(target_os = "windows"))]
fn resolve_windows_wsl() -> Result<String, AppError> {
    Err(AppError::unsupported("WSL is only available on Windows"))
}

#[cfg(target_os = "windows")]
fn resolve_git_bash() -> Result<String, AppError> {
    let mut candidates = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let root = Path::new(&program_files).join("Git");
        candidates.extend([root.join("bin\\bash.exe"), root.join("usr\\bin\\bash.exe")]);
    }
    if let Some(local_app_data) = std::env::var_os("LocalAppData") {
        let root = Path::new(&local_app_data).join("Programs\\Git");
        candidates.extend([root.join("bin\\bash.exe"), root.join("usr\\bin\\bash.exe")]);
    }
    if let Some(path) = crate::agent::find_in_path("bash") {
        candidates.push(path);
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| {
            AppError::not_found("Git Bash was not found in common install locations or PATH")
        })
}

#[cfg(not(target_os = "windows"))]
fn resolve_git_bash() -> Result<String, AppError> {
    Err(AppError::unsupported(
        "Git Bash is only available on Windows",
    ))
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
    collaboration_mode: bool,
) -> Result<ResolvedLaunch, AppError> {
    let effective_env = collaboration_env(kind, env, collaboration_mode)?;
    let spec = adapter_for(kind).launch(AgentLaunchContext {
        cwd,
        env: &effective_env,
        resume,
        collaboration_mode,
    })?;
    let mut command = agent_command(&spec.executable, cwd, &effective_env);
    command.args(spec.arguments);
    Ok(ResolvedLaunch {
        command,
        display_name: spec.display_name,
    })
}

/// 协作会话不应因宿主进程无法写入用户的 Codex 状态库而在启动阶段退出。
/// 只隔离 SQLite 运行时数据库，配置、认证和 JSONL 会话日志仍沿用用户的 CODEX_HOME。
fn collaboration_env(
    kind: AgentKind,
    env: &HashMap<String, String>,
    collaboration_mode: bool,
) -> Result<HashMap<String, String>, AppError> {
    let mut effective = env.clone();
    if collaboration_mode
        && kind == AgentKind::Codex
        && effective
            .get("CODEX_SQLITE_HOME")
            .is_none_or(|value| value.trim().is_empty())
    {
        let directory =
            std::env::temp_dir().join(format!("belfry-codex-sqlite-{}", std::process::id()));
        create_private_directory(&directory)?;
        effective.insert(
            "CODEX_SQLITE_HOME".to_string(),
            directory.to_string_lossy().into_owned(),
        );
    }
    Ok(effective)
}

fn create_private_directory(directory: &Path) -> Result<(), AppError> {
    fs::create_dir_all(directory)
        .map_err(|error| AppError::io(format!("无法创建 Codex 协作状态目录：{error}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| AppError::io(format!("无法保护 Codex 协作状态目录：{error}")))?;
    }
    Ok(())
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
    if let Some((key, value)) =
        utf8_ctype_patch(|name| env.get(name).cloned().or_else(|| std::env::var(name).ok()))
    {
        command.env(key, value);
    }
    for (key, value) in env {
        command.env(key, value);
    }
    command
}

/// 该不该替这条 PTY 补一个 UTF-8 的字符编码设置。
///
/// 认不认中文取决于生效的 locale 是不是 UTF-8。macOS 的 GUI 应用从 Dock 启动时**不走
/// 登录 shell**，环境里根本没有 `LANG`——此时 C 库按单字节处理，一个汉字的三个字节会被
/// 当成三个字符（`用` 的 `E7 94 A8` 显示成 `Áî®`）。而从终端启动的开发版继承了 shell 的
/// locale，所以这个坑只在正式版里露头，更难被发现。
///
/// 只补 `LC_CTYPE`（管字符分类与编码），不动 `LANG`：后者还管消息语言，
/// 不该由我们替用户决定 Agent 说哪国话。值取 `C.UTF-8`——只要 UTF-8，不带地区规则。
fn utf8_ctype_patch(
    lookup: impl Fn(&str) -> Option<String>,
) -> Option<(&'static str, &'static str)> {
    // POSIX 优先级：LC_ALL 盖过 LC_CTYPE，LC_CTYPE 盖过 LANG。
    // 找到第一个有值的就以它为准，后面的不用再看。
    for key in ["LC_ALL", "LC_CTYPE", "LANG"] {
        let Some(value) = lookup(key).filter(|value| !value.is_empty()) else {
            continue;
        };
        if is_utf8_locale(&value) {
            return None;
        }
        // 生效的那个不是 UTF-8。如果它是 LC_ALL，补 LC_CTYPE 会被它盖住，
        // 只能连 LC_ALL 一起换掉——只改编码，地区规则还是原来那套。
        return Some((
            if key == "LC_ALL" {
                "LC_ALL"
            } else {
                "LC_CTYPE"
            },
            "C.UTF-8",
        ));
    }
    Some(("LC_CTYPE", "C.UTF-8"))
}

/// macOS 上 `UTF-8`、`C.UTF-8`、`zh_CN.UTF-8`、`en_US.utf8` 都是合法写法。
fn is_utf8_locale(value: &str) -> bool {
    let upper = value.to_uppercase();
    upper.contains("UTF-8") || upper.contains("UTF8")
}

/// `belfry` 控制 CLI 所在的目录。
///
/// 就在主程序旁边：打包后 sidecar 躺在同一个 bundle 目录，开发时 cargo 也把
/// 两个二进制放进同一个 target 目录。两种情况用同一条规则。
///
/// 要先确认文件真的在：没构建 CLI 时往 PATH 里塞一个无效目录，只会让
/// `belfry` 报「找不到命令」而不是「服务没起来」，把人引到错误的方向。
fn cli_directory() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "belfry.exe"
    } else {
        "belfry"
    };
    dir.join(name).exists().then(|| dir.to_path_buf())
}

/// 把 CLI 目录接到 PATH 最前面。
///
/// 只改这条 PTY 的环境，不装进系统 PATH、也不动用户的 shell 配置——前者要
/// 提权（项目明确不做静默提权），后者是改用户的家当。代价是在 Belfry 之外
/// 敲 `belfry` 不认，但它本来就只在托管会话里才有身份。
///
/// 没找到 CLI 就原样返回 base，不制造一个只含无效目录的 PATH。
fn with_cli_on_path(base: Option<std::ffi::OsString>) -> Option<std::ffi::OsString> {
    let Some(dir) = cli_directory() else {
        return base;
    };
    let mut parts = vec![dir.into_os_string()];
    if let Some(base) = &base {
        parts.extend(std::env::split_paths(base).map(std::path::PathBuf::into_os_string));
    }
    std::env::join_paths(parts).ok().or(base)
}

#[cfg(target_os = "macos")]
fn agent_command(executable: &Path, cwd: &Path, env: &HashMap<String, String>) -> CommandBuilder {
    let mut command = configured_command(executable, cwd, env);
    // 调用方显式给了 PATH 就以它为准，否则用登录 shell 的那份——
    // GUI 进程继承到的 PATH 通常找不到用户装的 claude / codex。
    let base = env
        .get("PATH")
        .map(std::ffi::OsString::from)
        .or_else(crate::agent::user_command_path);
    if let Some(path) = with_cli_on_path(base) {
        command.env("PATH", path);
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
    let mut command = if is_script {
        let mut command = configured_command("cmd.exe", cwd, env);
        command.arg("/d");
        command.arg("/c");
        command.arg(executable);
        command
    } else {
        configured_command(executable, cwd, env)
    };
    // Windows 没有登录 shell 那一说，进程环境就是基准。
    let base = env
        .get("PATH")
        .map(std::ffi::OsString::from)
        .or_else(|| std::env::var_os("PATH"));
    if let Some(path) = with_cli_on_path(base) {
        command.env("PATH", path);
    }
    command
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
            arguments_for(AgentKind::Claude, None, false).unwrap(),
            &["--dangerously-skip-permissions"]
        );
    }

    #[test]
    fn codex_launch_arguments_are_unchanged() {
        assert!(
            arguments_for(AgentKind::Codex, None, false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn collaboration_launches_disable_provider_subagents_first() {
        assert_eq!(
            arguments_for(AgentKind::Codex, None, true).unwrap(),
            &["--disable", "multi_agent"]
        );
        assert_eq!(
            arguments_for(AgentKind::Claude, None, true).unwrap(),
            &[
                "--disallowedTools",
                "Agent",
                "Task",
                "--dangerously-skip-permissions"
            ]
        );
    }

    #[test]
    fn collaboration_codex_uses_an_isolated_sqlite_home() {
        let env = collaboration_env(AgentKind::Codex, &HashMap::new(), true).unwrap();
        let path = env.get("CODEX_SQLITE_HOME").unwrap();
        assert!(
            Path::new(path)
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.starts_with("belfry-codex-sqlite-"))
        );
    }

    #[test]
    fn collaboration_respects_an_explicit_sqlite_home() {
        let env = HashMap::from([(
            String::from("CODEX_SQLITE_HOME"),
            String::from("/custom/state"),
        )]);
        let effective = collaboration_env(AgentKind::Codex, &env, true).unwrap();
        assert_eq!(
            effective.get("CODEX_SQLITE_HOME").map(String::as_str),
            Some("/custom/state")
        );
    }

    #[test]
    fn normal_codex_keeps_its_existing_environment() {
        assert!(
            collaboration_env(AgentKind::Codex, &HashMap::new(), false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn resume_appends_agent_specific_flags() {
        assert_eq!(
            arguments_for(
                AgentKind::Codex,
                Some("019ff0d5-dbaf-7893-96db-4fbbbfee03a7"),
                false,
            )
            .unwrap(),
            &["resume", "019ff0d5-dbaf-7893-96db-4fbbbfee03a7"]
        );
        assert_eq!(
            arguments_for(
                AgentKind::Claude,
                Some("cf32a9a3-0a60-427b-8bba-823e36c66d13"),
                false,
            )
            .unwrap(),
            &[
                "--dangerously-skip-permissions",
                "--resume",
                "cf32a9a3-0a60-427b-8bba-823e36c66d13"
            ]
        );
    }

    #[test]
    fn collaboration_flags_precede_resume_arguments() {
        assert_eq!(
            arguments_for(AgentKind::Codex, Some("session-1"), true).unwrap(),
            &["--disable", "multi_agent", "resume", "session-1"]
        );
        assert_eq!(
            arguments_for(AgentKind::Claude, Some("session-2"), true).unwrap(),
            &[
                "--disallowedTools",
                "Agent",
                "Task",
                "--dangerously-skip-permissions",
                "--resume",
                "session-2"
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

    #[test]
    fn shell_detection_keeps_a_stable_fixed_profile_order() {
        let profiles = detect_shell_profiles();
        let ids: Vec<&str> = profiles.iter().map(|profile| profile.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "system-default",
                "shell:zsh",
                "shell:bash",
                "shell:fish",
                "shell:pwsh",
                "shell:powershell",
                "shell:cmd",
                "shell:wsl",
                "shell:git-bash",
            ]
        );
        assert!(profiles[0].is_default);
        assert!(profiles[1..].iter().all(|profile| !profile.is_default));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_shell_detection_marks_windows_profiles_unavailable() {
        let profiles = detect_shell_profiles();
        for id in [
            "shell:pwsh",
            "shell:powershell",
            "shell:cmd",
            "shell:wsl",
            "shell:git-bash",
        ] {
            let profile = profiles.iter().find(|profile| profile.id == id).unwrap();
            assert!(!profile.available);
            assert!(
                profile
                    .reason
                    .as_deref()
                    .unwrap_or_default()
                    .contains("Windows")
            );
        }
    }

    #[test]
    fn the_cli_directory_goes_to_the_front_of_path() {
        let Some(dir) = cli_directory() else {
            eprintln!("跳过：belfry 还没构建");
            return;
        };
        let base = std::ffi::OsString::from("/usr/bin:/bin");

        let resolved = with_cli_on_path(Some(base)).expect("应该拼得出 PATH");

        let mut parts = std::env::split_paths(&resolved);
        // 必须在最前：用户机器上可能装着同名的旧版本，排后面就等于没注入。
        assert_eq!(parts.next().as_deref(), Some(dir.as_path()));
        assert!(
            std::env::split_paths(&resolved).any(|p| p == std::path::Path::new("/bin")),
            "原有条目不能丢"
        );
    }

    #[test]
    fn a_missing_cli_leaves_path_untouched() {
        // cli_directory 找不到文件时返回 None，此时不该造出一个只含无效目录的 PATH。
        let base = std::ffi::OsString::from("/usr/bin:/bin");
        let resolved = with_cli_on_path(Some(base.clone()));

        match cli_directory() {
            Some(_) => assert_ne!(resolved.as_ref(), Some(&base)),
            None => assert_eq!(resolved.as_ref(), Some(&base)),
        }
    }

    #[test]
    fn no_base_path_still_yields_the_cli_directory() {
        let resolved = with_cli_on_path(None);
        match cli_directory() {
            Some(dir) => {
                let resolved = resolved.expect("有 CLI 就该给出 PATH");
                assert_eq!(
                    std::env::split_paths(&resolved).next().as_deref(),
                    Some(dir.as_path())
                );
            }
            // 两样都没有时保持 None，让调用方走「不设 PATH」那条路。
            None => assert!(resolved.is_none()),
        }
    }

    /// 用一张假环境表驱动，不碰真实进程环境——那东西在 CI 和本机上不一样。
    fn patch(pairs: &[(&str, &str)]) -> Option<(&'static str, &'static str)> {
        super::utf8_ctype_patch(|name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_string())
        })
    }

    #[test]
    fn a_gui_launch_without_any_locale_gets_utf8() {
        // macOS 从 Dock 启动的应用不走登录 shell，这三个变量一个都没有。
        // 不补的话中文按单字节处理，「用」会显示成 Áî®。
        assert_eq!(patch(&[]), Some(("LC_CTYPE", "C.UTF-8")));
    }

    #[test]
    fn an_existing_utf8_locale_is_left_alone() {
        for value in [
            "C.UTF-8",
            "en_US.UTF-8",
            "zh_CN.UTF-8",
            "UTF-8",
            "en_US.utf8",
        ] {
            assert_eq!(patch(&[("LANG", value)]), None, "LANG={value} 已经够用");
        }
    }

    #[test]
    fn a_single_byte_locale_gets_patched() {
        assert_eq!(patch(&[("LANG", "C")]), Some(("LC_CTYPE", "C.UTF-8")));
        assert_eq!(patch(&[("LANG", "POSIX")]), Some(("LC_CTYPE", "C.UTF-8")));
    }

    #[test]
    fn lc_all_wins_so_it_is_the_one_we_replace() {
        // LC_ALL 盖过 LC_CTYPE，只补 LC_CTYPE 等于没补。
        assert_eq!(
            patch(&[("LC_ALL", "C"), ("LANG", "zh_CN.UTF-8")]),
            Some(("LC_ALL", "C.UTF-8"))
        );
        // 反过来，LC_ALL 已经是 UTF-8 时，LANG 是什么都不重要。
        assert_eq!(patch(&[("LC_ALL", "en_US.UTF-8"), ("LANG", "C")]), None);
    }

    #[test]
    fn an_empty_value_falls_through_to_the_next_variable() {
        // 空串在 POSIX 里等于没设，不该让它挡住后面那个真值。
        assert_eq!(patch(&[("LC_ALL", ""), ("LANG", "zh_CN.UTF-8")]), None);
        assert_eq!(
            patch(&[("LC_ALL", ""), ("LC_CTYPE", ""), ("LANG", "")]),
            Some(("LC_CTYPE", "C.UTF-8"))
        );
    }
}
