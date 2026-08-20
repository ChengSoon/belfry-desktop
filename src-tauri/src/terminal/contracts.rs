use serde::{Deserialize, Serialize};

use crate::agent::{AgentKind, AgentSessionRef};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
}

impl Platform {
    #[cfg(target_os = "macos")]
    pub fn current() -> Self {
        Self::Macos
    }

    #[cfg(target_os = "windows")]
    pub fn current() -> Self {
        Self::Windows
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Elevation {
    Normal,
    RequestAdmin,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)] // Roadmap-wide exit contract; this feature exercises a subset.
pub enum TerminalExitReason {
    Normal,
    Terminated,
    SpawnFailed,
    IoFailed,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[allow(dead_code)] // Shared error contract is intentionally wider than the vertical slice.
pub enum AppErrorCode {
    InvalidArgument,
    NotFound,
    Conflict,
    Unsupported,
    PermissionDenied,
    ProcessExited,
    Timeout,
    IoError,
    AdapterError,
    ConfirmationRequired,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    pub retryable: bool,
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InvalidArgument, message, false)
    }

    pub fn unsupported(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Unsupported, message, false)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::NotFound, message, false)
    }

    pub fn process_exited() -> Self {
        Self::new(
            AppErrorCode::ProcessExited,
            "terminal session has exited",
            false,
        )
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::IoError, message, true)
    }

    // 与 AppErrorCode 同理：关闭改为异步回收后暂无生产者，契约仍保留。
    #[allow(dead_code)]
    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::Timeout, message, true)
    }

    fn new(code: AppErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            details: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalRequest {
    pub platform: Platform,
    pub profile_id: String,
    pub cwd: Option<String>,
    pub command: Option<Vec<String>>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
    /// 继续某条历史会话：Codex / Claude 各自 CLI 的 resume 参数。仅 Agent profile 可用。
    #[serde(default)]
    pub resume: Option<String>,
    /// SSH 会话的目标主机。仅 profile_id == "ssh" 时使用。
    #[serde(default)]
    pub ssh: Option<SshTarget>,
    pub cols: u16,
    pub rows: u16,
    pub elevation: Elevation,
    /// 当前主题的默认前景 / 背景色，用来应答子进程的 OSC 10/11 查询。
    /// 缺省时不应答，退回让 xterm.js 自己答。
    #[serde(default)]
    pub palette: Option<TerminalPalette>,
}

/// SSH 连接目标。凭证一律不落地：密码 / 主机指纹 / 2FA 全部在终端里
/// 由 OpenSSH 客户端交互，这里只描述连到哪；密码只在本次请求中流转，
/// 勾选记住时由后端写入系统钥匙串，不随工作区状态持久化。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    /// 本次连接使用的密码。优先于钥匙串里保存的旧密码；不落盘。
    #[serde(default)]
    pub password: Option<String>,
    /// 为 true 时把 password 存入系统钥匙串，之后的连接自动取用。
    #[serde(default)]
    pub remember_password: Option<bool>,
}

impl SshTarget {
    pub fn validate(&self) -> Result<(), AppError> {
        // 参数是逐个传给 ssh 的，不存在 shell 注入，但坏 host 会把参数吃成选项
        // 或直接让会话起不来，早一点拦下比让用户盯着黑屏强。
        if self.host.is_empty() || self.host.len() > 255 {
            return Err(AppError::invalid_argument(
                "ssh host must be 1 to 255 characters",
            ));
        }
        if self.host.chars().any(char::is_whitespace)
            || self.host.contains(['/', '\\'])
            || self.host.starts_with('-')
        {
            return Err(AppError::invalid_argument(
                "ssh host contains invalid characters",
            ));
        }
        if let Some(user) = &self.user {
            if user.is_empty()
                || user.len() > 255
                || user.chars().any(char::is_whitespace)
                || user.contains('@')
                || user.starts_with('-')
            {
                return Err(AppError::invalid_argument("ssh user is invalid"));
            }
        }
        if self.port.is_some_and(|port| port == 0) {
            return Err(AppError::invalid_argument(
                "ssh port must be between 1 and 65535",
            ));
        }
        if self
            .password
            .as_ref()
            .is_some_and(|password| password.len() > 1024)
        {
            return Err(AppError::invalid_argument("ssh password is too long"));
        }
        Ok(())
    }
}

/// `#rrggbb` 形式的一对颜色。解析推迟到 PTY 层，坏值只让应答失效，不该拦下整个会话。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPalette {
    pub foreground: String,
    pub background: String,
}

impl CreateTerminalRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.cols == 0 || self.rows == 0 {
            return Err(AppError::invalid_argument(
                "terminal size must be greater than zero",
            ));
        }
        let profile = LaunchProfileId::parse(&self.profile_id)?;
        if self.command.is_some() {
            return Err(AppError::unsupported("custom commands are not supported"));
        }
        match &self.ssh {
            Some(target) => {
                if profile != LaunchProfileId::Ssh {
                    return Err(AppError::invalid_argument(
                        "ssh target requires the ssh launch profile",
                    ));
                }
                target.validate()?;
            }
            None if profile == LaunchProfileId::Ssh => {
                return Err(AppError::invalid_argument(
                    "ssh launch profile requires an ssh target",
                ));
            }
            None => {}
        }
        if let Some(resume) = &self.resume {
            let agent = match profile {
                LaunchProfileId::AgentCodex => AgentKind::Codex,
                LaunchProfileId::AgentClaude => AgentKind::Claude,
                _ => {
                    return Err(AppError::invalid_argument(
                        "resume requires an agent launch profile",
                    ));
                }
            };
            AgentSessionRef {
                agent,
                id: resume.clone(),
            }
            .validate()
            .map_err(AppError::invalid_argument)?;
        }
        if self.elevation != Elevation::Normal {
            return Err(AppError::unsupported(
                "elevated terminals are not supported",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LaunchProfileId {
    SystemDefault,
    ShellZsh,
    ShellBash,
    ShellFish,
    ShellPwsh,
    ShellPowershell,
    ShellCmd,
    ShellWsl,
    ShellGitBash,
    AgentCodex,
    AgentClaude,
    Ssh,
}

impl LaunchProfileId {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "system-default" => Ok(Self::SystemDefault),
            "shell:zsh" => Ok(Self::ShellZsh),
            "shell:bash" => Ok(Self::ShellBash),
            "shell:fish" => Ok(Self::ShellFish),
            "shell:pwsh" => Ok(Self::ShellPwsh),
            "shell:powershell" => Ok(Self::ShellPowershell),
            "shell:cmd" => Ok(Self::ShellCmd),
            "shell:wsl" => Ok(Self::ShellWsl),
            "shell:git-bash" => Ok(Self::ShellGitBash),
            "agent:codex" => Ok(Self::AgentCodex),
            "agent:claude" => Ok(Self::AgentClaude),
            "ssh" => Ok(Self::Ssh),
            _ => Err(AppError::unsupported(format!(
                "unsupported terminal launch profile: {value}"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::SystemDefault => "system-default",
            Self::ShellZsh => "shell:zsh",
            Self::ShellBash => "shell:bash",
            Self::ShellFish => "shell:fish",
            Self::ShellPwsh => "shell:pwsh",
            Self::ShellPowershell => "shell:powershell",
            Self::ShellCmd => "shell:cmd",
            Self::ShellWsl => "shell:wsl",
            Self::ShellGitBash => "shell:git-bash",
            Self::AgentCodex => "agent:codex",
            Self::AgentClaude => "agent:claude",
            Self::Ssh => "ssh",
        }
    }

    pub fn is_shell(self) -> bool {
        matches!(
            self,
            Self::SystemDefault
                | Self::ShellZsh
                | Self::ShellBash
                | Self::ShellFish
                | Self::ShellPwsh
                | Self::ShellPowershell
                | Self::ShellCmd
                | Self::ShellWsl
                | Self::ShellGitBash
        )
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub id: String,
    pub available: bool,
    pub executable: Option<String>,
    pub is_default: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub platform: Platform,
    pub shell: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub status: TerminalStatus,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TerminalEvent {
    Output {
        session_id: String,
        sequence: u64,
        bytes: Vec<u8>,
        eof: bool,
    },
    Exit {
        session_id: String,
        exit_code: i32,
        reason: TerminalExitReason,
    },
}

#[derive(Clone, Copy, Debug)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

impl TerminalSize {
    pub fn validate(self) -> Result<Self, AppError> {
        if self.cols == 0 || self.rows == 0 {
            return Err(AppError::invalid_argument(
                "terminal size must be greater than zero",
            ));
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_profiles_are_fixed_and_reject_arbitrary_commands() {
        assert_eq!(
            LaunchProfileId::parse("agent:codex").unwrap(),
            LaunchProfileId::AgentCodex
        );
        assert_eq!(
            LaunchProfileId::parse("shell:zsh").unwrap(),
            LaunchProfileId::ShellZsh
        );
        assert_eq!(
            LaunchProfileId::parse("shell:git-bash").unwrap(),
            LaunchProfileId::ShellGitBash
        );
        assert_eq!(
            LaunchProfileId::parse("agent:claude").unwrap(),
            LaunchProfileId::AgentClaude
        );
        assert_eq!(LaunchProfileId::parse("ssh").unwrap(), LaunchProfileId::Ssh);
        assert!(LaunchProfileId::parse("agent:custom").is_err());
        assert!(LaunchProfileId::parse("/bin/sh").is_err());
    }

    #[test]
    fn launch_profile_ids_round_trip_to_the_frontend_contract() {
        let ids = [
            LaunchProfileId::SystemDefault,
            LaunchProfileId::ShellZsh,
            LaunchProfileId::ShellBash,
            LaunchProfileId::ShellFish,
            LaunchProfileId::ShellPwsh,
            LaunchProfileId::ShellPowershell,
            LaunchProfileId::ShellCmd,
            LaunchProfileId::ShellWsl,
            LaunchProfileId::ShellGitBash,
            LaunchProfileId::AgentCodex,
            LaunchProfileId::AgentClaude,
            LaunchProfileId::Ssh,
        ];
        for id in ids {
            assert_eq!(LaunchProfileId::parse(id.as_str()).unwrap(), id);
        }
    }

    #[test]
    fn ssh_targets_reject_hosts_that_could_escape_the_argument_list() {
        let valid = SshTarget {
            host: "example.com".to_string(),
            user: Some("root".to_string()),
            port: Some(2222),
            password: None,
            remember_password: None,
        };
        assert!(valid.validate().is_ok());

        for host in [
            "",
            " ",
            "a b",
            "a/b",
            "a\\b",
            "-oProxyCommand=evil",
            "-host",
        ] {
            let target = SshTarget {
                host: host.to_string(),
                user: None,
                port: None,
                password: None,
                remember_password: None,
            };
            assert!(target.validate().is_err(), "host {host:?} must be rejected");
        }
        for user in ["", "a b", "a@b", "-oProxyCommand=evil"] {
            let target = SshTarget {
                host: "example.com".to_string(),
                user: Some(user.to_string()),
                port: None,
                password: None,
                remember_password: None,
            };
            assert!(target.validate().is_err(), "user {user:?} must be rejected");
        }
        let zero_port = SshTarget {
            host: "example.com".to_string(),
            user: None,
            port: Some(0),
            password: None,
            remember_password: None,
        };
        assert!(zero_port.validate().is_err());
    }

    #[test]
    fn ssh_password_rules_guard_length_only() {
        let mut target = SshTarget {
            host: "example.com".to_string(),
            user: None,
            port: None,
            password: Some("secret".to_string()),
            remember_password: None,
        };
        assert!(target.validate().is_ok());

        target.remember_password = Some(true);
        assert!(target.validate().is_ok(), "password + remember is valid");

        // 空密码 + 记住 = 视为"用已保存的"，连接不拦。
        target.password = None;
        assert!(target.validate().is_ok());

        target.password = Some("x".repeat(1025));
        target.remember_password = None;
        assert!(
            target.validate().is_err(),
            "overlong passwords must be rejected"
        );
    }

    #[test]
    fn ssh_profile_and_target_must_come_together() {
        let mut request = CreateTerminalRequest {
            platform: Platform::Macos,
            profile_id: "ssh".to_string(),
            cwd: Some("file:///tmp".to_string()),
            command: None,
            env: std::collections::HashMap::new(),
            resume: None,
            ssh: None,
            cols: 120,
            rows: 36,
            elevation: Elevation::Normal,
            palette: None,
        };
        assert!(request.validate().is_err(), "ssh profile without a target");

        request.ssh = Some(SshTarget {
            host: "example.com".to_string(),
            user: None,
            port: None,
            password: None,
            remember_password: None,
        });
        assert!(request.validate().is_ok());

        request.profile_id = "system-default".to_string();
        assert!(
            request.validate().is_err(),
            "target without the ssh profile"
        );
    }

    #[test]
    fn resume_uses_the_agent_session_id_contract() {
        let mut request = CreateTerminalRequest {
            platform: Platform::Macos,
            profile_id: "agent:codex".to_string(),
            cwd: Some("file:///tmp".to_string()),
            command: None,
            env: std::collections::HashMap::new(),
            resume: Some(".".to_string()),
            ssh: None,
            cols: 120,
            rows: 36,
            elevation: Elevation::Normal,
            palette: None,
        };
        assert!(request.validate().is_err());
        request.resume = Some("x".repeat(513));
        assert!(request.validate().is_err());
    }
}
