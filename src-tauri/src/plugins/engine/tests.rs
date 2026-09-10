use super::{connection::Connection, embedded};
use serde_json::{Value, json};
use std::{fs, path::PathBuf, sync::Arc};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("belfry-engine-test-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn embedded_host_authors_packages_and_executes_the_installed_plugin() {
    let fixture = Fixture::new();
    let node =
        crate::agent::find_in_path("node").expect("Node.js required for plugin integration tests");
    let root = embedded::materialize(&fixture.0).unwrap();
    let connection = Connection::launch(
        (&node, &root, &fixture.0),
        (Arc::new(|_| Ok(Value::Null)), Arc::new(|_| {})),
    )
    .unwrap();
    let directory = fixture.0.join("authored");
    connection.call("hello", json!({})).unwrap();
    connection.call("author.scaffold", json!({"template":"full-demo", "directory":directory, "id":"local.rust-test", "name":"Rust interop"})).unwrap();
    let package = connection
        .call("author.pack", json!({"directory":directory}))
        .unwrap();
    let package_path = PathBuf::from(package["packagePath"].as_str().expect("package path"));
    let mut host = crate::plugins::host::PluginHost::new(fixture.0.join("installer"));
    let preview = host.inspect(&package_path, false).unwrap();
    let registry = host.install(&preview.preview_id, "0").unwrap();
    let entry = &registry.plugins[0];
    connection
        .call(
            "load",
            json!({"path":entry.source_path, "manifest":entry.manifest.runtime}),
        )
        .unwrap();
    let result = connection.call("tool", json!({"pluginId":entry.manifest.id, "name":"echo_text", "args":{"text":"Rust → Node → plugin"}})).unwrap();
    assert_eq!(
        Some("Rust → Node → plugin"),
        result["content"][0]["text"].as_str()
    );
    connection
        .call("unload", json!({"pluginId":entry.manifest.id}))
        .unwrap();
    assert_eq!(
        json!([]),
        connection.call("catalog", json!({})).unwrap()["tools"]
    );
    connection.stop();
}

#[test]
fn refuses_modified_embedded_runtime_sources() {
    let fixture = Fixture::new();
    let root = embedded::materialize(&fixture.0).unwrap();
    fs::write(root.join("host.mjs"), "changed").unwrap();
    assert!(embedded::materialize(&fixture.0).is_err());
}

#[test]
fn assembles_large_theme_catalogs_from_bounded_host_messages() {
    let fixture = Fixture::new();
    let node = crate::agent::find_in_path("node").expect("Node.js required");
    let root = embedded::materialize(&fixture.0).unwrap();
    let connection = Connection::launch(
        (&node, &root, &fixture.0),
        (Arc::new(|_| Ok(Value::Null)), Arc::new(|_| {})),
    )
    .unwrap();
    let directory = fixture.0.join("themes");
    fs::create_dir(&directory).unwrap();
    let themes = (0..6)
        .map(|index| {
            json!({
                "id":format!("theme-{index}"), "label":"Theme", "path":"theme.css"
            })
        })
        .collect::<Vec<_>>();
    let manifest = json!({"schemaVersion":1,"id":"local.themes","name":"Themes",
        "version":"1.0.0","main":"main.js","permissions":["ui.theme"],
        "contributes":{"themes":themes}});
    let css = format!(
        "\u{feff}:root {{ --name: '{}'; }}",
        "主题".repeat(35 * 1024)
    );
    fs::write(directory.join("theme.css"), &css).unwrap();
    fs::write(directory.join("main.js"), "module.exports = {};").unwrap();
    fs::write(directory.join("manifest.json"), manifest.to_string()).unwrap();
    connection
        .call("load", json!({"path":directory,"manifest":manifest}))
        .unwrap();
    let catalog = super::catalog::read(&connection).unwrap();
    assert_eq!(6, catalog["themes"].as_array().unwrap().len());
    for theme in catalog["themes"].as_array().unwrap() {
        assert_eq!(Some(css.as_str()), theme["css"].as_str());
    }
    connection.stop();
}
