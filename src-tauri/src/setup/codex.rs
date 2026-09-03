use std::path::Path;

use serde_json::Value;

use crate::agent::AgentKind;

use super::contracts::{CheckKind, CheckState, EnvironmentCheck};
use super::process;

pub fn checks(executable: &Path) -> Vec<EnvironmentCheck> {
    vec![
        login_check(executable),
        multi_agent_check(executable),
        doctor_check(executable),
    ]
}

fn login_check(executable: &Path) -> EnvironmentCheck {
    match process::run(executable, &["login", "status"]) {
        Ok(output) if output.status.success() => check(
            CheckKind::Auth(AgentKind::Codex),
            CheckState::Ok,
            "Codex 已登录",
        ),
        Ok(_) => check(
            CheckKind::Auth(AgentKind::Codex),
            CheckState::Warning,
            "Codex 尚未登录",
        ),
        Err(error) => check(
            CheckKind::Auth(AgentKind::Codex),
            CheckState::Warning,
            format!("无法检查登录状态：{error}"),
        ),
    }
}

fn multi_agent_check(executable: &Path) -> EnvironmentCheck {
    match process::run(executable, &["features", "list"]) {
        Ok(output) if output.status.success() => multi_agent_result(&output.stdout),
        Ok(_) => check(
            CheckKind::MultiAgent(AgentKind::Codex),
            CheckState::Warning,
            "无法读取 Codex 功能列表",
        ),
        Err(error) => check(
            CheckKind::MultiAgent(AgentKind::Codex),
            CheckState::Warning,
            format!("功能检查失败：{error}"),
        ),
    }
}

fn multi_agent_result(output: &[u8]) -> EnvironmentCheck {
    match multi_agent_enabled(output) {
        Some(true) => check(
            CheckKind::MultiAgent(AgentKind::Codex),
            CheckState::Ok,
            "Codex multi_agent 已启用",
        ),
        Some(false) => check(
            CheckKind::MultiAgent(AgentKind::Codex),
            CheckState::Warning,
            "Codex multi_agent 未启用",
        ),
        None => check(
            CheckKind::MultiAgent(AgentKind::Codex),
            CheckState::Warning,
            "当前 Codex 未报告 multi_agent 功能",
        ),
    }
}

fn doctor_check(executable: &Path) -> EnvironmentCheck {
    let output = match process::run(executable, &["doctor", "--json", "--no-color"]) {
        Ok(output) => output,
        Err(error) => {
            return check(
                CheckKind::Doctor(AgentKind::Codex),
                CheckState::Warning,
                format!("无法运行 doctor：{error}"),
            );
        }
    };
    serde_json::from_slice::<Value>(&output.stdout)
        .ok()
        .and_then(|value| doctor_summary(&value))
        .unwrap_or_else(|| {
            check(
                CheckKind::Doctor(AgentKind::Codex),
                if output.status.success() {
                    CheckState::Warning
                } else {
                    CheckState::Error
                },
                "无法解析 codex doctor 输出",
            )
        })
}

fn multi_agent_enabled(stdout: &[u8]) -> Option<bool> {
    for line in String::from_utf8_lossy(stdout).lines() {
        let columns: Vec<&str> = line.split_whitespace().collect();
        if columns.first() == Some(&"multi_agent") {
            return columns.last()?.parse::<bool>().ok();
        }
    }
    None
}

fn doctor_summary(value: &Value) -> Option<EnvironmentCheck> {
    let checks = value.get("checks")?.as_object()?;
    let (mut ok, mut warnings, mut failed) = (0, 0, 0);
    for item in checks.values() {
        match item.get("status").and_then(Value::as_str) {
            Some("ok") => ok += 1,
            Some("warning") => warnings += 1,
            Some("fail") => failed += 1,
            _ => {}
        }
    }
    let state = match value.get("overallStatus").and_then(Value::as_str) {
        Some("ok") if warnings == 0 => CheckState::Ok,
        Some("fail") => CheckState::Error,
        _ => CheckState::Warning,
    };
    Some(check(
        CheckKind::Doctor(AgentKind::Codex),
        state,
        format!("通过 {ok}，警告 {warnings}，失败 {failed}"),
    ))
}

fn check(kind: CheckKind, state: CheckState, summary: impl Into<String>) -> EnvironmentCheck {
    EnvironmentCheck::new(kind, state, summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_multi_agent_flag() {
        let output = b"shell_tool stable true\nmulti_agent stable true\n";
        assert_eq!(multi_agent_enabled(output), Some(true));
    }

    #[test]
    fn summarizes_redacted_doctor_results() {
        let value = serde_json::json!({
            "overallStatus": "fail",
            "checks": {
                "one": { "status": "ok" },
                "two": { "status": "warning" },
                "three": { "status": "fail" }
            }
        });
        let check = doctor_summary(&value).unwrap();
        assert_eq!(check.state, CheckState::Error);
        assert_eq!(check.summary, "通过 1，警告 1，失败 1");
    }
}
