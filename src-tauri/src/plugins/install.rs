use super::{
    files::{self, Snapshot},
    host::{PREVIEW_TTL, PluginHost, check_revision, now},
    package,
    store::{PluginEntry, PluginRegistry},
};
use std::{fs, path::PathBuf};
#[derive(Default)]
pub(super) struct InstallOptions {
    pub replace: bool,
    pub enabled: bool,
}
impl PluginHost {
    pub fn install(&mut self, preview_id: &str, revision: &str) -> Result<PluginRegistry, String> {
        self.install_with_options((preview_id, revision), InstallOptions::default())
    }
    pub(super) fn install_with_options(
        &mut self,
        review: (&str, &str),
        options: InstallOptions,
    ) -> Result<PluginRegistry, String> {
        let (preview_id, revision) = review;
        let _owner = self.owner()?;
        let mut registry = self.store().load()?;
        check_revision(&registry, revision)?;
        let (snapshot, development) =
            self.confirm_preview((preview_id, &registry), options.replace)?;
        let previous = registry
            .plugins
            .iter()
            .find(|entry| entry.manifest.id == snapshot.manifest.id)
            .cloned();
        if let Some(entry) = previous
            .as_ref()
            .filter(|entry| entry.source == "installed")
        {
            self.managed_path(&entry.source_path)?;
        }
        let destination = self.install_destination(&snapshot, development)?;
        let mut entry = enabled_entry(
            new_entry(snapshot, development, destination.clone()),
            options.enabled,
        );
        if let Some(old) = &previous {
            entry.installed_at = old.installed_at;
        }
        registry
            .plugins
            .retain(|old| old.manifest.id != entry.manifest.id);
        registry.plugins.push(entry);
        if let Err(error) = self.commit(&mut registry) {
            if !development {
                let _ = fs::remove_dir_all(&destination);
            }
            return Err(error);
        }
        self.previews.remove(preview_id);
        if let Some(old) =
            previous.filter(|old| old.source == "installed" && old.source_path != destination)
        {
            let _ = fs::remove_dir_all(old.source_path);
        }
        Ok(registry)
    }
    fn install_destination(
        &self,
        snapshot: &Snapshot,
        development: bool,
    ) -> Result<PathBuf, String> {
        if development {
            Ok(snapshot.root.clone())
        } else {
            self.copy_managed(snapshot)
        }
    }
    fn copy_managed(&self, snapshot: &Snapshot) -> Result<PathBuf, String> {
        let installed = self.base.join("installed");
        fs::create_dir_all(&installed).map_err(|e| e.to_string())?;
        let destination = installed
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(format!(
                "{}-{}",
                snapshot.manifest.id,
                ulid::Ulid::generate()
            ));
        if let Err(error) = files::copy_snapshot(snapshot, &destination) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        Ok(destination)
    }
    fn confirm_preview(
        &self,
        review: (&str, &PluginRegistry),
        replace: bool,
    ) -> Result<(Snapshot, bool), String> {
        let (id, registry) = review;
        let pending = self.previews.get(id).ok_or("预览不存在，请重新预览")?;
        if pending.created.elapsed() >= PREVIEW_TTL {
            return Err("预览已过期，请重新预览".into());
        }
        let snapshot = package::read_source(&pending.snapshot.root, pending.development)?;
        if snapshot != pending.snapshot {
            return Err("插件内容已变化，请重新预览并确认".into());
        }
        let existing = registry
            .plugins
            .iter()
            .any(|p| p.manifest.id == snapshot.manifest.id);
        if existing && !replace {
            return Err("同 ID 插件已安装，请先卸载".into());
        }
        if !existing && registry.plugins.len() >= 50 {
            return Err("插件数量超额".into());
        }
        Ok((snapshot, pending.development))
    }
}
fn enabled_entry(mut entry: PluginEntry, enabled: bool) -> PluginEntry {
    entry.enabled = enabled;
    if enabled {
        entry.active_contributions = entry.manifest.contributes.clone();
    }
    entry
}
fn new_entry(snapshot: Snapshot, development: bool, destination: PathBuf) -> PluginEntry {
    PluginEntry {
        manifest: snapshot.manifest,
        enabled: false,
        source: if development {
            "development"
        } else {
            "installed"
        }
        .into(),
        source_path: destination,
        installed_at: now(),
        updated_at: now(),
        error: None,
        active_contributions: Default::default(),
    }
}
