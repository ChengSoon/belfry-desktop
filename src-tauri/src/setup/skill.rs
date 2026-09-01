use std::path::{Path, PathBuf};

use crate::agent::AgentKind;
use crate::atomic::write_atomic;
use crate::terminal::AppError;

use super::contracts::{SkillInstallAction, SkillInstallOutcome, SkillInstallTargetOutcome};

const BELFRY_SKILL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../skills/belfry/SKILL.md"
));

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SkillState {
    Current,
    Missing,
    Outdated,
}

pub struct SkillInspection {
    pub agent: AgentKind,
    pub state: SkillState,
    pub path: PathBuf,
}

pub fn inspect(agent: AgentKind) -> Result<SkillInspection, AppError> {
    inspect_in(agent, &config_dir(agent)?)
}

pub fn install_all() -> SkillInstallOutcome {
    let results = AgentKind::ALL.into_iter().map(install_target).collect();
    SkillInstallOutcome { results }
}

fn install_target(agent: AgentKind) -> SkillInstallTargetOutcome {
    let root = match config_dir(agent) {
        Ok(root) => root,
        Err(error) => {
            return failed_outcome(agent, None, error.message);
        }
    };
    install_in(agent, &root)
        .unwrap_or_else(|error| failed_outcome(agent, Some(skill_path(&root)), error.message))
}

fn failed_outcome(
    agent: AgentKind,
    path: Option<PathBuf>,
    summary: impl Into<String>,
) -> SkillInstallTargetOutcome {
    SkillInstallTargetOutcome {
        agent,
        action: SkillInstallAction::Failed,
        path: path.map(|value| value.to_string_lossy().into_owned()),
        summary: summary.into(),
    }
}

fn config_dir(agent: AgentKind) -> Result<PathBuf, AppError> {
    let env = match agent {
        AgentKind::Codex => "CODEX_HOME",
        AgentKind::Claude => "CLAUDE_CONFIG_DIR",
    };
    if let Some(path) = std::env::var_os(env).filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let home = crate::usage::home_dir()
        .ok_or_else(|| AppError::not_found("找不到当前用户的 home 目录"))?;
    Ok(match agent {
        AgentKind::Codex => home.join(".codex"),
        AgentKind::Claude => home.join(".claude"),
    })
}

fn inspect_in(agent: AgentKind, config_dir: &Path) -> Result<SkillInspection, AppError> {
    let path = skill_path(config_dir);
    let state = match std::fs::read_to_string(&path) {
        Ok(current) if current == BELFRY_SKILL => SkillState::Current,
        Ok(_) => SkillState::Outdated,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SkillState::Missing,
        Err(error) => {
            return Err(AppError::io(format!("读不了 {}：{error}", path.display())));
        }
    };
    Ok(SkillInspection { agent, state, path })
}

fn install_in(agent: AgentKind, config_dir: &Path) -> Result<SkillInstallTargetOutcome, AppError> {
    let inspection = inspect_in(agent, config_dir)?;
    let action = match inspection.state {
        SkillState::Current => SkillInstallAction::Unchanged,
        SkillState::Missing => SkillInstallAction::Installed,
        SkillState::Outdated => SkillInstallAction::Updated,
    };
    if action != SkillInstallAction::Unchanged {
        write_atomic(&inspection.path, BELFRY_SKILL, false)?;
    }
    Ok(SkillInstallTargetOutcome {
        agent,
        action,
        path: Some(inspection.path.to_string_lossy().into_owned()),
        summary: action_summary(action).to_string(),
    })
}

fn action_summary(action: SkillInstallAction) -> &'static str {
    match action {
        SkillInstallAction::Installed => "已安装",
        SkillInstallAction::Updated => "已更新",
        SkillInstallAction::Unchanged => "已是最新",
        SkillInstallAction::Failed => "安装失败",
    }
}

fn skill_path(config_dir: &Path) -> PathBuf {
    config_dir.join("skills").join("belfry").join("SKILL.md")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "belfry-setup-skill-{tag}-{}-{}",
            std::process::id(),
            ulid::Ulid::generate()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn installs_a_missing_skill() {
        let home = temp_dir("install");

        let outcome = install_in(AgentKind::Codex, &home).unwrap();

        assert_eq!(outcome.action, SkillInstallAction::Installed);
        assert_eq!(
            std::fs::read_to_string(skill_path(&home)).unwrap(),
            BELFRY_SKILL
        );
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn leaves_the_current_skill_untouched() {
        let home = temp_dir("current");
        install_in(AgentKind::Claude, &home).unwrap();

        let outcome = install_in(AgentKind::Claude, &home).unwrap();

        assert_eq!(outcome.agent, AgentKind::Claude);
        assert_eq!(outcome.action, SkillInstallAction::Unchanged);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn updates_an_outdated_skill() {
        let home = temp_dir("update");
        let path = skill_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old skill").unwrap();

        let outcome = install_in(AgentKind::Codex, &home).unwrap();

        assert_eq!(outcome.action, SkillInstallAction::Updated);
        assert_eq!(std::fs::read_to_string(path).unwrap(), BELFRY_SKILL);
        let _ = std::fs::remove_dir_all(home);
    }
}
