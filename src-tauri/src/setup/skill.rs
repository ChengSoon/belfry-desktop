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
    /// `~/.agents/skills/` 里已有逐字相同的一份，由它供给，我们不再装 agent 专属那份。
    Shared,
}

pub struct SkillInspection {
    pub agent: AgentKind,
    pub state: SkillState,
    pub path: PathBuf,
}

pub fn inspect(agent: AgentKind) -> Result<SkillInspection, AppError> {
    inspect_in(agent, &config_dir(agent)?, shared_skill_path().as_deref())
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
    install_in(agent, &root, shared_skill_path().as_deref())
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
    let home = crate::usage::home_dir()
        .ok_or_else(|| AppError::not_found("找不到当前用户的 home 目录"))?;
    Ok(match agent {
        AgentKind::Codex => env_root("CODEX_HOME").unwrap_or_else(|| home.join(".codex")),
        AgentKind::Claude => env_root("CLAUDE_CONFIG_DIR").unwrap_or_else(|| home.join(".claude")),
        // Pi 的全局 skills 在 `~/.pi/agent/skills/`。
        AgentKind::Pi => env_root("PI_CODING_AGENT_DIR").unwrap_or_else(|| home.join(".pi").join("agent")),
    })
}

fn env_root(variable: &str) -> Option<PathBuf> {
    std::env::var_os(variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// Pi 除了自己的 `skills/`，还会扫用户级的 `~/.agents/skills/`（跨 agent 共享约定，
/// 见 pi 的 `package-manager.js` userAgentsSkillsDir）。同名 skill 同时出现在两处时
/// pi 会在启动时报 collision，所以共享目录已有逐字相同的一份时就让路，不再装我们那份。
///
/// 路径基于 home，与 `PI_CODING_AGENT_DIR` 无关——pi 那边也是从 home 取的。
fn shared_skill_path() -> Option<PathBuf> {
    crate::usage::home_dir().map(|home| {
        home.join(".agents")
            .join("skills")
            .join("belfry")
            .join("SKILL.md")
    })
}

/// 共享目录是否已经供给了当前版本。内容不一致时不算：那是用户自己的文件，我们既不
/// 覆盖它、也不能假装它等价，照常装自己那份，让 pi 优先用 agent 专属目录里的新版。
fn shared_provides_current(agent: AgentKind, shared: Option<&Path>) -> bool {
    if agent != AgentKind::Pi {
        return false;
    }
    shared.is_some_and(|path| {
        std::fs::read_to_string(path).is_ok_and(|current| current == BELFRY_SKILL)
    })
}

fn inspect_in(
    agent: AgentKind,
    config_dir: &Path,
    shared: Option<&Path>,
) -> Result<SkillInspection, AppError> {
    if shared_provides_current(agent, shared) {
        return Ok(SkillInspection {
            agent,
            state: SkillState::Shared,
            // 报共享目录那份的路径：那才是 pi 实际加载的文件。
            path: shared.expect("shared_provides_current 已确认非空").to_path_buf(),
        });
    }
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

fn install_in(
    agent: AgentKind,
    config_dir: &Path,
    shared: Option<&Path>,
) -> Result<SkillInstallTargetOutcome, AppError> {
    let inspection = inspect_in(agent, config_dir, shared)?;
    if inspection.state == SkillState::Shared {
        // 让路的同时把我们以前装的那份收掉，否则 collision 提示会一直在。
        let removed = remove_own_copy(&skill_path(config_dir))?;
        return Ok(SkillInstallTargetOutcome {
            agent,
            action: SkillInstallAction::Unchanged,
            path: Some(inspection.path.to_string_lossy().into_owned()),
            summary: if removed {
                "已由共享目录提供，移除了重复的一份".to_string()
            } else {
                "已由共享目录提供".to_string()
            },
        });
    }
    let action = match inspection.state {
        SkillState::Current | SkillState::Shared => SkillInstallAction::Unchanged,
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

/// 删掉 agent 专属目录里我们自己装的那份，返回是否真的动了磁盘。
/// 只认逐字相同的内容：被用户改过就留着，不替他做决定。
fn remove_own_copy(path: &Path) -> Result<bool, AppError> {
    match std::fs::read_to_string(path) {
        Ok(current) if current == BELFRY_SKILL => {
            std::fs::remove_file(path)
                .map_err(|error| AppError::io(format!("删不掉 {}：{error}", path.display())))?;
            // `skills/belfry/` 空了就一并收掉，非空时 remove_dir 自己会失败，忽略即可。
            if let Some(parent) = path.parent() {
                let _ = std::fs::remove_dir(parent);
            }
            Ok(true)
        }
        _ => Ok(false),
    }
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

        let outcome = install_in(AgentKind::Codex, &home, None).unwrap();

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
        install_in(AgentKind::Claude, &home, None).unwrap();

        let outcome = install_in(AgentKind::Claude, &home, None).unwrap();

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

        let outcome = install_in(AgentKind::Codex, &home, None).unwrap();

        assert_eq!(outcome.action, SkillInstallAction::Updated);
        assert_eq!(std::fs::read_to_string(path).unwrap(), BELFRY_SKILL);
        let _ = std::fs::remove_dir_all(home);
    }

    /// 在 `root` 下造一份共享 skill，返回它的路径。
    fn shared_copy(root: &Path, contents: &str) -> PathBuf {
        let path = root
            .join(".agents")
            .join("skills")
            .join("belfry")
            .join("SKILL.md");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn a_current_shared_copy_takes_over_for_pi() {
        let home = temp_dir("shared-pi");
        let shared = shared_copy(&home, BELFRY_SKILL);

        let outcome = install_in(AgentKind::Pi, &home, Some(&shared)).unwrap();

        assert_eq!(outcome.action, SkillInstallAction::Unchanged);
        assert_eq!(outcome.path.as_deref(), Some(&*shared.to_string_lossy()));
        // 没有往 pi 专属目录写，否则 pi 启动会报 collision。
        assert!(!skill_path(&home).exists());
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn taking_over_clears_the_copy_we_installed_before() {
        let home = temp_dir("shared-cleanup");
        install_in(AgentKind::Pi, &home, None).unwrap();
        assert!(skill_path(&home).exists());
        let shared = shared_copy(&home, BELFRY_SKILL);

        let outcome = install_in(AgentKind::Pi, &home, Some(&shared)).unwrap();

        assert!(outcome.summary.contains("移除"));
        assert!(!skill_path(&home).exists());
        // 空壳目录也一并收掉。
        assert!(!skill_path(&home).parent().unwrap().exists());
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn a_hand_edited_copy_is_left_alone() {
        let home = temp_dir("shared-keep-edits");
        let path = skill_path(&home);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "用户自己改过的内容").unwrap();
        let shared = shared_copy(&home, BELFRY_SKILL);

        install_in(AgentKind::Pi, &home, Some(&shared)).unwrap();

        // 不是我们装的内容，不替用户删。
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "用户自己改过的内容"
        );
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn an_outdated_shared_copy_does_not_count() {
        let home = temp_dir("shared-outdated");
        let shared = shared_copy(&home, "旧版共享 skill");

        let outcome = install_in(AgentKind::Pi, &home, Some(&shared)).unwrap();

        // 共享那份过期：照常装自己的，让 pi 优先用 agent 专属目录里的新版。
        assert_eq!(outcome.action, SkillInstallAction::Installed);
        assert_eq!(
            std::fs::read_to_string(skill_path(&home)).unwrap(),
            BELFRY_SKILL
        );
        // 用户共享目录里的文件一个字都没动。
        assert_eq!(std::fs::read_to_string(&shared).unwrap(), "旧版共享 skill");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn the_shared_directory_only_applies_to_pi() {
        let home = temp_dir("shared-pi-only");
        let shared = shared_copy(&home, BELFRY_SKILL);

        // Codex / Claude 不扫 ~/.agents/skills，照常装自己那份。
        for agent in [AgentKind::Codex, AgentKind::Claude] {
            let root = home.join(agent.command_name());
            let outcome = install_in(agent, &root, Some(&shared)).unwrap();
            assert_eq!(outcome.action, SkillInstallAction::Installed);
            assert!(skill_path(&root).exists());
        }
        let _ = std::fs::remove_dir_all(home);
    }
}
