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
