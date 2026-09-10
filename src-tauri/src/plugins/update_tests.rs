use super::{install::InstallOptions, tests::Fixture};
use std::fs;

#[test]
fn reviewed_upgrade_replaces_managed_files_and_preserves_install_time() {
    let mut fixture = Fixture::new();
    let old = fixture.install(false);
    let old_entry = old.plugins[0].clone();
    let manifest = super::tests::manifest_text().replace("1.0.0", "1.1.0");
    fs::write(fixture.source.join("manifest.json"), manifest).unwrap();
    let preview = fixture.host.inspect(&fixture.source, false).unwrap();
    let result = fixture
        .host
        .install_with_options(
            (&preview.preview_id, &old.revision),
            InstallOptions {
                replace: true,
                enabled: true,
            },
        )
        .unwrap();
    assert_eq!(1, result.plugins.len());
    assert_eq!("1.1.0", result.plugins[0].manifest.version);
    assert_eq!(old_entry.installed_at, result.plugins[0].installed_at);
    assert!(result.plugins[0].enabled);
    assert!(!old_entry.source_path.exists());
    assert!(fixture.source.exists());
}

#[test]
fn changed_update_preview_leaves_the_installed_version_intact() {
    let mut fixture = Fixture::new();
    let old = fixture.install(false);
    let preview = fixture.host.inspect(&fixture.source, false).unwrap();
    fs::write(fixture.source.join("SKILL.md"), "changed after review").unwrap();
    assert!(
        fixture
            .host
            .install_with_options(
                (&preview.preview_id, &old.revision),
                InstallOptions {
                    replace: true,
                    enabled: true
                },
            )
            .is_err()
    );
    assert_eq!(old, fixture.host.list().unwrap());
    assert!(old.plugins[0].source_path.exists());
}
