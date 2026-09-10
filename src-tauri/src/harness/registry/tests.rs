use super::*;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let dir =
            std::env::temp_dir().join(format!("belfry-system-registry-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&dir).unwrap();
        Self(dir.join("registry.json"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(parent) = self.0.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
fn plugin(version: &str) -> PluginDefinition {
    PluginDefinition {
        plugin_id: "example.harness".into(),
        version: version.into(),
        manifest_digest: format!("digest-{version}"),
        harness_api: 1,
        min_app_version: "0.19.0".into(),
        trusted: true,
        enabled: true,
        source: "local".into(),
        tools: vec!["project.read".into()],
        capabilities: vec!["project.read".into()],
    }
}
fn registry(fixture: &Fixture) -> SystemRegistry {
    SystemRegistry::new(fixture.0.clone(), |_| {})
}

#[test]
fn corrupt_store_is_read_only_and_never_overwritten() {
    let fixture = Fixture::new();
    fs::write(&fixture.0, "broken").unwrap();
    let registry = registry(&fixture);
    assert_eq!(registry.list().unwrap_err().code, "STORE_INVALID");
    assert_eq!(
        registry.install("0", plugin("1.0.0")).unwrap_err().code,
        "STORE_INVALID"
    );
    assert_eq!(fs::read_to_string(&fixture.0).unwrap(), "broken");
}

#[test]
fn two_registry_instances_cannot_lose_an_update() {
    let fixture = Fixture::new();
    let first = registry(&fixture);
    let second = registry(&fixture);
    first.install("0", plugin("1.0.0")).unwrap();
    assert_eq!(
        second.disable("0", "example.harness").unwrap_err().code,
        "REVISION_CONFLICT"
    );
    assert_eq!(second.list().unwrap().revision, "1");
}

#[test]
fn snapshots_survive_restart_history_is_bounded_and_semver_is_strict() {
    let fixture = Fixture::new();
    let initial = registry(&fixture);
    initial.install("0", plugin("1.0.0")).unwrap();
    initial
        .snapshot(
            "saved".into(),
            "a".into(),
            "example.harness",
            "w".into(),
            "/p".into(),
        )
        .unwrap();
    let restarted = registry(&fixture);
    assert_eq!(restarted.session("saved").unwrap().plugin.version, "1.0.0");
    assert!(!version_at_least("0.19.0", "0.bad.0"));
    assert!(!version_at_least("0.19.0", "0.19"));
}

#[test]
fn version_history_has_a_fixed_upper_bound() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", plugin("1.0.0")).unwrap();
    for revision in 1..=105 {
        registry
            .update(&revision.to_string(), plugin(&format!("1.0.{revision}")))
            .unwrap();
    }
    assert_eq!(registry.list().unwrap().history.len(), HISTORY_LIMIT);
}

#[test]
fn two_agents_share_definition_but_keep_session_state_isolated() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", plugin("1.0.0")).unwrap();
    let first = registry
        .snapshot(
            "s1".into(),
            "codex".into(),
            "example.harness",
            "w1".into(),
            "/one".into(),
        )
        .unwrap();
    let second = registry
        .snapshot(
            "s2".into(),
            "claude".into(),
            "example.harness",
            "w2".into(),
            "/two".into(),
        )
        .unwrap();
    registry
        .authorize("s1", vec!["project.read".into()])
        .unwrap();
    assert_eq!(first.plugin, second.plugin);
    assert_ne!(first.worker_id, second.worker_id);
    assert_eq!(registry.session("s1").unwrap().grants, vec!["project.read"]);
    assert!(registry.session("s2").unwrap().grants.is_empty());
}

#[test]
fn updates_only_change_new_session_snapshots() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", plugin("1.0.0")).unwrap();
    let old = registry
        .snapshot(
            "old".into(),
            "a".into(),
            "example.harness",
            "w1".into(),
            "/one".into(),
        )
        .unwrap();
    registry.update("2", plugin("2.0.0")).unwrap();
    let new = registry
        .snapshot(
            "new".into(),
            "b".into(),
            "example.harness",
            "w2".into(),
            "/two".into(),
        )
        .unwrap();
    assert_eq!(old.plugin.version, "1.0.0");
    assert_eq!(new.plugin.version, "2.0.0");
    registry.uninstall("4", "example.harness").unwrap();
    assert_eq!(registry.session("old").unwrap().plugin.version, "1.0.0");
    assert!(!registry.session("old").unwrap().resumable);
    assert_eq!(
        registry
            .snapshot(
                "later".into(),
                "c".into(),
                "example.harness",
                "w3".into(),
                "/three".into()
            )
            .unwrap_err()
            .code,
        "PLUGIN_UNAVAILABLE"
    );
}

#[test]
fn stale_revision_cannot_overwrite_and_discovery_is_consistent() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", plugin("1.0.0")).unwrap();
    assert_eq!(
        registry.disable("0", "example.harness").unwrap_err().code,
        "REVISION_CONFLICT"
    );
    assert_eq!(registry.list().unwrap().revision, "1");
    assert_eq!(registry.discover().unwrap().len(), 1);
    let mut untrusted = plugin("2.0.0");
    untrusted.trusted = false;
    registry.update("1", untrusted).unwrap();
    assert!(registry.discover().unwrap().is_empty());
}

fn fixture_plugin(version: &str) -> PluginDefinition {
    let script = fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/harness/worker.mjs"),
    )
    .unwrap();
    PluginDefinition {
        source: "fixture:worker.mjs".into(),
        manifest_digest: crate::harness::patch::digest(&script),
        ..plugin(version)
    }
}

#[test]
fn worker_launch_requires_runnable_immutable_snapshot() {
    for mutate in ["untrusted", "disabled", "incompatible"] {
        let fixture = Fixture::new();
        let registry = registry(&fixture);
        let mut item = fixture_plugin("1.0.0");
        if mutate == "untrusted" {
            item.trusted = false;
        } else if mutate == "disabled" {
            item.enabled = false;
        } else {
            item.harness_api = 2;
        }
        registry.install("0", item).unwrap();
        assert_eq!(
            registry
                .snapshot(
                    "s".into(),
                    "a".into(),
                    "example.harness",
                    "w".into(),
                    "/p".into()
                )
                .unwrap_err()
                .code,
            "PLUGIN_UNAVAILABLE"
        );
    }
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", fixture_plugin("1.0.0")).unwrap();
    registry
        .snapshot(
            "s".into(),
            "a".into(),
            "example.harness",
            "w".into(),
            "/p".into(),
        )
        .unwrap();
    registry.disable("2", "example.harness").unwrap();
    assert_eq!(
        registry.worker_launch("s").unwrap_err().code,
        "PLUGIN_UNAVAILABLE"
    );
}

#[test]
fn update_keeps_old_snapshot_version_and_uninstall_blocks_it() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", fixture_plugin("1.0.0")).unwrap();
    registry
        .snapshot(
            "old".into(),
            "a".into(),
            "example.harness",
            "worker-old".into(),
            "/one".into(),
        )
        .unwrap();
    registry.update("2", fixture_plugin("2.0.0")).unwrap();
    assert_eq!(
        registry.worker_launch("old").unwrap().worker_id,
        "worker-old"
    );
    registry.uninstall("3", "example.harness").unwrap();
    assert_eq!(
        registry.worker_launch("old").unwrap_err().code,
        "SESSION_UNAVAILABLE"
    );
}

#[test]
fn managed_sources_reject_path_attacks_and_digest_mismatch() {
    for source in [
        "/tmp/worker.mjs",
        "managed:../worker.mjs",
        "managed:missing.mjs",
    ] {
        let fixture = Fixture::new();
        let registry = registry(&fixture);
        let mut item = fixture_plugin("1.0.0");
        item.source = source.into();
        registry.install("0", item).unwrap();
        registry
            .snapshot(
                "s".into(),
                "a".into(),
                "example.harness",
                "w".into(),
                "/p".into(),
            )
            .unwrap();
        assert_eq!(
            registry.worker_launch("s").unwrap_err().code,
            "SOURCE_INVALID"
        );
    }
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    let mut item = fixture_plugin("1.0.0");
    item.manifest_digest = "wrong".into();
    registry.install("0", item).unwrap();
    registry
        .snapshot(
            "s".into(),
            "a".into(),
            "example.harness",
            "w".into(),
            "/p".into(),
        )
        .unwrap();
    assert_eq!(
        registry.worker_launch("s").unwrap_err().code,
        "DIGEST_MISMATCH"
    );
}

#[test]
fn tampered_snapshot_is_rejected_as_stale() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", fixture_plugin("1.0.0")).unwrap();
    registry
        .snapshot(
            "s".into(),
            "a".into(),
            "example.harness",
            "w".into(),
            "/p".into(),
        )
        .unwrap();
    let mut state: RegistryState =
        serde_json::from_str(&fs::read_to_string(&fixture.0).unwrap()).unwrap();
    state.sessions[0].plugin.source = "managed:other.mjs".into();
    fs::write(&fixture.0, serde_json::to_vec_pretty(&state).unwrap()).unwrap();
    assert_eq!(
        registry.worker_launch("s").unwrap_err().code,
        "SNAPSHOT_STALE"
    );
}

#[test]
fn two_session_launches_keep_worker_identity_and_start_fixture() {
    let fixture = Fixture::new();
    let registry = registry(&fixture);
    registry.install("0", fixture_plugin("1.0.0")).unwrap();
    for (session, worker) in [("s1", "worker-one"), ("s2", "worker-two")] {
        registry
            .snapshot(
                session.into(),
                "a".into(),
                "example.harness",
                worker.into(),
                "/p".into(),
            )
            .unwrap();
    }
    let first = registry.worker_launch("s1").unwrap();
    let second = registry.worker_launch("s2").unwrap();
    assert_ne!(first.worker_id, second.worker_id);
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/harness/worker.mjs");
    let manager = crate::harness::manager::WorkerManager::new(script, |_| {});
    assert_eq!(
        manager
            .start_registered(first.worker_id.clone(), &first.executable, &first.args)
            .unwrap(),
        first.worker_id
    );
    manager.stop_all();
}

#[cfg(unix)]
#[test]
fn managed_source_rejects_symlink_directory_and_unsafe_permissions() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let fixture = Fixture::new();
    let install_root = fixture.0.parent().unwrap().join("installations");
    fs::create_dir_all(&install_root).unwrap();
    let name = format!("worker-{}.mjs", ulid::Ulid::generate());
    let path = install_root.join(&name);
    fs::write(&path, "process.exit(0)\n").unwrap();
    let mut item = plugin("1.0.0");
    item.source = format!("managed:{name}");
    item.manifest_digest = crate::harness::patch::digest("process.exit(0)\n");
    let registry = registry(&fixture);
    registry.install("0", item).unwrap();
    registry
        .snapshot(
            "s".into(),
            "a".into(),
            "example.harness",
            "w".into(),
            "/p".into(),
        )
        .unwrap();
    assert!(registry.worker_launch("s").is_ok());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
    assert_eq!(
        registry.worker_launch("s").unwrap_err().code,
        "SOURCE_PERMISSIONS"
    );
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert_eq!(
        registry.worker_launch("s").unwrap_err().code,
        "SOURCE_INVALID"
    );
    fs::remove_dir(&path).unwrap();
    let outside = fixture.0.with_extension("outside");
    fs::write(&outside, "process.exit(0)\n").unwrap();
    symlink(&outside, &path).unwrap();
    assert_eq!(
        registry.worker_launch("s").unwrap_err().code,
        "SOURCE_INVALID"
    );
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(outside);
}
