use super::{PluginDefinition, RegistryError, RegistryResult, SystemRegistry, runnable};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MANIFEST_LIMIT: u64 = 64 * 1024;
const WORKER_LIMIT: u64 = 1024 * 1024;
const JOURNAL_SCHEMA: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallJournal {
    schema_version: u32,
    operation: String,
    plugin_id: String,
    version: String,
    temp_name: String,
    final_name: String,
    phase: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalManifest {
    plugin_id: String,
    version: String,
    harness_api: u32,
    min_app_version: String,
    tools: Vec<String>,
    capabilities: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPreview {
    pub preview_id: String,
    pub expected_revision: String,
    pub plugin_id: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub worker_digest: String,
    pub trust: &'static str,
    pub signed: bool,
}
pub(super) struct PendingInstall {
    manifest_path: PathBuf,
    worker_path: PathBuf,
    manifest: LocalManifest,
    worker_digest: String,
    manifest_digest: String,
    expected_revision: String,
}

impl SystemRegistry {
    pub fn preview_install(
        &self,
        manifest_path: String,
        worker_path: String,
    ) -> RegistryResult<InstallPreview> {
        self.cleanup_install_temps();
        let manifest_file = safe_input(Path::new(&manifest_path), MANIFEST_LIMIT)?;
        let worker_file = safe_input(Path::new(&worker_path), WORKER_LIMIT)?;
        let manifest_text = read_utf8(&manifest_file, MANIFEST_LIMIT)?;
        let manifest: LocalManifest = serde_json::from_str(&manifest_text)
            .map_err(|_| RegistryError::new("MANIFEST_INVALID", "manifest is invalid"))?;
        validate_manifest(&manifest)?;
        let worker = read_utf8(&worker_file, WORKER_LIMIT)?;
        let state = self.list()?;
        validate_version_change(&state.plugins, &manifest)?;
        let id = ulid::Ulid::generate().to_string().to_lowercase();
        let digest = crate::harness::patch::digest(&worker);
        let manifest_digest = crate::harness::patch::digest(&manifest_text);
        let plugin_id = manifest.plugin_id.clone();
        let version = manifest.version.clone();
        let capabilities = manifest.capabilities.clone();
        self.imports.lock().unwrap().insert(
            id.clone(),
            PendingInstall {
                manifest_path: manifest_file,
                worker_path: worker_file,
                manifest: LocalManifest {
                    capabilities: manifest.capabilities.clone(),
                    tools: manifest.tools.clone(),
                    ..manifest
                },
                worker_digest: digest.clone(),
                manifest_digest,
                expected_revision: state.revision.clone(),
            },
        );
        Ok(InstallPreview {
            preview_id: id,
            expected_revision: state.revision,
            plugin_id,
            version,
            capabilities,
            worker_digest: digest,
            trust: "local-user-approved/integrity-checked",
            signed: false,
        })
    }

    pub fn commit_install(&self, preview_id: &str) -> RegistryResult<super::RegistryState> {
        let pending = self
            .imports
            .lock()
            .unwrap()
            .remove(preview_id)
            .ok_or_else(|| {
                RegistryError::new("PREVIEW_EXPIRED", "install preview is unavailable")
            })?;
        let worker = read_utf8(
            &safe_input(&pending.worker_path, WORKER_LIMIT)?,
            WORKER_LIMIT,
        )?;
        if crate::harness::patch::digest(&worker) != pending.worker_digest {
            return Err(RegistryError::new(
                "DIGEST_MISMATCH",
                "selected worker changed",
            ));
        }
        let manifest_now = read_utf8(
            &safe_input(&pending.manifest_path, MANIFEST_LIMIT)?,
            MANIFEST_LIMIT,
        )?;
        if crate::harness::patch::digest(&manifest_now) != pending.manifest_digest {
            return Err(RegistryError::new(
                "DIGEST_MISMATCH",
                "selected manifest changed",
            ));
        }
        self.install_artifact(pending, worker)
    }

    pub fn cancel_install(&self, preview_id: &str) -> RegistryResult<()> {
        self.imports
            .lock()
            .unwrap()
            .remove(preview_id)
            .ok_or_else(|| {
                RegistryError::new("PREVIEW_EXPIRED", "install preview is unavailable")
            })?;
        Ok(())
    }

    fn install_artifact(
        &self,
        pending: PendingInstall,
        worker: String,
    ) -> RegistryResult<super::RegistryState> {
        let root = self.install_root();
        fs::create_dir_all(&root).map_err(io_error)?;
        let temp = root.join(format!(".tmp-{}", ulid::Ulid::generate()));
        fs::create_dir(&temp).map_err(io_error)?;
        let worker_file = temp.join("worker.mjs");
        let result = write_synced(&worker_file, worker.as_bytes());
        if let Err(error) = result {
            let _ = fs::remove_dir_all(&temp);
            return Err(error);
        }
        let final_dir = root
            .join(&pending.manifest.plugin_id)
            .join(&pending.manifest.version);
        if final_dir.exists() {
            let _ = fs::remove_dir_all(&temp);
            return Err(RegistryError::new(
                "VERSION_EXISTS",
                "plugin version already exists",
            ));
        }
        fs::create_dir_all(final_dir.parent().unwrap()).map_err(io_error)?;
        sync_directory(&temp)?;
        let journal = InstallJournal {
            schema_version: JOURNAL_SCHEMA,
            operation: "install".into(),
            plugin_id: pending.manifest.plugin_id.clone(),
            version: pending.manifest.version.clone(),
            temp_name: temp
                .strip_prefix(&root)
                .map_err(|_| io_error(std::io::Error::other("journal path")))?
                .to_string_lossy()
                .into_owned(),
            final_name: final_dir
                .strip_prefix(&root)
                .map_err(|_| io_error(std::io::Error::other("journal path")))?
                .to_string_lossy()
                .into_owned(),
            phase: "before-rename".into(),
        };
        let journal_path = journal_path(&root, &journal)?;
        write_journal(&journal_path, &journal)?;
        fs::rename(&temp, &final_dir).map_err(io_error)?;
        sync_directory(final_dir.parent().unwrap())?;
        write_journal(
            &journal_path,
            &InstallJournal {
                phase: "after-rename".into(),
                ..journal.clone()
            },
        )?;
        let plugin = PluginDefinition {
            plugin_id: pending.manifest.plugin_id,
            version: pending.manifest.version,
            manifest_digest: pending.worker_digest,
            harness_api: pending.manifest.harness_api,
            min_app_version: pending.manifest.min_app_version,
            trusted: true,
            enabled: true,
            source: format!(
                "managed:{}/{}/worker.mjs",
                final_dir
                    .parent()
                    .unwrap()
                    .file_name()
                    .unwrap()
                    .to_string_lossy(),
                final_dir.file_name().unwrap().to_string_lossy()
            ),
            tools: pending.manifest.tools,
            capabilities: pending.manifest.capabilities,
        };
        let state = if self
            .list()?
            .plugins
            .iter()
            .any(|p| p.plugin_id == plugin.plugin_id)
        {
            self.update(&pending.expected_revision, plugin)
        } else {
            self.install(&pending.expected_revision, plugin)
        };
        if let Err(error) = &state {
            if matches!(error.code, "REVISION_CONFLICT" | "VERSION_EXISTS") {
                let _ = fs::remove_dir_all(&final_dir);
                let _ = fs::remove_file(&journal_path);
            }
            // 其它错误保留 journal/final artifact 供下一次启动的 reconciliation 处理。
            return Err(error.clone());
        }
        let _ = fs::remove_file(&journal_path);
        state
    }
    fn install_root(&self) -> PathBuf {
        self.store
            .path()
            .parent()
            .unwrap_or(Path::new(""))
            .join("installations")
    }
    fn cleanup_install_temps(&self) {
        let root = self.install_root();
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with(".tmp-") {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }

    /// 在 SystemRegistry 创建时调用；只删除确定未被 registry 引用的事务产物。
    pub(super) fn recover_install_state(
        store_path: &Path,
        state: &super::RegistryState,
    ) -> RegistryResult<()> {
        let root = store_path
            .parent()
            .ok_or_else(|| {
                RegistryError::new("RECOVERY_PATH_INVALID", "installation root is unavailable")
            })?
            .join("installations");
        match fs::symlink_metadata(&root) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(RegistryError::new(
                    "RECOVERY_PATH_INVALID",
                    "installation root is a symlink",
                ));
            }
            Ok(meta) if !meta.is_dir() => {
                return Err(RegistryError::new(
                    "RECOVERY_PATH_INVALID",
                    "installation root is not a directory",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => {
                return Err(RegistryError::new(
                    "RECOVERY_READ_FAILED",
                    "installation recovery failed",
                ));
            }
            Ok(_) => {}
        }
        let referenced = referenced_artifacts(state);
        let entries = fs::read_dir(&root).map_err(|_| {
            RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed")
        })?;
        for entry in entries {
            let entry = entry.map_err(|_| {
                RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed")
            })?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    return Err(RegistryError::new(
                        "RECOVERY_READ_FAILED",
                        "installation recovery failed",
                    ));
                }
            };
            if meta.file_type().is_symlink() {
                return Err(RegistryError::new(
                    "RECOVERY_PATH_INVALID",
                    "installation symlink is unsafe",
                ));
            }
            if name.starts_with(".tmp-") {
                fs::remove_dir_all(path).map_err(|_| {
                    RegistryError::new(
                        "RECOVERY_CLEANUP_FAILED",
                        "stale install temp cleanup failed",
                    )
                })?;
                continue;
            }
            if name.starts_with(".journal-") {
                let journal = read_journal(&path)?;
                if journal.schema_version != JOURNAL_SCHEMA
                    || journal.operation != "install"
                    || !safe_component(&journal.plugin_id)
                    || !safe_component(&journal.version)
                    || !safe_relative(&journal.temp_name)
                    || !safe_relative(&journal.final_name)
                    || !["before-rename", "after-rename"].contains(&journal.phase.as_str())
                {
                    return Err(RegistryError::new(
                        "RECOVERY_JOURNAL_INVALID",
                        "install recovery journal is invalid",
                    ));
                }
                let final_rel = format!("{}/{}", journal.plugin_id, journal.version);
                if !referenced.contains(&final_rel) {
                    remove_if_safe(&root.join(&journal.final_name))?;
                }
                remove_if_safe(&root.join(&journal.temp_name))?;
                fs::remove_file(path).map_err(|_| {
                    RegistryError::new("RECOVERY_CLEANUP_FAILED", "install journal cleanup failed")
                })?;
                continue;
            }
        }
        for entry in fs::read_dir(&root).map_err(|_| {
            RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed")
        })? {
            let entry = entry.map_err(|_| {
                RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed")
            })?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            reconcile_orphan(&root, &entry.path(), &name, &referenced)?;
        }
        Ok(())
    }
}

fn journal_path(root: &Path, journal: &InstallJournal) -> RegistryResult<PathBuf> {
    if !safe_component(&journal.plugin_id) || !safe_component(&journal.version) {
        return Err(RegistryError::new(
            "RECOVERY_JOURNAL_INVALID",
            "install journal identity is invalid",
        ));
    }
    Ok(root.join(format!(
        ".journal-{}-{}.json",
        journal.plugin_id, journal.version
    )))
}
fn write_journal(path: &Path, journal: &InstallJournal) -> RegistryResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| RegistryError::new("RECOVERY_JOURNAL_INVALID", "journal path is invalid"))?;
    let temp = parent.join(format!(".journal-write-{}.tmp", ulid::Ulid::generate()));
    let bytes = serde_json::to_vec(journal).map_err(|_| {
        RegistryError::new("RECOVERY_JOURNAL_INVALID", "journal serialization failed")
    })?;
    write_synced(&temp, &bytes)?;
    let result = fs::rename(&temp, path)
        .map_err(|_| RegistryError::new("RECOVERY_JOURNAL_WRITE_FAILED", "journal commit failed"));
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
fn read_journal(path: &Path) -> RegistryResult<InstallJournal> {
    let text = fs::read_to_string(path).map_err(|_| {
        RegistryError::new(
            "RECOVERY_JOURNAL_INVALID",
            "install recovery journal is unreadable",
        )
    })?;
    serde_json::from_str(&text).map_err(|_| {
        RegistryError::new(
            "RECOVERY_JOURNAL_INVALID",
            "install recovery journal is invalid",
        )
    })
}
fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && !value.contains("..")
}
fn safe_relative(value: &str) -> bool {
    let p = Path::new(value);
    p.is_relative()
        && p.components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}
fn referenced_artifacts(state: &super::RegistryState) -> std::collections::HashSet<String> {
    state
        .plugins
        .iter()
        .chain(state.history.iter())
        .filter_map(|p| {
            p.source
                .strip_prefix("managed:")
                .and_then(|v| v.strip_suffix("/worker.mjs"))
                .map(str::to_owned)
        })
        .collect()
}
fn remove_if_safe(path: &Path) -> RegistryResult<()> {
    if !path.exists() {
        return Ok(());
    }
    let meta = fs::symlink_metadata(path)
        .map_err(|_| RegistryError::new("RECOVERY_READ_FAILED", "recovery artifact unavailable"))?;
    if meta.file_type().is_symlink() {
        return Err(RegistryError::new(
            "RECOVERY_PATH_INVALID",
            "recovery artifact is a symlink",
        ));
    }
    if meta.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|_| {
        RegistryError::new(
            "RECOVERY_CLEANUP_FAILED",
            "recovery artifact cleanup failed",
        )
    })
}
fn reconcile_orphan(
    _root: &Path,
    path: &Path,
    plugin_id: &str,
    referenced: &std::collections::HashSet<String>,
) -> RegistryResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed"))?;
    if metadata.file_type().is_symlink() {
        return Err(RegistryError::new(
            "RECOVERY_PATH_INVALID",
            "installation symlink is unsafe",
        ));
    }
    if !safe_component(plugin_id) || !metadata.is_dir() {
        return Ok(());
    }
    for version in fs::read_dir(path)
        .map_err(|_| RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed"))?
    {
        let version = version.map_err(|_| {
            RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed")
        })?;
        let name = version.file_name().to_string_lossy().into_owned();
        if !safe_component(&name) {
            return Err(RegistryError::new(
                "RECOVERY_PATH_INVALID",
                "installation path is unsafe",
            ));
        }
        let rel = format!("{plugin_id}/{name}");
        let child = version.path();
        let meta = fs::symlink_metadata(&child).map_err(|_| {
            RegistryError::new("RECOVERY_READ_FAILED", "installation recovery failed")
        })?;
        if meta.file_type().is_symlink() {
            return Err(RegistryError::new(
                "RECOVERY_PATH_INVALID",
                "installation symlink is unsafe",
            ));
        }
        if !referenced.contains(&rel) {
            remove_if_safe(&child)?;
        }
    }
    Ok(())
}

fn safe_input(path: &Path, limit: u64) -> RegistryResult<PathBuf> {
    let meta = fs::symlink_metadata(path)
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "selected file unavailable"))?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > limit {
        return Err(RegistryError::new(
            "SOURCE_INVALID",
            "selected file is invalid",
        ));
    }
    path.canonicalize()
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "selected file unavailable"))
}
fn read_utf8(path: &Path, limit: u64) -> RegistryResult<String> {
    let mut bytes = Vec::new();
    open_no_follow(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(RegistryError::new(
            "TOO_LARGE",
            "selected file exceeds limit",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| RegistryError::new("INVALID_UTF8", "selected file is not UTF-8"))
}
#[cfg(unix)]
fn open_no_follow(path: &Path) -> RegistryResult<File> {
    use std::os::unix::fs::OpenOptionsExt;
    #[cfg(target_os = "linux")]
    const NO_FOLLOW: i32 = 0x20000;
    #[cfg(not(target_os = "linux"))]
    const NO_FOLLOW: i32 = 0x100;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(NO_FOLLOW)
        .open(path)
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "selected file is invalid"))
}
#[cfg(windows)]
fn open_no_follow(path: &Path) -> RegistryResult<File> {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(0x0020_0000)
        .open(path)
        .map_err(|_| RegistryError::new("SOURCE_INVALID", "selected file is invalid"))
}
#[cfg(not(any(unix, windows)))]
fn open_no_follow(path: &Path) -> RegistryResult<File> {
    File::open(path).map_err(io_error)
}
fn validate_manifest(m: &LocalManifest) -> RegistryResult<()> {
    const TOOLS: &[&str] = &[
        "project.list",
        "project.read",
        "project.patch.propose",
        "project.patch.apply",
        "command.exec",
    ];
    const CAPABILITIES: &[&str] = &["project.read", "project.write", "command.exec"];
    if m.plugin_id.is_empty()
        || !m.plugin_id.contains('.')
        || !m
            .plugin_id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-')
        || super::semver(&m.version).is_none()
        || m.harness_api != 1
        || m.tools.is_empty()
        || m.tools.len() > 64
        || m.capabilities.len() > 32
        || m.tools.iter().any(|value| !TOOLS.contains(&value.as_str()))
        || m.capabilities
            .iter()
            .any(|value| !CAPABILITIES.contains(&value.as_str()))
        || has_duplicates(&m.tools)
        || has_duplicates(&m.capabilities)
        || m.tools
            .iter()
            .chain(m.capabilities.iter())
            .any(|v| v.len() > 80)
    {
        return Err(RegistryError::new(
            "MANIFEST_INVALID",
            "manifest fields are invalid",
        ));
    }
    let probe = PluginDefinition {
        plugin_id: m.plugin_id.clone(),
        version: m.version.clone(),
        manifest_digest: String::new(),
        harness_api: m.harness_api,
        min_app_version: m.min_app_version.clone(),
        trusted: true,
        enabled: true,
        source: String::new(),
        tools: vec![],
        capabilities: vec![],
    };
    if !runnable(&probe) {
        return Err(RegistryError::new(
            "MANIFEST_INCOMPATIBLE",
            "manifest is incompatible",
        ));
    }
    Ok(())
}
fn has_duplicates(values: &[String]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(index, value)| values[..index].contains(value))
}
fn validate_version_change(existing: &[PluginDefinition], m: &LocalManifest) -> RegistryResult<()> {
    let incoming = super::semver(&m.version)
        .ok_or_else(|| RegistryError::new("MANIFEST_INVALID", "version is invalid"))?;
    if let Some(current) = existing.iter().find(|p| p.plugin_id == m.plugin_id) {
        if current.version == m.version {
            return Err(RegistryError::new(
                "VERSION_EXISTS",
                "plugin version already exists",
            ));
        }
        if super::semver(&current.version)
            .map(|version| version > incoming)
            .unwrap_or(true)
        {
            return Err(RegistryError::new(
                "DOWNGRADE_DENIED",
                "plugin downgrade is denied",
            ));
        }
    }
    Ok(())
}
#[cfg(unix)]
fn sync_directory(path: &Path) -> RegistryResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(io_error)
}
#[cfg(not(unix))]
fn sync_directory(_: &Path) -> RegistryResult<()> {
    Ok(())
}
fn write_synced(path: &Path, bytes: &[u8]) -> RegistryResult<()> {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(io_error)?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(io_error)
}
fn io_error(_: std::io::Error) -> RegistryError {
    RegistryError::new("INSTALL_IO_ERROR", "managed install failed")
}
