use serde::Serialize;

use crate::agent::AgentKind;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckState {
    Ok,
    Warning,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CheckKind {
    Diagnostics,
    Skill(AgentKind),
    Cli(AgentKind),
    Auth(AgentKind),
    MultiAgent(AgentKind),
    Doctor(AgentKind),
    Collaboration,
}

impl CheckKind {
    fn id(self) -> String {
        match self {
            Self::Diagnostics => "diagnostics".to_string(),
            Self::Skill(agent) => format!("{}-skill", agent.command_name()),
            Self::Cli(agent) => format!("{}-cli", agent.command_name()),
            Self::Auth(agent) => format!("{}-auth", agent.command_name()),
            Self::MultiAgent(agent) => format!("{}-multi-agent", agent.command_name()),
            Self::Doctor(agent) => format!("{}-doctor", agent.command_name()),
            Self::Collaboration => "collaboration".to_string(),
        }
    }

    fn label(self) -> String {
        match self {
            Self::Diagnostics => "环境检查".to_string(),
            Self::Skill(agent) => format!("{} Belfry skill", agent.display_name()),
            Self::Cli(agent) => format!("{} CLI", agent.display_name()),
            Self::Auth(agent) => format!("{} 登录状态", agent.display_name()),
            Self::MultiAgent(agent) => format!("{} 多 Agent", agent.display_name()),
            Self::Doctor(agent) => format!("{} 自检", agent.display_name()),
            Self::Collaboration => "协作通道".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentCheck {
    pub id: String,
    pub label: String,
    pub state: CheckState,
    pub summary: String,
}

impl EnvironmentCheck {
    pub fn new(kind: CheckKind, state: CheckState, summary: impl Into<String>) -> Self {
        Self {
            id: kind.id(),
            label: kind.label(),
            state,
            summary: summary.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub overall: CheckState,
    pub checked_at: u64,
    pub checks: Vec<EnvironmentCheck>,
}

impl EnvironmentReport {
    pub fn new(checks: Vec<EnvironmentCheck>) -> Self {
        let overall = if checks.iter().any(|check| check.state == CheckState::Error) {
            CheckState::Error
        } else if checks
            .iter()
            .any(|check| check.state == CheckState::Warning)
        {
            CheckState::Warning
        } else {
            CheckState::Ok
        };
        Self {
            overall,
            checked_at: unix_seconds(),
            checks,
        }
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self::new(vec![EnvironmentCheck::new(
            CheckKind::Diagnostics,
            CheckState::Error,
            message,
        )])
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillInstallAction {
    Installed,
    Updated,
    Unchanged,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallTargetOutcome {
    pub agent: AgentKind,
    pub action: SkillInstallAction,
    pub path: Option<String>,
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallOutcome {
    pub results: Vec<SkillInstallTargetOutcome>,
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn agent_check_ids_are_unique() {
        let kinds = AgentKind::ALL.into_iter().flat_map(|agent| {
            [
                CheckKind::Skill(agent),
                CheckKind::Cli(agent),
                CheckKind::Auth(agent),
                CheckKind::MultiAgent(agent),
                CheckKind::Doctor(agent),
            ]
        });
        let ids: Vec<_> = kinds.map(CheckKind::id).collect();
        let unique: HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len());
    }
}
