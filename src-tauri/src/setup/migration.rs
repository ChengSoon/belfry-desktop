//! Retire only known, unmodified copies of the former collaboration skill.
//! No skill contents are bundled or installed by the new host.
use crate::{agent::AgentKind, terminal::AppError};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

// SHA-256 of the two pristine assets shipped before the A2A migration. These
// hashes identify ownership; a filename or front-matter name alone never does.
const KNOWN: &[&str] = &[
    "163a3a20580f095be07a09ac35dacf24c2079613f86f017e4619d78178d4b469",
    "f649c924cf091a20d4ba01a5a3f57d3750b2c860c01f7a13721bec80f531a28a",
];
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum CopyState {
    Missing,
    Bundled,
    Preserved,
    Removed,
}
pub(super) struct Inspection {
    pub label: String,
    pub path: PathBuf,
    pub state: Result<CopyState, AppError>,
}

pub(super) fn migrate_all() -> Vec<Inspection> {
    targets(true)
}
pub(super) fn inspect_all() -> Vec<Inspection> {
    targets(false)
}
fn targets(remove: bool) -> Vec<Inspection> {
    let mut out = vec![];
    for agent in AgentKind::ALL {
        match config_dir(agent) {
            Ok(root) => {
                let path = root.join("skills/belfry/SKILL.md");
                let state = inspect_in(&root, &path, KNOWN, remove);
                out.push(Inspection {
                    label: agent.display_name().into(),
                    path,
                    state,
                });
            }
            Err(error) => out.push(Inspection {
                label: agent.display_name().into(),
                path: PathBuf::new(),
                state: Err(error),
            }),
        }
    }
    if let Some(home) = crate::usage::home_dir() {
        out.extend(shared_targets(&home, KNOWN, remove));
    }
    out
}

fn shared_targets(user_root: &Path, known: &[&str], remove: bool) -> Vec<Inspection> {
    // Inspect the known shared source directly. CLI skill roots can point here,
    // but migration must never discover deletion targets by following links.
    [("shared", ".agents"), ("Mirasim shared", ".mirasim")]
        .into_iter()
        .map(|(label, directory)| {
            let root = user_root.join(directory);
            let path = root.join("skills/belfry/SKILL.md");
            let state = inspect_in(&root, &path, known, remove);
            Inspection {
                label: label.into(),
                path,
                state,
            }
        })
        .collect()
}
fn config_dir(agent: AgentKind) -> Result<PathBuf, AppError> {
    let home = crate::usage::home_dir()
        .ok_or_else(|| AppError::not_found("The user home directory is unavailable."))?;
    let root = match agent {
        AgentKind::Codex => env_root("CODEX_HOME").unwrap_or_else(|| home.join(".codex")),
        AgentKind::Claude => env_root("CLAUDE_CONFIG_DIR").unwrap_or_else(|| home.join(".claude")),
        AgentKind::Pi => env_root("PI_CODING_AGENT_DIR").unwrap_or_else(|| home.join(".pi/agent")),
        AgentKind::Antigravity | AgentKind::Opencode | AgentKind::Kimi => {
            crate::agent::paths::config_dir(agent)
                .ok_or_else(|| AppError::not_found("The CLI config directory is unavailable."))?
        }
    };
    if !root.is_absolute() {
        return Err(AppError::invalid_argument(
            "An absolute CLI config directory is required for skill migration.",
        ));
    }
    Ok(root)
}
fn env_root(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn inspect_in(
    root: &Path,
    path: &Path,
    known: &[&str],
    remove: bool,
) -> Result<CopyState, AppError> {
    if !root.is_absolute() || !path.starts_with(root) {
        return Err(AppError::invalid_argument("Invalid skill migration scope."));
    }
    if !safe_parents(root, path)? {
        return Ok(CopyState::Preserved);
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CopyState::Missing);
        }
        Err(_) => {
            return Err(AppError::io(
                "The legacy skill could not be inspected; it was preserved.",
            ));
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 128 * 1024 {
        return Ok(CopyState::Preserved);
    }
    let bytes = read_bounded(path)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    if !known.contains(&digest.as_str()) {
        return Ok(CopyState::Preserved);
    }
    if !remove {
        return Ok(CopyState::Bundled);
    }
    // Recheck immediately before removing, including directories. Do not follow
    // a symlink or remove a changed/customized copy after the initial inspection.
    if !safe_parents(root, path)?
        || fs::symlink_metadata(path).is_ok_and(|current| current.file_type().is_symlink())
        || read_bounded(path)? != bytes
    {
        return Ok(CopyState::Preserved);
    }
    fs::remove_file(path).map_err(|_| {
        AppError::io("The pristine legacy skill could not be removed; no other files were changed.")
    })?;
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
    }
    Ok(CopyState::Removed)
}
fn safe_parents(root: &Path, path: &Path) -> Result<bool, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid_argument("Invalid skill migration path."))?;
    if root.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir | std::path::Component::CurDir
        )
    }) {
        return Ok(false);
    }
    let mut paths = root.ancestors().map(Path::to_path_buf).collect::<Vec<_>>();
    let mut current = root.to_path_buf();
    for component in parent
        .strip_prefix(root)
        .map_err(|_| AppError::invalid_argument("Invalid skill migration scope."))?
        .components()
    {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Ok(false);
        }
        current.push(component);
        paths.push(current.clone());
    }
    for directory in paths {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Ok(false);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(AppError::io(
                    "A legacy skill directory could not be inspected; it was preserved.",
                ));
            }
        }
    }
    Ok(true)
}
fn read_bounded(path: &Path) -> Result<Vec<u8>, AppError> {
    let file = fs::File::open(path)
        .map_err(|_| AppError::io("The legacy skill could not be read; it was preserved."))?;
    let mut bytes = vec![];
    file.take(128 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::io("The legacy skill could not be read; it was preserved."))?;
    if bytes.len() > 128 * 1024 {
        return Err(AppError::io(
            "The legacy skill exceeds the migration limit; it was preserved.",
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "belfry-a2a-skill-migration-{}",
                ulid::Ulid::generate()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(crate::resource::canonicalize(&path).unwrap())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn a2a_skill_migration_removes_only_known_pristine_languages_and_is_idempotent() {
        let root = Temp::new();
        let path = root.0.join("skills/belfry/SKILL.md");
        for contents in ["synthetic pristine 中文", "synthetic pristine English"] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            let digest = format!("{:x}", Sha256::digest(contents.as_bytes()));
            assert!(matches!(
                inspect_in(&root.0, &path, &[&digest], false).unwrap(),
                CopyState::Bundled
            ));
            assert!(matches!(
                inspect_in(&root.0, &path, &[&digest], true).unwrap(),
                CopyState::Removed
            ));
            assert!(!path.exists());
            assert!(matches!(
                inspect_in(&root.0, &path, &[&digest], true).unwrap(),
                CopyState::Missing
            ));
        }
    }
    #[test]
    fn a2a_skill_migration_preserves_custom_copies_other_skills_and_adjacent_files() {
        let root = Temp::new();
        let path = root.0.join("skills/belfry/SKILL.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "customized").unwrap();
        fs::write(path.with_file_name("notes.md"), "user notes").unwrap();
        let other = root.0.join("skills/other/SKILL.md");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&other, "other skill").unwrap();
        assert!(matches!(
            inspect_in(&root.0, &path, KNOWN, true).unwrap(),
            CopyState::Preserved
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), "customized");
        assert_eq!(fs::read_to_string(&other).unwrap(), "other skill");
        let digest = format!("{:x}", Sha256::digest(b"customized"));
        inspect_in(&root.0, &path, &[&digest], true).unwrap();
        assert_eq!(
            fs::read_to_string(path.with_file_name("notes.md")).unwrap(),
            "user notes"
        );
    }
    #[cfg(unix)]
    #[test]
    fn a2a_skill_migration_never_follows_file_or_directory_symlinks() {
        use std::os::unix::fs::symlink;
        let root = Temp::new();
        let outside = Temp::new();
        let target = outside.0.join("SKILL.md");
        fs::write(&target, "pristine").unwrap();
        let digest = format!("{:x}", Sha256::digest(b"pristine"));
        let path = root.0.join("skills/belfry/SKILL.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        symlink(&target, &path).unwrap();
        assert!(matches!(
            inspect_in(&root.0, &path, &[&digest], true).unwrap(),
            CopyState::Preserved
        ));
        fs::remove_file(&path).unwrap();
        fs::remove_dir(path.parent().unwrap()).unwrap();
        symlink(&outside.0, path.parent().unwrap()).unwrap();
        assert!(matches!(
            inspect_in(&root.0, &path, &[&digest], true).unwrap(),
            CopyState::Preserved
        ));
        assert_eq!(fs::read_to_string(&target).unwrap(), "pristine");
        let config = outside.0.join("config");
        let known_path = config.join("skills/belfry/SKILL.md");
        fs::create_dir_all(known_path.parent().unwrap()).unwrap();
        fs::write(&known_path, "pristine").unwrap();
        let alias = root.0.join("alias");
        symlink(&outside.0, &alias).unwrap();
        let linked_root = alias.join("config");
        assert!(matches!(
            inspect_in(
                &linked_root,
                &linked_root.join("skills/belfry/SKILL.md"),
                &[&digest],
                true
            )
            .unwrap(),
            CopyState::Preserved
        ));
        assert_eq!(fs::read_to_string(known_path).unwrap(), "pristine");
    }
    #[cfg(unix)]
    #[test]
    fn a2a_skill_migration_retires_pristine_shared_source_and_preserves_linked_roots() {
        use std::os::unix::fs::symlink;
        let user_root = Temp::new();
        let shared = user_root.0.join(".mirasim/skills");
        let skill = shared.join("belfry/SKILL.md");
        let other = shared.join("other/SKILL.md");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        fs::write(&skill, "synthetic pristine shared source").unwrap();
        fs::write(&other, "keep this independent skill").unwrap();
        let digest = format!("{:x}", Sha256::digest(b"synthetic pristine shared source"));
        for directory in [".agents", ".claude"] {
            let root = user_root.0.join(directory);
            fs::create_dir_all(&root).unwrap();
            symlink(&shared, root.join("skills")).unwrap();
        }
        let inspected = shared_targets(&user_root.0, &[&digest], false);
        assert!(inspected.iter().any(|entry| {
            entry.path == skill && matches!(&entry.state, Ok(CopyState::Bundled))
        }));
        assert!(skill.is_file());
        let migrated = shared_targets(&user_root.0, &[&digest], true);
        assert!(migrated.iter().any(|entry| {
            entry.path == skill && matches!(&entry.state, Ok(CopyState::Removed))
        }));
        assert!(migrated.iter().any(|entry| {
            entry.path == user_root.0.join(".agents/skills/belfry/SKILL.md")
                && matches!(&entry.state, Ok(CopyState::Preserved))
        }));
        assert!(!skill.exists());
        for directory in [".agents", ".claude"] {
            assert!(user_root.0.join(directory).join("skills").is_symlink());
        }
        assert_eq!(
            fs::read_to_string(&other).unwrap(),
            "keep this independent skill"
        );
        let repeated = shared_targets(&user_root.0, &[&digest], true);
        assert!(repeated.iter().any(|entry| {
            entry.path == skill && matches!(&entry.state, Ok(CopyState::Missing))
        }));
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        fs::write(&skill, "custom shared copy").unwrap();
        let customized = shared_targets(&user_root.0, &[&digest], true);
        assert!(customized.iter().any(|entry| {
            entry.path == skill && matches!(&entry.state, Ok(CopyState::Preserved))
        }));
        assert_eq!(fs::read_to_string(skill).unwrap(), "custom shared copy");
    }
    #[test]
    fn a2a_skill_migration_rejects_paths_outside_its_config_scope() {
        let root = Temp::new();
        let outside = Temp::new();
        let target = outside.0.join("SKILL.md");
        fs::write(&target, "pristine").unwrap();
        assert!(inspect_in(&root.0, &target, KNOWN, true).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "pristine");
    }
}
