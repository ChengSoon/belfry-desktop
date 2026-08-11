use std::path::{Path, PathBuf};

use crate::resource::{canonicalize, path_to_file_uri};
use crate::terminal::AppError;

use super::contracts::ProjectWorkspace;

pub fn open_project(path: Option<&str>) -> Result<ProjectWorkspace, AppError> {
    let requested = requested_path(path)?;
    let canonical = canonicalize(&requested).map_err(|error| {
        AppError::not_found(format!(
            "project directory was not found: {} ({error})",
            requested.display()
        ))
    })?;
    if !canonical.is_dir() {
        return Err(AppError::invalid_argument(
            "project path must point to a directory",
        ));
    }
    Ok(to_workspace(&canonical))
}

fn requested_path(path: Option<&str>) -> Result<PathBuf, AppError> {
    match path.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Ok(PathBuf::from(value)),
        None => default_project_path(),
    }
}

fn default_project_path() -> Result<PathBuf, AppError> {
    let current = std::env::current_dir().map_err(|error| AppError::io(error.to_string()))?;
    if current.parent().is_some() {
        return Ok(current);
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    home.map(PathBuf::from).ok_or_else(|| {
        AppError::not_found("no default project directory is available for this user")
    })
}

fn to_workspace(path: &Path) -> ProjectWorkspace {
    let root_path = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(&root_path)
        .to_string();
    ProjectWorkspace {
        id: stable_project_id(&root_path),
        name,
        root_uri: path_to_file_uri(path),
        root_path,
    }
}

fn stable_project_id(path: &str) -> String {
    let hash = path
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!("project-{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_and_normalizes_a_project_directory() {
        let current = std::env::current_dir().unwrap();
        let workspace = open_project(current.to_str()).unwrap();
        assert_eq!(
            canonicalize(&current).unwrap().to_string_lossy(),
            workspace.root_path
        );
        assert!(workspace.root_uri.starts_with("file://"));
        assert!(workspace.id.starts_with("project-"));
    }

    #[test]
    fn rejects_a_missing_project_without_fallback() {
        let result = open_project(Some("/__belfry_missing_project__"));
        assert!(result.is_err());
    }

    #[test]
    fn project_id_is_stable_for_the_same_path() {
        assert_eq!(
            stable_project_id("/workspace/belfry"),
            stable_project_id("/workspace/belfry")
        );
    }
}
