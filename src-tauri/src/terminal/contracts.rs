use serde::{Deserialize, Serialize};

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
    pub cols: u16,
    pub rows: u16,
    pub elevation: Elevation,
    /// 当前主题的默认前景 / 背景色，用来应答子进程的 OSC 10/11 查询。
    /// 缺省时不应答，退回让 xterm.js 自己答。
    #[serde(default)]
    pub palette: Option<TerminalPalette>,
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
        LaunchProfileId::parse(&self.profile_id)?;
        if self.command.is_some() {
            return Err(AppError::unsupported("custom commands are not supported"));
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
    AgentCodex,
    AgentClaude,
}

impl LaunchProfileId {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "system-default" => Ok(Self::SystemDefault),
            "agent:codex" => Ok(Self::AgentCodex),
            "agent:claude" => Ok(Self::AgentClaude),
            _ => Err(AppError::unsupported(format!(
                "unsupported terminal launch profile: {value}"
            ))),
        }
    }
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
            LaunchProfileId::parse("agent:claude").unwrap(),
            LaunchProfileId::AgentClaude
        );
        assert!(LaunchProfileId::parse("agent:custom").is_err());
    }
}
