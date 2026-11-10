use super::super::contracts::ProviderConfig;
use super::{contracts::ProjectProviderSelection, launch, storage};
use crate::agent::AgentKind;
use portable_pty::CommandBuilder;
use std::{fs, path::PathBuf};

pub(super) struct TempRoot(pub PathBuf);
impl TempRoot {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "belfry-project-provider-{}",
            ulid::Ulid::generate()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn selection(root: &str, kind: AgentKind, id: Option<&str>) -> ProjectProviderSelection {
    ProjectProviderSelection {
        root_path: root.into(),
        kind,
        provider_id: id.map(str::to_owned),
    }
}

pub(super) fn provider(id: &str) -> ProviderConfig {
    ProviderConfig {
        id: id.into(),
        name: format!("提供方 {id}"),
        base_url: format!("https://{id}.example.invalid/v1"),
        api_key: format!("private-test-key-{id}"),
        model: "test-model".into(),
        created_at: 1,
    }
}

#[test]
fn opencode_project_provider_keeps_inherited_plugins_permissions_and_mcp_settings() {
    let root = TempRoot::new();
    let mut overlay = launch::prepare(&root.0, AgentKind::Opencode, &provider("a")).unwrap();
    let inherited = r#"{"plugins":["my-plugin"],"providers":{"mine":{}},"mcp":{"servers":{"mine":{"type":"remote","url":"https://example.test"}}},"permissions":[{"action":"shell","resource":"*","effect":"ask"}]}"#;
    launch::merge_opencode_environment(&mut overlay, inherited).unwrap();
    let config =
        crate::provider::json_config::parse(&overlay.environment["OPENCODE_CONFIG_CONTENT"])
            .unwrap();
    assert_eq!(config["plugins"], serde_json::json!(["my-plugin"]));
    assert_eq!(config["permissions"][0]["effect"], "ask");
    assert!(config["providers"]["mine"].is_object());
    assert_eq!(
        config["mcp"]["servers"]["mine"]["url"],
        "https://example.test"
    );
    assert_eq!(config["model"], "belfry/test-model");
    assert!(!overlay.environment["OPENCODE_CONFIG_CONTENT"].contains("private-test-key"));
}

#[test]
fn project_and_agent_selections_are_independent_and_reloading_keeps_them() {
    let root = TempRoot::new();
    let path = root.0.join("choices.json");
    for entry in [
        selection("/A", AgentKind::Codex, Some("a")),
        selection("/B", AgentKind::Codex, Some("b")),
        selection("/A", AgentKind::Claude, Some("c")),
    ] {
        storage::save(&path, &entry).unwrap();
    }
    let report = storage::read(&path).unwrap();
    assert_eq!(Some("a"), report.provider("/A", AgentKind::Codex));
    assert_eq!(Some("b"), report.provider("/B", AgentKind::Codex));
    assert_eq!(Some("c"), report.provider("/A", AgentKind::Claude));
    storage::save(&path, &selection("/A", AgentKind::Codex, None)).unwrap();
    let report = storage::read(&path).unwrap();
    assert_eq!(None, report.provider("/A", AgentKind::Codex));
    assert_eq!(Some("b"), report.provider("/B", AgentKind::Codex));
    assert!(!fs::read_to_string(path).unwrap().contains("apiKey"));
}

#[test]
fn corrupt_or_future_choices_cannot_be_overwritten() {
    let root = TempRoot::new();
    let path = root.0.join("choices.json");
    for content in ["{bad", r#"{"version":2,"projects":{}}"#] {
        fs::write(&path, content).unwrap();
        assert!(storage::save(&path, &selection("/A", AgentKind::Codex, Some("a"))).is_err());
        assert_eq!(content, fs::read_to_string(&path).unwrap());
    }
}

#[test]
fn codex_launches_have_separate_routes_and_keys_without_keys_in_arguments() {
    let root = TempRoot::new();
    let a = launch::prepare(&root.0, AgentKind::Codex, &provider("a")).unwrap();
    let b = launch::prepare(&root.0, AgentKind::Codex, &provider("b")).unwrap();
    let command = |overlay: &crate::terminal::overlay::LaunchOverlay| {
        let mut command = CommandBuilder::new("codex");
        command.env("OPENAI_API_KEY", "inherited-wrong-key");
        overlay.apply(&mut command);
        command
    };
    let a_command = command(&a);
    let b_command = command(&b);
    assert_eq!(
        Some(std::ffi::OsStr::new("private-test-key-a")),
        a_command.get_env("BELFRY_PROVIDER_API_KEY")
    );
    assert_eq!(
        Some(std::ffi::OsStr::new("private-test-key-b")),
        b_command.get_env("BELFRY_PROVIDER_API_KEY")
    );
    assert_eq!(None, a_command.get_env("OPENAI_API_KEY"));
    assert!(
        a.arguments
            .iter()
            .any(|value| value.contains("https://a.example.invalid/v1"))
    );
    assert!(
        b.arguments
            .iter()
            .any(|value| value.contains("https://b.example.invalid/v1"))
    );
    assert!(!a.arguments.join(" ").contains("private-test-key"));
    assert!(!format!("{a:?}").contains("private-test-key"));
}

#[test]
fn claude_snapshots_are_immutable_private_and_live_until_the_last_lease_is_dropped() {
    let root = TempRoot::new();
    let a = launch::prepare(&root.0, AgentKind::Claude, &provider("a")).unwrap();
    let b = launch::prepare(&root.0, AgentKind::Claude, &provider("b")).unwrap();
    assert_eq!("--settings", a.arguments[0]);
    let path_a = PathBuf::from(&a.arguments[1]);
    let path_b = PathBuf::from(&b.arguments[1]);
    assert_ne!(path_a, path_b);
    let settings: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path_a).unwrap()).unwrap();
    assert_eq!(
        "private-test-key-a",
        settings["env"]["ANTHROPIC_AUTH_TOKEN"]
    );
    assert_eq!("", settings["env"]["ANTHROPIC_API_KEY"]);
    assert_eq!("test-model", settings["model"]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            0o600,
            fs::metadata(&path_a).unwrap().permissions().mode() & 0o777
        );
    }
    let lease = a.clone();
    drop(a);
    assert!(path_a.exists());
    drop(lease);
    assert!(!path_a.exists());
    assert!(path_b.exists());
}

#[test]
fn concurrent_project_saves_do_not_lose_other_project_choices() {
    let root = TempRoot::new();
    let path = root.0.join("choices.json");
    std::thread::scope(|scope| {
        for project in ["/A", "/B", "/C"] {
            let path = &path;
            scope.spawn(move || {
                storage::save(path, &selection(project, AgentKind::Claude, Some(project))).unwrap()
            });
        }
    });
    let result = storage::read(&path).unwrap();
    for project in ["/A", "/B", "/C"] {
        assert_eq!(Some(project), result.provider(project, AgentKind::Claude));
    }
}

#[test]
fn missing_credentials_cannot_fall_back_to_a_different_global_login() {
    let root = TempRoot::new();
    let mut value = provider("test");
    value.api_key.clear();
    for kind in AgentKind::ALL {
        assert!(launch::prepare(&root.0, kind, &value).is_err());
    }
}

#[test]
fn role_model_overrides_the_launch_copy_for_every_agent_without_mutating_the_provider() {
    let root = TempRoot::new();
    let provider = provider("shared");
    let before = provider.clone();
    for kind in AgentKind::ALL {
        for model in ["builder-model", "reviewer-model"] {
            let overlay = launch::prepare_with_model(&root.0, kind, &provider, Some(model)).unwrap();
            match kind {
                AgentKind::Codex => assert!(overlay.arguments.contains(&format!("model=\"{model}\""))),
                AgentKind::Claude => {
                    let settings: serde_json::Value = serde_json::from_str(&fs::read_to_string(&overlay.arguments[1]).unwrap()).unwrap();
                    assert_eq!(settings["model"], model);
                    assert_eq!(overlay.environment["ANTHROPIC_MODEL"], model);
                }
                AgentKind::Pi => {
                    let dir = PathBuf::from(&overlay.environment["PI_CODING_AGENT_DIR"]);
                    let settings: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap();
                    let models: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join("models.json")).unwrap()).unwrap();
                    assert_eq!(settings["defaultModel"], model);
                    assert_eq!(models["providers"]["belfry"]["models"][0]["id"], model);
                }
                AgentKind::Antigravity => {
                    let settings: serde_json::Value = serde_json::from_str(&fs::read_to_string(&overlay.arguments[1]).unwrap()).unwrap();
                    assert_eq!(settings["customModelsConfig"]["customModels"]["belfry"]["modelName"], model);
                    assert_eq!(overlay.arguments[3], "Belfry");
                }
                AgentKind::Opencode => {
                    let settings: serde_json::Value = serde_json::from_str(&overlay.environment["OPENCODE_CONFIG_CONTENT"]).unwrap();
                    assert_eq!(settings["model"], format!("belfry/{model}"));
                    assert!(settings["providers"]["belfry"]["models"].get(model).is_some());
                }
                AgentKind::Kimi => {
                    assert_eq!(overlay.arguments, ["--model", "__kimi_env_model__"]);
                    assert_eq!(overlay.environment["KIMI_MODEL_NAME"], model);
                }
            }
        }
        assert_eq!((&provider.id, &provider.name, &provider.model, &provider.base_url, &provider.api_key, provider.created_at),
            (&before.id, &before.name, &before.model, &before.base_url, &before.api_key, before.created_at));
    }
}

#[test]
fn inherited_role_model_keeps_the_selected_provider_model() {
    let root = TempRoot::new();
    let provider = provider("selected-project");
    let overlay = launch::prepare_with_model(&root.0, AgentKind::Codex, &provider, None).unwrap();
    assert!(overlay.arguments.contains(&"model=\"test-model\"".to_string()));
    assert_eq!(overlay.environment["BELFRY_PROVIDER_API_KEY"], provider.api_key);
}

#[test]
fn model_only_launch_keeps_cli_authentication_and_native_codex_routing() {
    let overlay = launch::model_only(Some("role-model"));
    assert_eq!(overlay.arguments, ["--model", "role-model"]);
    assert!(overlay.environment.is_empty());
    assert!(overlay.unset.is_empty());
    assert!(overlay.retained_files.is_empty());
    let mut command = CommandBuilder::new("agent");
    command.env("EXISTING_AUTH", "native-test-value");
    overlay.apply(&mut command);
    assert_eq!(command.get_env("EXISTING_AUTH"), Some(std::ffi::OsStr::new("native-test-value")));
    let inherited = launch::model_only(None);
    assert!(inherited.arguments.is_empty() && inherited.environment.is_empty());
}
