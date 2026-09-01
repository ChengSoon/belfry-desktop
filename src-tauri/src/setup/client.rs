use std::path::Path;

use crate::agent::{AgentKind, resolve_agent};

use super::contracts::{CheckKind, CheckState, EnvironmentCheck};
use super::{claude, codex, process};

pub fn checks(agent: AgentKind) -> Vec<EnvironmentCheck> {
    let executable = match resolve_agent(agent) {
        Ok(executable) => executable,
        Err(_) => return vec![missing_cli_check(agent)],
    };
    let mut checks = vec![version_check(agent, &executable)];
    match agent {
        AgentKind::Codex => checks.extend(codex::checks(&executable)),
        AgentKind::Claude => checks.extend(claude::checks(&executable)),
    }
    checks
}

fn missing_cli_check(agent: AgentKind) -> EnvironmentCheck {
    EnvironmentCheck::new(
        CheckKind::Cli(agent),
        CheckState::Warning,
        format!("未找到 {} CLI（可选）", agent.display_name()),
    )
}

fn version_check(agent: AgentKind, executable: &Path) -> EnvironmentCheck {
    match process::run(executable, &["--version"]) {
        Ok(output) if output.status.success() => EnvironmentCheck::new(
            CheckKind::Cli(agent),
            CheckState::Ok,
            process::first_output_line(&output).unwrap_or_else(|| "已安装".to_string()),
        ),
        Ok(_) => EnvironmentCheck::new(
            CheckKind::Cli(agent),
            CheckState::Error,
            format!("{} 无法正常启动", agent.display_name()),
        ),
        Err(error) => EnvironmentCheck::new(
            CheckKind::Cli(agent),
            CheckState::Error,
            format!("启动失败：{error}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_optional_agent_is_a_warning() {
        let check = missing_cli_check(AgentKind::Claude);

        assert_eq!(check.state, CheckState::Warning);
        assert_eq!(check.id, "claude-cli");
    }
}
