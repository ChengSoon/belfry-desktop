use std::path::Path;

use serde_json::Value;

use crate::agent::AgentKind;

use super::contracts::{CheckKind, CheckState, EnvironmentCheck};
use super::process;

pub fn checks(executable: &Path) -> Vec<EnvironmentCheck> {
    vec![auth_check(executable)]
}

fn auth_check(executable: &Path) -> EnvironmentCheck {
    match process::run(executable, &["auth", "status", "--json"]) {
        Ok(output) if output.status.success() => auth_result(&output.stdout),
        Ok(_) => check(CheckState::Warning, "无法读取 Claude Code 登录状态"),
        Err(error) => check(CheckState::Warning, format!("登录检查失败：{error}")),
    }
}

fn auth_result(stdout: &[u8]) -> EnvironmentCheck {
    match auth_logged_in(stdout) {
        Some(true) => check(CheckState::Ok, "Claude Code 已登录"),
        Some(false) => check(CheckState::Warning, "Claude Code 尚未登录"),
        None => check(CheckState::Warning, "无法解析 Claude Code 登录状态"),
    }
}

fn auth_logged_in(stdout: &[u8]) -> Option<bool> {
    let value: Value = serde_json::from_slice(stdout).ok()?;
    value
        .get("loggedIn")
        .or_else(|| value.get("logged_in"))
        .and_then(Value::as_bool)
}

fn check(state: CheckState, summary: impl Into<String>) -> EnvironmentCheck {
    EnvironmentCheck::new(CheckKind::Auth(AgentKind::Claude), state, summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_redacted_auth_status() {
        let output = br#"{"loggedIn":true,"email":"private@example.com"}"#;
        assert_eq!(auth_logged_in(output), Some(true));
    }
}
