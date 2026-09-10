use super::{
    host::PluginHost,
    store::PluginEntry,
    tests::{Fixture, manifest_text},
};
use serde_json::{Value, json};
use std::fs;

fn legacy_manifest(permission: bool, contribution: bool) -> Value {
    let mut value: Value = serde_json::from_str(&manifest_text()).unwrap();
    if permission {
        value["permissions"]
            .as_array_mut()
            .unwrap()
            .push(json!("harnesses"));
    }
    value["contributes"]["harnesses"] = if contribution {
        json!([{"id":"legacy","title":"Legacy","harnessPluginId":"example.harness"}])
    } else {
        json!([])
    };
    value
}

fn legacy_entry(fixture: &Fixture, enabled: bool) -> PluginEntry {
    let id = if enabled {
        "legacy.enabled"
    } else {
        "legacy.disabled"
    };
    let source = fixture.source.with_file_name(id);
    let mut value = legacy_manifest(true, enabled);
    value["id"] = json!(id);
    fs::create_dir(&source).unwrap();
    fs::write(source.join("manifest.json"), value.to_string()).unwrap();
    fs::write(source.join("SKILL.md"), "Legacy guide").unwrap();
    PluginEntry {
        manifest: serde_json::from_value(value).unwrap(),
        enabled,
        source: "development".into(),
        source_path: source,
        installed_at: 0,
        updated_at: 0,
        error: None,
        active_contributions: Default::default(),
    }
}

fn legacy_fixture() -> Fixture {
    let mut fixture = Fixture::new();
    fixture.install(true);
    let mut registry = fixture
        .host
        .mutate("example.review", "enable", "1")
        .unwrap();
    registry
        .plugins
        .extend([legacy_entry(&fixture, true), legacy_entry(&fixture, false)]);
    fixture.host.store().save(&registry).unwrap();
    fixture
}

#[test]
fn removed_harness_capabilities_are_rejected_before_installation() {
    for (permission, contribution) in [(true, false), (false, true), (true, true)] {
        let mut fixture = Fixture::new();
        let value = legacy_manifest(permission, contribution);
        fs::write(fixture.source.join("manifest.json"), value.to_string()).unwrap();
        let error = fixture.host.inspect(&fixture.source, false).unwrap_err();
        assert!(error.contains("Harness 功能已移除"), "{error}");
        assert!(!fixture.host.base.exists());
    }
}

#[test]
fn absent_or_empty_legacy_fields_preserve_static_plugin_lifecycle() {
    for include_empty_field in [false, true] {
        let mut fixture = Fixture::new();
        let value = if include_empty_field {
            legacy_manifest(false, false).to_string()
        } else {
            manifest_text()
        };
        fs::write(fixture.source.join("manifest.json"), value).unwrap();
        let installed = fixture.install(false);
        fixture
            .host
            .mutate("example.review", "enable", &installed.revision)
            .unwrap();
        let restored = PluginHost::new(fixture.host.base.clone()).list().unwrap();
        assert!(restored.plugins[0].enabled);
        assert_eq!(1, restored.plugins[0].active_contributions.commands.len());
        let removed = fixture
            .host
            .mutate("example.review", "uninstall", &restored.revision)
            .unwrap();
        assert!(removed.plugins.is_empty());
    }
}

#[test]
fn retired_registry_entries_are_disabled_once_without_affecting_static_plugins() {
    let fixture = legacy_fixture();
    let recovered = fixture.host.list().unwrap();
    assert!(recovered.plugins[0].enabled);
    for entry in &recovered.plugins[1..] {
        assert!(!entry.enabled);
        assert!(
            entry
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("Harness 功能已移除")
        );
        assert!(entry.active_contributions.commands.is_empty());
    }
    assert_eq!("3", recovered.revision);
    assert_eq!(recovered.revision, fixture.host.list().unwrap().revision);
}

#[test]
fn retired_registry_entries_cannot_restart_but_can_be_uninstalled() {
    let fixture = legacy_fixture();
    let recovered = fixture.host.list().unwrap();
    let mut current = recovered;
    for action in ["enable", "reload"] {
        current = fixture
            .host
            .mutate("legacy.enabled", action, &current.revision)
            .unwrap();
        assert!(!current.plugins[1].enabled);
        assert!(
            current.plugins[1]
                .error
                .as_deref()
                .unwrap()
                .contains("Harness 功能已移除")
        );
    }
    let disabled = fixture
        .host
        .mutate("legacy.enabled", "disable", &current.revision)
        .unwrap();
    assert!(
        disabled.plugins[1]
            .error
            .as_deref()
            .unwrap()
            .contains("Harness 功能已移除")
    );
    let removed = fixture
        .host
        .mutate("legacy.enabled", "uninstall", &disabled.revision)
        .unwrap();
    assert_eq!(2, removed.plugins.len());
    assert!(removed.plugins[0].enabled);
    assert!(fixture.source.with_file_name("legacy.enabled").exists());
}
