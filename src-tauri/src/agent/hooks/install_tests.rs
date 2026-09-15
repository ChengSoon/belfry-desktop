use super::install::{InstallSpec, Installer};
use crate::agent::AgentKind;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("belfry-hook-install-{}", ulid::Ulid::generate()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn spec(&self, enabled: bool) -> InstallSpec {
        InstallSpec {
            path: self.0.join("settings.json"),
            kind: AgentKind::Claude,
            command: enabled.then(|| "'/app/belfry' --belfry-hook claude".into()),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn preview_does_not_write_or_expose_settings_secrets_and_apply_writes_only_after_review() {
    let fixture = Fixture::new();
    let path = fixture.spec(true).path;
    let before = r#"{"env":{"TOKEN":"private-secret"}}"#;
    fs::write(&path, before).unwrap();
    let installer = Installer::default();
    let preview = installer.preview(fixture.spec(true)).unwrap();
    assert_eq!(before, fs::read_to_string(&path).unwrap());
    assert!(
        !serde_json::to_string(&preview)
            .unwrap()
            .contains("private-secret")
    );
    installer.apply(&preview.id).unwrap();
    let after: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!("private-secret", after["env"]["TOKEN"]);
    assert!(after["hooks"]["SessionStart"].is_array());
    assert!(installer.apply(&preview.id).is_err());
}

#[test]
fn a_user_edit_after_preview_is_preserved_instead_of_overwritten() {
    let fixture = Fixture::new();
    let path = fixture.spec(true).path;
    fs::write(&path, "{}").unwrap();
    let installer = Installer::default();
    let preview = installer.preview(fixture.spec(true)).unwrap();
    let changed = r#"{"custom":"new-user-edit"}"#;
    fs::write(&path, changed).unwrap();
    assert!(installer.apply(&preview.id).is_err());
    assert_eq!(changed, fs::read_to_string(path).unwrap());
}

#[test]
fn removal_of_an_uninstalled_integration_does_not_create_a_file() {
    let fixture = Fixture::new();
    let path = fixture.spec(false).path;
    let installer = Installer::default();
    let preview = installer.preview(fixture.spec(false)).unwrap();
    installer.apply(&preview.id).unwrap();
    assert!(!path.exists());
    assert!(installer.apply("unknown").is_err());
}

#[test]
fn corrupt_file_is_rejected_at_preview_without_modification() {
    let fixture = Fixture::new();
    let path = fixture.spec(true).path;
    fs::write(&path, "broken-json").unwrap();
    assert!(Installer::default().preview(fixture.spec(true)).is_err());
    assert_eq!("broken-json", fs::read_to_string(path).unwrap());
}
