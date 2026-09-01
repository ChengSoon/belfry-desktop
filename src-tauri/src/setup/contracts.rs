use serde::Serialize;

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
    Skill,
    Codex,
    Auth,
    MultiAgent,
    Doctor,
    Collaboration,
}

impl CheckKind {
    fn id(self) -> &'static str {
        match self {
            Self::Diagnostics => "diagnostics",
            Self::Skill => "skill",
            Self::Codex => "codex",
            Self::Auth => "auth",
            Self::MultiAgent => "multi-agent",
            Self::Doctor => "doctor",
            Self::Collaboration => "collaboration",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Diagnostics => "环境检查",
            Self::Skill => "Belfry skill",
            Self::Codex => "Codex CLI",
            Self::Auth => "登录状态",
            Self::MultiAgent => "多 Agent",
            Self::Doctor => "Codex 自检",
            Self::Collaboration => "协作通道",
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
            id: kind.id().to_string(),
            label: kind.label().to_string(),
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
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallOutcome {
    pub action: SkillInstallAction,
    pub path: String,
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}
