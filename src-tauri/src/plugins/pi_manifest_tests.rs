use super::{files, tests::Fixture};
use serde_json::{Value, json};
use std::fs;

fn pi_manifest() -> Value {
    json!({
        "schemaVersion": 1, "id": "local.pi-demo", "name": "PI Demo",
        "version": "0.1.0", "main": "main.js", "engines": {"piDesktop": ">=0.1.0"},
        "permissions": ["ui.panel", "agent.tool.register", "agent.prompt.inject"],
        "activationEvents": ["onStartup", "onCommand:demo.open"],
        "ui": {"panel": "renderer/index.html"},
        "contributes": {
            "commands": [{"id": "demo.open", "title": "Open demo"}],
            "agentTools": [{"name": "echo_text", "description": "Echo", "schema": {"type": "object"}}],
            "skills": ["./SKILL.md"],
            "settings": [{"key": "greeting", "title": "Greeting", "type": "string", "default": "Hello"}]
        }
    })
}

fn fixture(manifest: &Value) -> Fixture {
    let f = Fixture::new();
    fs::write(f.source.join("manifest.json"), manifest.to_string()).unwrap();
    fs::write(
        f.source.join("main.js"),
        "module.exports = { onLoad() {} };",
    )
    .unwrap();
    fs::create_dir(f.source.join("renderer")).unwrap();
    fs::write(f.source.join("renderer/index.html"), "<h1>Demo</h1>").unwrap();
    f
}

#[test]
fn accepts_pi_entrypoint_and_retains_original_runtime_manifest() {
    let input = pi_manifest();
    let mut f = fixture(&input);
    let result = f.host.inspect(&f.source, false);
    assert!(result.is_ok(), "PI 清单应可预览：{result:?}");
    let preview = result.unwrap();
    let stored = serde_json::to_value(preview.manifest).unwrap();
    assert_eq!(input, stored["runtime"]);
    let registry = f.host.install(&preview.preview_id, "0").unwrap();
    assert!(!registry.plugins[0].enabled);
    assert_eq!(registry, f.host.list().unwrap());
}

#[test]
fn supports_skill_only_pi_plugins_without_static_permissions() {
    let mut input = pi_manifest();
    input["permissions"] = json!(["agent.prompt.inject"]);
    input.as_object_mut().unwrap().remove("ui");
    input["contributes"] = json!({"skills": ["./SKILL.md"]});
    let f = fixture(&input);
    let snapshot = files::read_snapshot(&f.source);
    assert!(snapshot.is_ok(), "纯 Skill PI 插件应可读取：{snapshot:?}");
    assert_eq!(
        "SKILL.md",
        snapshot.unwrap().manifest.contributes.skills[0].path
    );
}

#[test]
fn rejects_missing_and_escaping_pi_entrypoints() {
    for path in ["gone.js", "../outside.js", "/tmp/main.js", "C:\\main.js"] {
        let mut input = pi_manifest();
        input["main"] = path.into();
        let mut f = fixture(&input);
        assert!(f.host.inspect(&f.source, false).is_err());
        assert!(!f.host.base.exists());
    }
}

#[test]
fn rejects_missing_panel_and_unknown_pi_permission() {
    for (field, value) in [
        ("ui", json!({"panel": "missing.html"})),
        ("permissions", json!(["arbitrary.host.access"])),
        ("permissions", json!(["harnesses"])),
    ] {
        let mut input = pi_manifest();
        input[field] = value;
        let mut f = fixture(&input);
        assert!(f.host.inspect(&f.source, false).is_err());
    }
}

#[test]
fn widening_pi_file_scope_requires_new_authorization() {
    let mut input = pi_manifest();
    input["permissions"] = json!([
        "ui.panel",
        "agent.tool.register",
        "agent.prompt.inject",
        "fs.write"
    ]);
    input["fs"] = json!({"write": {"scope": ["out/**"]}});
    let mut f = fixture(&input);
    let preview = f
        .host
        .inspect(&f.source, true)
        .expect("支持带文件范围的 PI 插件");
    f.host.install(&preview.preview_id, "0").unwrap();
    f.host.mutate("local.pi-demo", "enable", "1").unwrap();
    input["fs"]["write"]["scope"] = json!(["out/**", "src/**"]);
    fs::write(f.source.join("manifest.json"), input.to_string()).unwrap();
    let registry = f.host.mutate("local.pi-demo", "reload", "2").unwrap();
    assert!(!registry.plugins[0].enabled);
    assert!(
        registry.plugins[0]
            .error
            .as_deref()
            .unwrap()
            .contains("权限")
    );
}

#[test]
fn pi_sources_skip_development_artifacts_and_tolerate_missing_optional_icons() {
    let mut input = pi_manifest();
    input["icon"] = json!("icon.png");
    let mut f = fixture(&input);
    for name in [".git", "node_modules", "dist"] {
        fs::create_dir(f.source.join(name)).unwrap();
        fs::write(f.source.join(name).join("ignored"), "not a plugin resource").unwrap();
    }
    let preview = f
        .host
        .inspect(&f.source, true)
        .expect("可选图标不应阻止 PI 插件");
    let registry = f.host.install(&preview.preview_id, "0").unwrap();
    let snapshot = f.host.snapshot_entry(&registry.plugins[0]).unwrap();
    assert!(!snapshot.files.keys().any(|name| name.starts_with("dist/")
        || name.starts_with(".git/")
        || name.starts_with("node_modules/")));
}

#[test]
fn pi_sources_reject_invalid_settings_and_missing_contribution_authority() {
    for extra in [
        json!({"engines":{"piDesktop":">=99.0.0"}}),
        json!({"contributes":{"settings":[{"key":"token","type":"string","secret":true}]}}),
        json!({"contributes":{"settings":[{"key":"invalid","type":"code"}]}}),
        json!({"contributes":{"mcpServers":[{"id":"remote","transport":"http","url":"https://example.invalid"}]}}),
        json!({"contributes":{"bus":{"publish":["demo.topic"]}}}),
    ] {
        let mut input = pi_manifest();
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let mut f = fixture(&input);
        assert!(
            f.host.inspect(&f.source, false).is_err(),
            "应拒绝无效 PI 清单：{extra}"
        );
    }
}

#[test]
fn pi_sources_reject_invalid_theme_contents_before_installation() {
    const THEME_LIMIT: usize = 256 * 1024;
    for bytes in [vec![0xff], vec![b'x'; THEME_LIMIT + 1], b"a\0b".to_vec()] {
        let mut input = pi_manifest();
        input["permissions"]
            .as_array_mut()
            .unwrap()
            .push(json!("ui.theme"));
        input["contributes"]["themes"] = json!([{"id":"demo", "label":"Demo", "path":"theme.css"}]);
        let mut f = fixture(&input);
        let rule = ":root { --ds-accent: red; }";
        let css = format!("{rule}{}", " ".repeat(THEME_LIMIT - rule.len()));
        assert_eq!(THEME_LIMIT, css.len());
        fs::write(f.source.join("theme.css"), css).unwrap();
        assert!(f.host.inspect(&f.source, false).is_ok());
        fs::write(f.source.join("theme.css"), bytes).unwrap();
        assert!(f.host.inspect(&f.source, false).is_err());
        assert!(!f.host.base.exists());
    }
}

#[cfg(not(windows))]
#[test]
fn pi_sources_reject_nonportable_file_and_directory_names() {
    for name in ["NUL.txt", "invalid?.js", "trailing."] {
        let mut f = fixture(&pi_manifest());
        fs::write(f.source.join(name), "test").unwrap();
        assert!(f.host.inspect(&f.source, true).is_err(), "应拒绝 {name}");
        assert!(!f.host.base.exists());
    }
    let mut f = fixture(&pi_manifest());
    fs::create_dir(f.source.join("CON")).unwrap();
    assert!(f.host.inspect(&f.source, true).is_err());
}

#[test]
fn accepts_upstream_market_metadata_engines_and_renderer_bundles() {
    let mut input = pi_manifest();
    input["engines"] = json!({"piDesktop": ">=0.14.3"});
    input["permissions"]
        .as_array_mut()
        .unwrap()
        .push(json!("browser.cdp"));
    input["categories"] = json!(["developer-tools"]);
    input["changelog"] = json!(["Initial release"]);
    input["safetyNotes"] = json!("Runs in the plugin host");
    input["i18n"] = json!({"zh-CN": {"name": "日志查看器"}});
    let mut f = fixture(&input);
    fs::write(
        f.source.join("renderer/app.js"),
        vec![b' '; 3 * 1024 * 1024],
    )
    .unwrap();
    let preview = f
        .host
        .inspect(&f.source, false)
        .expect("应支持原版插件字段和资源大小");
    assert_eq!(Some(input), preview.manifest.runtime);
}
