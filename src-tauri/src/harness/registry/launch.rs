use super::{RegistryError, RegistryResult, SessionSnapshot, SystemRegistry, runnable};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug)]
pub struct WorkerLaunch {
    pub worker_id: String,
    pub executable: String,
    pub args: Vec<String>,
}

impl SystemRegistry {
    pub fn worker_launch(&self, session_id: &str) -> RegistryResult<WorkerLaunch> {
        let state = self.list()?;
        let snapshot = state
            .sessions
            .into_iter()
            .find(|item| item.session_id == session_id)
            .ok_or_else(|| RegistryError::new("SESSION_NOT_FOUND", "session not found"))?;
        validate_snapshot(&snapshot)?;
        let installed = state
            .plugins
            .iter()
            .chain(state.history.iter())
            .find(|item| {
                item.plugin_id == snapshot.plugin.plugin_id
                    && item.version == snapshot.plugin.version
                    && item.manifest_digest == snapshot.plugin.manifest_digest
            })
            .ok_or_else(|| RegistryError::new("SNAPSHOT_STALE", "session plugin is unavailable"))?;
        if !runnable(installed) {
            return Err(RegistryError::new(
                "PLUGIN_UNAVAILABLE",
                "plugin is not runnable",
            ));
        }
        if installed != &snapshot.plugin {
            return Err(RegistryError::new(
                "SNAPSHOT_STALE",
                "session plugin does not match registry",
            ));
        }
        let script = self.resolve_source(&installed.source)?;
        verify_digest(&script, &installed.manifest_digest)?;
        Ok(WorkerLaunch {
            worker_id: snapshot.worker_id,
            executable: "node".into(),
            args: vec![script.to_string_lossy().into()],
        })
    }

    fn resolve_source(&self, source: &str) -> RegistryResult<PathBuf> {
        if source == "fixture:worker.mjs" {
            return fixture_script();
        }
        let relative = source
            .strip_prefix("managed:")
            .ok_or_else(|| RegistryError::new("SOURCE_INVALID", "worker source is not managed"))?;
        let path = Path::new(relative);
        if path.as_os_str().is_empty()
            || path.is_absolute()
            || path.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(RegistryError::new(
                "SOURCE_INVALID",
                "worker source is invalid",
            ));
        }
        let root = self
            .store
            .path()
            .parent()
            .unwrap_or(Path::new(""))
            .join("installations")
            .canonicalize()
            .map_err(|_| {
                RegistryError::new("SOURCE_INVALID", "installation root is unavailable")
            })?;
        let resolved = root
            .join(path)
            .canonicalize()
            .map_err(|_| RegistryError::new("SOURCE_INVALID", "worker source is unavailable"))?;
        if !resolved.starts_with(&root) || !resolved.is_file() {
            return Err(RegistryError::new(
                "SOURCE_INVALID",
                "worker source is outside installation root",
            ));
        }
        secure_permissions(&resolved)?;
        Ok(resolved)
    }
}

fn validate_snapshot(snapshot: &SessionSnapshot) -> RegistryResult<()> {
    if snapshot.cancelled || !snapshot.resumable {
        return Err(RegistryError::new(
            "SESSION_UNAVAILABLE",
            "session cannot start",
        ));
    }
    Ok(())
}
fn verify_digest(path: &Path, expected: &str) -> RegistryResult<()> {
    let bytes = fs::read(path)
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "worker source cannot be read"))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "worker source is not UTF-8"))?;
    if crate::harness::patch::digest(&text) != expected {
        return Err(RegistryError::new(
            "DIGEST_MISMATCH",
            "worker source digest does not match",
        ));
    }
    Ok(())
}
fn fixture_script() -> RegistryResult<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/harness/worker.mjs")
        .canonicalize()
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "fixture worker is unavailable"))
}
#[cfg(unix)]
fn secure_permissions(path: &Path) -> RegistryResult<()> {
    use std::os::unix::fs::PermissionsExt;
    if fs::metadata(path)
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "worker metadata unavailable"))?
        .permissions()
        .mode()
        & 0o022
        != 0
    {
        Err(RegistryError::new(
            "SOURCE_PERMISSIONS",
            "worker source permissions are unsafe",
        ))
    } else {
        Ok(())
    }
}
#[cfg(not(unix))]
fn secure_permissions(_path: &Path) -> RegistryResult<()> {
    Ok(())
}
