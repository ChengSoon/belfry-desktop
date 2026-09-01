use std::path::{Path, PathBuf};

use crate::atomic::write_atomic;
use crate::terminal::AppError;

use super::contracts::{SkillInstallAction, SkillInstallOutcome};

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
    pub state: SkillState,
    pub path: PathBuf,
}

pub fn inspect() -> Result<SkillInspection, AppError> {
    inspect_in(&codex_home()?)
}

pub fn install() -> Result<SkillInstallOutcome, AppError> {
    install_in(&codex_home()?)
}

fn codex_home() -> Result<PathBuf, AppError> {
    if let Some(path) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    crate::usage::home_dir()
        .map(|home| home.join(".codex"))
        .ok_or_else(|| AppError::not_found("找不到当前用户的 home 目录"))
}

fn inspect_in(codex_home: &Path) -> Result<SkillInspection, AppError> {
    let path = skill_path(codex_home);
    let state = match std::fs::read_to_string(&path) {
        Ok(current) if current == BELFRY_SKILL => SkillState::Current,
        Ok(_) => SkillState::Outdated,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SkillState::Missing,
        Err(error) => {
            return Err(AppError::io(format!("读不了 {}：{error}", path.display())));
        }
    };
    Ok(SkillInspection { state, path })
}

fn install_in(codex_home: &Path) -> Result<SkillInstallOutcome, AppError> {
    let inspection = inspect_in(codex_home)?;
    let action = match inspection.state {
        SkillState::Current => SkillInstallAction::Unchanged,
        SkillState::Missing => SkillInstallAction::Installed,
        SkillState::Outdated => SkillInstallAction::Updated,
    };
    if action != SkillInstallAction::Unchanged {
        write_atomic(&inspection.path, BELFRY_SKILL, false)?;
    }
    Ok(SkillInstallOutcome {
        action,
        path: inspection.path.to_string_lossy().into_owned(),
    })
}

fn skill_path(codex_home: &Path) -> PathBuf {
    codex_home.join("skills").join("belfry").join("SKILL.md")
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

        let outcome = install_in(&home).unwrap();

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
        install_in(&home).unwrap();

        let outcome = install_in(&home).unwrap();

        assert_eq!(outcome.action, SkillInstallAction::Unchanged);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn updates_an_outdated_skill() {
        let home = temp_dir("update");
        let path = skill_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old skill").unwrap();

        let outcome = install_in(&home).unwrap();

        assert_eq!(outcome.action, SkillInstallAction::Updated);
        assert_eq!(std::fs::read_to_string(path).unwrap(), BELFRY_SKILL);
        let _ = std::fs::remove_dir_all(home);
    }
}
