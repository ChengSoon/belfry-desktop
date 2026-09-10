use super::*;
use std::{
    fs,
    path::{Path, PathBuf},
};

struct InstallFixture {
    dir: PathBuf,
    registry: SystemRegistry,
}
impl InstallFixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("harness-install-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&dir).unwrap();
        let registry = SystemRegistry::new(dir.join("registry.json"), |_| {});
        Self { dir, registry }
    }
    fn files(&self, manifest: &str, worker: &[u8]) -> (String, String) {
        let manifest_path = self.dir.join("manifest.json");
        let worker_path = self.dir.join("selected-worker.mjs");
        fs::write(&manifest_path, manifest).unwrap();
        fs::write(&worker_path, worker).unwrap();
        (
            manifest_path.to_string_lossy().into(),
            worker_path.to_string_lossy().into(),
        )
    }
}
impl Drop for InstallFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn manifest(version: &str) -> String {
    format!(
        r#"{{"pluginId":"local.example","version":"{version}","harnessApi":1,"minAppVersion":"0.19.0","tools":["project.read"],"capabilities":["project.read"]}}"#
    )
}
fn no_temps(root: &Path) -> bool {
    fs::read_dir(root)
        .map(|e| {
            e.flatten()
                .all(|p| !p.file_name().to_string_lossy().starts_with(".tmp-"))
        })
        .unwrap_or(true)
}

#[test]
fn local_install_is_integrity_checked_and_uses_managed_source() {
    let f = InstallFixture::new();
    let (m, w) = f.files(&manifest("1.0.0"), b"export default 1;\n");
    let preview = f.registry.preview_install(m, w).unwrap();
    assert!(!preview.signed);
    assert_eq!(preview.trust, "local-user-approved/integrity-checked");
    let state = f.registry.commit_install(&preview.preview_id).unwrap();
    let plugin = &state.plugins[0];
    assert_eq!(plugin.source, "managed:local.example/1.0.0/worker.mjs");
    assert_eq!(
        fs::read_to_string(f.dir.join("installations/local.example/1.0.0/worker.mjs")).unwrap(),
        "export default 1;\n"
    );
    assert!(no_temps(&f.dir.join("installations")));
}

#[test]
fn cancel_and_tampering_leave_no_install() {
    let f = InstallFixture::new();
    let (m, w) = f.files(&manifest("1.0.0"), b"worker");
    let cancelled = f.registry.preview_install(m.clone(), w.clone()).unwrap();
    f.registry.cancel_install(&cancelled.preview_id).unwrap();
    assert_eq!(
        f.registry
            .commit_install(&cancelled.preview_id)
            .unwrap_err()
            .code,
        "PREVIEW_EXPIRED"
    );
    let changed = f.registry.preview_install(m.clone(), w).unwrap();
    fs::write(m, manifest("1.0.1")).unwrap();
    assert_eq!(
        f.registry
            .commit_install(&changed.preview_id)
            .unwrap_err()
            .code,
        "DIGEST_MISMATCH"
    );
    assert!(f.registry.list().unwrap().plugins.is_empty());
}

#[test]
fn strict_manifest_and_utf8_inputs_are_rejected() {
    let f = InstallFixture::new();
    for bad in [
        "{}".into(),
        manifest("1.0.0").replace("}", ",\"trusted\":true}"),
        manifest("1.0.0").replacen("\"version\":", "\"version\":\"2.0.0\",\"version\":", 1),
    ] {
        let (m, w) = f.files(&bad, b"worker");
        assert_eq!(
            f.registry.preview_install(m, w).unwrap_err().code,
            "MANIFEST_INVALID"
        );
    }
    let (m, w) = f.files(&manifest("1.0.0"), &[0xff]);
    assert_eq!(
        f.registry.preview_install(m, w).unwrap_err().code,
        "INVALID_UTF8"
    );
}

#[test]
fn downgrade_and_stale_revision_roll_back_artifacts() {
    let f = InstallFixture::new();
    let (m, w) = f.files(&manifest("2.0.0"), b"two");
    let first = f.registry.preview_install(m, w).unwrap();
    f.registry.commit_install(&first.preview_id).unwrap();
    let (m, w) = f.files(&manifest("1.9.0"), b"old");
    assert_eq!(
        f.registry.preview_install(m, w).unwrap_err().code,
        "DOWNGRADE_DENIED"
    );
    let (m, w) = f.files(&manifest("3.0.0"), b"three");
    let stale = f.registry.preview_install(m, w).unwrap();
    f.registry.disable("1", "local.example").unwrap();
    assert_eq!(
        f.registry
            .commit_install(&stale.preview_id)
            .unwrap_err()
            .code,
        "REVISION_CONFLICT"
    );
    assert!(!f.dir.join("installations/local.example/3.0.0").exists());
    assert!(no_temps(&f.dir.join("installations")));
}

#[test]
fn startup_recovery_cleans_journal_orphans_and_is_idempotent() {
    let f = InstallFixture::new();
    let root = f.dir.join("installations");
    let final_dir = root.join("orphan.example/1.0.0");
    fs::create_dir_all(&final_dir).unwrap();
    fs::write(final_dir.join("worker.mjs"), "orphan").unwrap();
    fs::create_dir_all(root.join(".tmp-crash")).unwrap();
    fs::write(
        root.join(".journal-orphan.example-1.0.0.json"),
        r#"{"schemaVersion":1,"operation":"install","pluginId":"orphan.example","version":"1.0.0","tempName":".tmp-crash","finalName":"orphan.example/1.0.0","phase":"after-rename"}"#,
    )
    .unwrap();
    let restarted = SystemRegistry::new(f.dir.join("registry.json"), |_| {});
    assert!(
        restarted.list().is_ok(),
        "{:?}",
        restarted.list().unwrap_err()
    );
    assert!(!final_dir.exists());
    assert!(!root.join(".tmp-crash").exists());
    assert!(!root.join(".journal-orphan.example-1.0.0.json").exists());
    let restarted_again = SystemRegistry::new(f.dir.join("registry.json"), |_| {});
    assert!(restarted_again.list().is_ok());
}

#[test]
fn startup_recovery_never_deletes_registry_referenced_artifact() {
    let f = InstallFixture::new();
    let (m, w) = f.files(&manifest("1.0.0"), b"worker");
    let preview = f.registry.preview_install(m, w).unwrap();
    f.registry.commit_install(&preview.preview_id).unwrap();
    let final_dir = f.dir.join("installations/local.example/1.0.0");
    fs::write(
        f.dir.join("installations/.journal-local.example-1.0.0.json"),
        r#"{"schemaVersion":1,"operation":"install","pluginId":"local.example","version":"1.0.0","tempName":".tmp-nope","finalName":"local.example/1.0.0","phase":"after-rename"}"#,
    )
    .unwrap();
    let restarted = SystemRegistry::new(f.dir.join("registry.json"), |_| {});
    assert!(restarted.list().is_ok());
    assert!(final_dir.join("worker.mjs").exists());
    assert!(
        !f.dir
            .join("installations/.journal-local.example-1.0.0.json")
            .exists()
    );
}

#[test]
fn corrupt_journal_and_symlink_fail_closed_without_deleting_unknown_data() {
    let f = InstallFixture::new();
    let root = f.dir.join("installations");
    fs::create_dir_all(&root).unwrap();
    let journal = root.join(".journal-corrupt.example-1.0.0.json");
    fs::write(&journal, b"not-json").unwrap();
    let broken = SystemRegistry::new(f.dir.join("registry.json"), |_| {});
    assert_eq!(broken.list().unwrap_err().code, "RECOVERY_JOURNAL_INVALID");
    assert!(journal.exists());
    let clean = InstallFixture::new();
    let root = clean.dir.join("installations");
    fs::create_dir_all(&root).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(clean.dir.join("outside"), root.join("escape.example")).unwrap();
    #[cfg(unix)]
    assert_eq!(
        SystemRegistry::new(clean.dir.join("registry.json"), |_| {})
            .list()
            .unwrap_err()
            .code,
        "RECOVERY_PATH_INVALID"
    );
}
