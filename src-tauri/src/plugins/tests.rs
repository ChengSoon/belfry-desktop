use super::*;
use std::{fs, path::PathBuf};
pub(super) struct Fixture {
    root: PathBuf,
    pub(super) source: PathBuf,
    pub(super) host: host::PluginHost,
}
impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("plugin-p0-{}", ulid::Ulid::generate()));
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("manifest.json"), manifest_text()).unwrap();
        fs::write(source.join("SKILL.md"), "Review the diff.").unwrap();
        let host = host::PluginHost::new(root.join("host"));
        Self { root, source, host }
    }
    pub(super) fn install(&mut self, dev: bool) -> store::PluginRegistry {
        let preview = self.host.inspect(&self.source, dev).unwrap();
        self.host.install(&preview.preview_id, "0").unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
pub(super) fn manifest_text() -> String {
    serde_json::json!({"schemaVersion":1,"id":"example.review","name":"Review","version":"1.0.0","author":"Belfry","compatibility":{"pluginApi":1,"minAppVersion":"0.19.0"},"permissions":["commands","skills","settings"],"activationEvents":["onEnable"],"contributes":{"commands":[{"id":"review","title":"Review","text":"Review this change."}],"skills":[{"id":"skill","title":"Review guide","path":"SKILL.md"}],"settings":[{"id":"style","title":"Style","description":"Review style","default":"concise"}]}}).to_string()
}
#[test]
fn full_managed_lifecycle_and_restart() {
    let mut f = Fixture::new();
    let installed = f.install(false);
    assert!(!installed.plugins[0].enabled);
    assert_ne!(f.source, installed.plugins[0].source_path);
    let enabled = f.host.mutate("example.review", "enable", "1").unwrap();
    assert!(enabled.plugins[0].enabled);
    let restarted = host::PluginHost::new(f.host.base.clone()).list().unwrap();
    assert_eq!(1, restarted.plugins[0].active_contributions.commands.len());
    let reloaded = f.host.mutate("example.review", "reload", "2").unwrap();
    assert!(reloaded.plugins[0].enabled);
    let disabled = f.host.mutate("example.review", "disable", "3").unwrap();
    assert!(!disabled.plugins[0].enabled);
    assert!(disabled.plugins[0].active_contributions.commands.is_empty());
    assert!(
        f.host
            .mutate("example.review", "uninstall", "4")
            .unwrap()
            .plugins
            .is_empty()
    );
    assert!(f.source.exists());
    assert!(!installed.plugins[0].source_path.exists());
}
#[test]
fn preview_is_readonly_and_commit_rechecks_all_bytes() {
    let mut f = Fixture::new();
    let preview = f.host.inspect(&f.source, false).unwrap();
    assert!(!f.host.base.exists());
    fs::write(f.source.join("SKILL.md"), "changed").unwrap();
    assert!(
        f.host
            .install(&preview.preview_id, "0")
            .unwrap_err()
            .contains("已变化")
    );
    assert!(f.host.list().unwrap().plugins.is_empty());
    assert!(!f.host.base.join("installed").exists());
}
#[test]
fn failed_reload_disables_and_preserves_diagnostic_across_restart() {
    let mut f = Fixture::new();
    f.install(true);
    f.host.mutate("example.review", "enable", "1").unwrap();
    fs::write(f.source.join("manifest.json"), "bad").unwrap();
    let state = f.host.mutate("example.review", "reload", "2").unwrap();
    assert!(!state.plugins[0].enabled);
    assert!(state.plugins[0].error.is_some());
    assert!(state.plugins[0].active_contributions.skills.is_empty());
    assert!(f.host.list().unwrap().plugins[0].error.is_some());
    f.host.mutate("example.review", "uninstall", "3").unwrap();
    assert!(f.source.exists());
}
#[test]
fn restart_revalidates_enabled_plugins() {
    let mut f = Fixture::new();
    f.install(true);
    f.host.mutate("example.review", "enable", "1").unwrap();
    fs::remove_file(f.source.join("SKILL.md")).unwrap();
    let state = host::PluginHost::new(f.host.base.clone()).list().unwrap();
    assert!(!state.plugins[0].enabled);
    assert_eq!("3", state.revision);
}
#[test]
fn rejects_stale_revision_and_owner_contention() {
    let mut f = Fixture::new();
    f.install(false);
    assert!(f.host.mutate("example.review", "enable", "0").is_err());
    let _lock = owner::PluginOwner::acquire(&f.host.base.join("owner.lock")).unwrap();
    assert!(f.host.mutate("example.review", "enable", "1").is_err());
}
#[test]
fn rejects_legacy_registry_without_overwriting() {
    let f = Fixture::new();
    fs::create_dir_all(&f.host.base).unwrap();
    let path = f.host.base.join("registry-v1.json");
    let old = r#"{"storeSchemaVersion":1,"revision":"0","plugins":[]}"#;
    fs::write(&path, old).unwrap();
    assert!(f.host.list().is_err());
    assert_eq!(old, fs::read_to_string(path).unwrap());
}
#[test]
fn duplicate_json_keys_including_escapes_are_rejected() {
    assert!(strict_json::parse::<serde_json::Value>(br#"{"a":1,"\u0061":2}"#).is_err());
    assert!(strict_json::parse::<serde_json::Value>(br#"{} {}"#).is_err());
    assert!(strict_json::parse::<serde_json::Value>(&[0xff]).is_err());
}
#[test]
fn invalid_manifest_variants_are_rejected_without_installation() {
    for (field, value) in [
        ("schemaVersion", serde_json::json!(2)),
        ("permissions", serde_json::json!(["network"])),
        ("version", serde_json::json!("01.0.0")),
        ("id", serde_json::json!("../escape")),
        ("activationEvents", serde_json::json!(["onStartup"])),
    ] {
        let mut f = Fixture::new();
        let mut manifest: serde_json::Value = serde_json::from_str(&manifest_text()).unwrap();
        manifest[field] = value;
        fs::write(f.source.join("manifest.json"), manifest.to_string()).unwrap();
        assert!(f.host.inspect(&f.source, false).is_err());
        assert!(!f.host.base.exists());
    }
}
#[test]
fn incompatible_and_escaping_skill_paths_are_rejected() {
    let mut f = Fixture::new();
    let mut manifest: serde_json::Value = serde_json::from_str(&manifest_text()).unwrap();
    manifest["compatibility"]["minAppVersion"] = "99.0.0".into();
    fs::write(f.source.join("manifest.json"), manifest.to_string()).unwrap();
    assert!(f.host.inspect(&f.source, false).is_err());
    for path in [
        "../outside",
        "/tmp/secret",
        "C:\\secret",
        "a/../b",
        "a//b",
        "./SKILL.md",
    ] {
        assert!(files::relative_path(path).is_err());
    }
}
#[test]
fn oversized_and_excess_files_are_rejected() {
    let mut f = Fixture::new();
    fs::write(
        f.source.join("large"),
        vec![0; files::MAX_FILE_BYTES as usize + 1],
    )
    .unwrap();
    assert!(f.host.inspect(&f.source, false).is_err());
    fs::remove_file(f.source.join("large")).unwrap();
    for i in 0..files::MAX_FILES {
        fs::write(f.source.join(format!("file-{i}")), "").unwrap();
    }
    assert!(f.host.inspect(&f.source, false).is_err());
}
#[cfg(unix)]
#[test]
fn rejects_symlink_even_when_target_is_inside_root() {
    let mut f = Fixture::new();
    std::os::unix::fs::symlink(f.source.join("SKILL.md"), f.source.join("link")).unwrap();
    assert!(f.host.inspect(&f.source, false).is_err());
}
#[test]
fn permission_changes_on_reload_require_reinstallation() {
    let mut f = Fixture::new();
    f.install(true);
    let mut manifest: serde_json::Value = serde_json::from_str(&manifest_text()).unwrap();
    manifest["permissions"] = serde_json::json!(["settings", "skills", "commands"]);
    fs::write(f.source.join("manifest.json"), manifest.to_string()).unwrap();
    let state = f.host.mutate("example.review", "reload", "1").unwrap();
    assert!(!state.plugins[0].enabled);
    assert!(state.plugins[0].error.as_ref().unwrap().contains("权限"));
}
#[test]
fn install_commit_failure_rolls_back_owned_directory() {
    let mut f = Fixture::new();
    let preview = f.host.inspect(&f.source, false).unwrap();
    fs::create_dir_all(&f.host.base).unwrap();
    let state = store::PluginRegistry {
        revision: u64::MAX.to_string(),
        ..Default::default()
    };
    store::PluginStore::new(f.host.base.join("registry-v1.json"))
        .save(&state)
        .unwrap();
    assert!(
        f.host
            .install(&preview.preview_id, &u64::MAX.to_string())
            .is_err()
    );
    assert_eq!(
        0,
        fs::read_dir(f.host.base.join("installed")).unwrap().count()
    );
    assert!(f.host.list().unwrap().plugins.is_empty());
}
#[test]
fn uninstall_missing_managed_directory_or_parent_preserves_source() {
    for remove_parent in [false, true] {
        let mut f = Fixture::new();
        let installed = f.install(false);
        let path = &installed.plugins[0].source_path;
        fs::remove_dir_all(if remove_parent {
            path.parent().unwrap()
        } else {
            path.as_path()
        })
        .unwrap();
        let registry = f.host.mutate("example.review", "uninstall", "1").unwrap();
        assert!(registry.plugins.is_empty());
        assert!(f.source.join("manifest.json").exists());
        assert!(f.host.list().unwrap().plugins.is_empty());
    }
}
#[test]
fn empty_directories_count_towards_entry_budget() {
    let mut f = Fixture::new();
    for index in 0..files::MAX_ENTRIES {
        fs::create_dir(f.source.join(format!("empty-{index}"))).unwrap();
    }
    let error = f.host.inspect(&f.source, false).unwrap_err();
    assert!(error.contains("总条目超额"));
    assert!(!f.host.base.exists());
}
#[test]
fn one_broken_development_plugin_does_not_disable_other_plugins() {
    let mut f = Fixture::new();
    f.install(true);
    let mut manifest: serde_json::Value = serde_json::from_str(&manifest_text()).unwrap();
    manifest["id"] = "example.second".into();
    fs::write(f.source.join("manifest.json"), manifest.to_string()).unwrap();
    let preview = f.host.inspect(&f.source, false).unwrap();
    f.host.install(&preview.preview_id, "1").unwrap();
    f.host.mutate("example.second", "enable", "2").unwrap();
    fs::write(f.source.join("manifest.json"), manifest_text()).unwrap();
    f.host.mutate("example.review", "enable", "3").unwrap();
    fs::write(f.source.join("manifest.json"), "bad").unwrap();
    let registry = f.host.list().unwrap();
    assert!(!registry.plugins[0].enabled);
    assert!(registry.plugins[1].enabled);
    assert_eq!(1, registry.plugins[1].active_contributions.commands.len());
}
#[cfg(unix)]
#[test]
fn managed_parent_symlink_is_rejected_without_copying_outside() {
    let mut f = Fixture::new();
    let preview = f.host.inspect(&f.source, false).unwrap();
    fs::create_dir_all(&f.host.base).unwrap();
    let outside = f.root.join("outside");
    fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, f.host.base.join("installed")).unwrap();
    assert!(f.host.install(&preview.preview_id, "0").is_err());
    assert_eq!(0, fs::read_dir(&outside).unwrap().count());
}
#[test]
fn project_sample_passes_authoritative_manifest_validation() {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../examples/plugins/review-directory");
    let snapshot = files::read_snapshot(&root).unwrap();
    assert_eq!("example.review-directory", snapshot.manifest.id);
    assert_eq!(1, snapshot.manifest.contributes.commands.len());
}
