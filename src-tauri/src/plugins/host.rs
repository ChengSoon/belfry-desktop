use super::{
    files::{self, Snapshot},
    manifest::{HARNESS_REMOVED, PluginManifest, uses_removed_harness},
    owner::PluginOwner,
    package,
    store::{PluginEntry, PluginRegistry, PluginStore, next_revision},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(super) const PREVIEW_TTL: Duration = Duration::from_secs(300);
const MAX_PREVIEWS: usize = 8;
pub(super) struct Pending {
    pub(super) snapshot: Snapshot,
    pub(super) development: bool,
    pub(super) created: Instant,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub preview_id: String,
    pub manifest: PluginManifest,
    pub source_path: PathBuf,
    pub development: bool,
    pub digest: String,
    pub file_count: usize,
    pub total_bytes: usize,
}
pub struct PluginHost {
    pub base: PathBuf,
    pub(super) previews: HashMap<String, Pending>,
}
impl PluginHost {
    pub fn new(base: PathBuf) -> Self {
        Self {
            base,
            previews: HashMap::new(),
        }
    }
    pub fn inspect(&mut self, path: &Path, development: bool) -> Result<Preview, String> {
        self.previews
            .retain(|_, pending| pending.created.elapsed() < PREVIEW_TTL);
        if self.previews.len() >= MAX_PREVIEWS {
            return Err("安装预览过多，请取消已有预览".into());
        }
        let snapshot = package::read_source(path, development)?;
        let preview_id = ulid::Ulid::generate().to_string();
        let preview = Preview {
            preview_id: preview_id.clone(),
            manifest: snapshot.manifest.clone(),
            source_path: snapshot.root.clone(),
            development,
            digest: files::digest(&snapshot),
            file_count: snapshot.files.len(),
            total_bytes: snapshot.files.values().map(Vec::len).sum(),
        };
        self.previews.insert(
            preview_id,
            Pending {
                snapshot,
                development,
                created: Instant::now(),
            },
        );
        Ok(preview)
    }
    pub fn cancel(&mut self, preview_id: &str) {
        self.previews.remove(preview_id);
    }
    pub(super) fn owner(&self) -> Result<PluginOwner, String> {
        fs::create_dir_all(&self.base).map_err(|e| e.to_string())?;
        for path in [&self.base, &self.base.join("installed")] {
            if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
                return Err("插件存储目录不能为符号链接".into());
            }
        }
        PluginOwner::acquire(&self.base.join("owner.lock"))
    }
    pub(super) fn store(&self) -> PluginStore {
        PluginStore::new(self.base.join("registry-v1.json"))
    }
    pub fn list(&self) -> Result<PluginRegistry, String> {
        let _owner = self.owner()?;
        let mut registry = self.store().load()?;
        let mut changed = false;
        for entry in &mut registry.plugins {
            if uses_removed_harness(&entry.manifest) {
                changed |= quarantine_removed(entry);
                continue;
            }
            if !entry.enabled {
                continue;
            }
            match self.snapshot_entry(entry) {
                Ok(snapshot) if snapshot.manifest == entry.manifest => {
                    entry.active_contributions = snapshot.manifest.contributes
                }
                Ok(_) => {
                    disable_entry(entry, "目录 manifest 已变化，请重载并核对权限".into());
                    changed = true;
                }
                Err(error) => {
                    disable_entry(entry, error);
                    changed = true;
                }
            }
        }
        if changed {
            self.commit(&mut registry)?;
        }
        Ok(registry)
    }
    pub fn mutate(&self, id: &str, action: &str, revision: &str) -> Result<PluginRegistry, String> {
        let _owner = self.owner()?;
        let mut registry = self.store().load()?;
        check_revision(&registry, revision)?;
        let index = registry
            .plugins
            .iter()
            .position(|p| p.manifest.id == id)
            .ok_or("插件不存在")?;
        if action == "uninstall" {
            return self.uninstall(registry, index);
        }
        let entry = &mut registry.plugins[index];
        match action {
            "disable" => {
                entry.enabled = false;
                entry.error = uses_removed_harness(&entry.manifest).then(|| HARNESS_REMOVED.into());
                entry.active_contributions = Default::default();
            }
            "enable" | "reload" => self.activate(entry, action),
            _ => return Err("未知插件操作".into()),
        }
        entry.updated_at = now();
        self.commit(&mut registry)?;
        Ok(registry)
    }
    fn activate(&self, entry: &mut PluginEntry, action: &str) {
        if uses_removed_harness(&entry.manifest) {
            disable_entry(entry, HARNESS_REMOVED.into());
            return;
        }
        match self.snapshot_entry(entry) {
            Ok(snapshot) => {
                if changed_authority(&entry.manifest, &snapshot.manifest) {
                    disable_entry(entry, "插件身份或权限已变化，请卸载后重新预览安装".into());
                    return;
                }
                if action == "enable" && snapshot.manifest != entry.manifest {
                    disable_entry(entry, "manifest 已变化，请先重载查看贡献".into());
                    return;
                }
                let enabled = action == "enable" || entry.enabled;
                entry.manifest = snapshot.manifest;
                entry.enabled = enabled;
                entry.error = None;
                entry.active_contributions = if enabled {
                    entry.manifest.contributes.clone()
                } else {
                    Default::default()
                };
            }
            Err(error) => disable_entry(entry, error),
        }
    }
    fn uninstall(
        &self,
        mut registry: PluginRegistry,
        index: usize,
    ) -> Result<PluginRegistry, String> {
        let entry = registry.plugins.remove(index);
        let managed = entry.source == "installed";
        if managed {
            self.managed_path(&entry.source_path)?;
        }
        // 先提交撤销；提交失败时目录完整保留。崩溃遗留目录不会被自动加载。
        self.commit(&mut registry)?;
        if managed && entry.source_path.exists() {
            fs::remove_dir_all(&entry.source_path)
                .map_err(|e| format!("插件已卸载，但目录清理失败：{e}；请重新读取列表"))?;
        }
        Ok(registry)
    }
    pub(super) fn managed_path(&self, path: &Path) -> Result<(), String> {
        let parent = self
            .base
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join("installed");
        if let Ok(meta) = fs::symlink_metadata(&parent) {
            if meta.file_type().is_symlink() {
                return Err("受管父目录不能为符号链接".into());
            }
        }
        if path.parent() != Some(parent.as_path()) {
            return Err("受管插件路径无效".into());
        }
        match fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("受管目录不能为符号链接".into());
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(error.to_string());
            }
            _ => {}
        }
        Ok(())
    }
    pub fn snapshot_entry(&self, entry: &PluginEntry) -> Result<Snapshot, String> {
        if entry.source == "installed" {
            self.managed_path(&entry.source_path)?;
        }
        files::read_snapshot(&entry.source_path)
    }
    pub(super) fn commit(&self, registry: &mut PluginRegistry) -> Result<(), String> {
        registry.revision = next_revision(&registry.revision)?;
        self.store().save(registry)
    }
}
fn quarantine_removed(entry: &mut PluginEntry) -> bool {
    let changed = entry.enabled || entry.error.as_deref() != Some(HARNESS_REMOVED);
    if changed {
        disable_entry(entry, HARNESS_REMOVED.into());
    }
    changed
}
fn changed_authority(
    current: &super::manifest::PluginManifest,
    next: &super::manifest::PluginManifest,
) -> bool {
    current.id != next.id
        || current.permissions != next.permissions
        || !super::pi_manifest::same_authority(current, next)
}
fn disable_entry(entry: &mut PluginEntry, error: String) {
    entry.enabled = false;
    entry.error = Some(error);
    entry.active_contributions = Default::default();
    entry.updated_at = now();
}
pub(super) fn check_revision(registry: &PluginRegistry, expected: &str) -> Result<(), String> {
    if registry.revision != expected {
        Err("插件列表已变化，请刷新后重试".into())
    } else {
        Ok(())
    }
}
pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}
