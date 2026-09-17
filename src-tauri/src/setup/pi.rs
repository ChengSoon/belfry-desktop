//! Pi 的登录检查。
//!
//! Pi 的 `pi auth check` 需要 --provider/--model 才能跑，不适合做通用探活；
//! 凭据落在 `~/.pi/agent/auth.json` 里（`/login` 写入），或者由环境变量提供
//! （如 `ANTHROPIC_API_KEY`）。这里读 auth.json 是否含至少一条凭据：
//! Pi 首次运行会建一个空 `{}`，只看文件存在会误报「已配置凭据」。

use std::path::Path;

use crate::agent::AgentKind;

use super::contracts::{CheckKind, CheckState, EnvironmentCheck};
use super::process;

pub fn checks(executable: &Path) -> Vec<EnvironmentCheck> {
    vec![auth_check(executable)]
}

fn auth_check(executable: &Path) -> EnvironmentCheck {
    match auth_credentials() {
        Ok(0) | Err(_) => {}
        Ok(count) => {
            return check(CheckState::Ok, format!("Pi 已配置凭据（{count} 项）"));
        }
    }
    match process::run(executable, &["--version"]) {
        Ok(output) if output.status.success() => check(
            CheckState::Warning,
            "Pi 尚未登录：在会话内执行 /login，或设置 API Key 环境变量",
        ),
        Ok(_) => check(CheckState::Warning, "Pi 无法正常启动，无法确认登录状态"),
        Err(error) => check(CheckState::Warning, format!("登录检查失败：{error}")),
    }
}

/// auth.json 里的凭据条目数；文件不存在或为空对象返回 0。
fn auth_credentials() -> Result<usize, std::io::Error> {
    let Some(dir) = crate::history::scan::pi_config_dir() else {
        return Ok(0);
    };
    let text = std::fs::read_to_string(dir.join("auth.json"))?;
    Ok(serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|value| value.as_object().map(|object| object.len()))
        .unwrap_or(0))
}

fn check(state: CheckState, summary: impl Into<String>) -> EnvironmentCheck {
    EnvironmentCheck::new(CheckKind::Auth(AgentKind::Pi), state, summary)
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_empty_auth_file_reports_zero_credentials() {
        // 真实环境里 Pi 首次运行就留下这个；不能当成已登录。
        assert_eq!(auth_credentials_for("{}"), 0);
        assert_eq!(auth_credentials_for(""), 0);
        assert_eq!(auth_credentials_for("not json"), 0);
    }

    #[test]
    fn credentials_are_counted() {
        assert_eq!(
            auth_credentials_for(r#"{"anthropic":{"type":"api_key","key":"sk"}}"#),
            1
        );
    }

    fn auth_credentials_for(text: &str) -> usize {
        serde_json::from_str::<serde_json::Value>(text)
            .ok()
            .and_then(|value| value.as_object().map(|object| object.len()))
            .unwrap_or(0)
    }
}
