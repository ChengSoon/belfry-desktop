use super::config;
use crate::agent::AgentKind;
use serde_json::{Value, json};
use std::path::Path;

#[test]
fn installation_adds_hooks_without_replacing_user_settings_or_hooks() {
    let original = json!({"env":{"ANTHROPIC_AUTH_TOKEN":"private"},"hooks":{
        "Stop":[{"matcher":"","hooks":[{"type":"command","command":"user-stop"}]}],
        "CustomEvent":[{"hooks":[{"type":"command","command":"user-custom"}]}]}});
    let installed: Value = serde_json::from_str(
        &config::merge(
            &original.to_string(),
            AgentKind::Claude,
            Some("'/app/belfry' --belfry-hook claude"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!("private", installed["env"]["ANTHROPIC_AUTH_TOKEN"]);
    assert_eq!(
        original["hooks"]["CustomEvent"],
        installed["hooks"]["CustomEvent"]
    );
    assert_eq!(
        "user-stop",
        installed["hooks"]["Stop"][0]["hooks"][0]["command"]
    );
    assert!(
        installed["hooks"]["SessionStart"]
            .as_array()
            .is_some_and(|events| !events.is_empty())
    );
    let removed: Value = serde_json::from_str(
        &config::merge(&installed.to_string(), AgentKind::Claude, None).unwrap(),
    )
    .unwrap();
    assert_eq!(original, removed);
}

#[test]
fn reinstall_is_idempotent_and_replaces_only_the_managed_command() {
    let first = config::merge(
        "{}",
        AgentKind::Codex,
        Some("'/old/belfry' --belfry-hook codex"),
    )
    .unwrap();
    let upgraded = config::merge(
        &first,
        AgentKind::Codex,
        Some("'/new/belfry' --belfry-hook codex"),
    )
    .unwrap();
    assert!(!upgraded.contains("/old/"));
    assert!(upgraded.contains("/new/"));
    assert_eq!(
        upgraded,
        config::merge(
            &upgraded,
            AgentKind::Codex,
            Some("'/new/belfry' --belfry-hook codex")
        )
        .unwrap()
    );
}

#[test]
fn removal_preserves_sibling_handlers_in_a_modified_managed_group() {
    let installed = config::merge(
        "{}",
        AgentKind::Codex,
        Some("'/app/belfry' --belfry-hook codex"),
    )
    .unwrap();
    let mut value: Value = serde_json::from_str(&installed).unwrap();
    let hooks = value["hooks"]["Stop"][0]["hooks"].as_array_mut();
    assert!(hooks.is_some());
    hooks
        .unwrap()
        .push(json!({"type":"command","command":"user-added"}));
    let removed: Value =
        serde_json::from_str(&config::merge(&value.to_string(), AgentKind::Codex, None).unwrap())
            .unwrap();
    assert_eq!(
        json!([{"type":"command","command":"user-added"}]),
        removed["hooks"]["Stop"][0]["hooks"]
    );
}

#[test]
fn malformed_configuration_is_not_replaced_by_a_fresh_default() {
    for text in [
        "{bad",
        "[]",
        r#"{"hooks":[]}"#,
        r#"{"hooks":{"Stop":{}}}"#,
        r#"{"hooks":{"Stop":[{"hooks":{}}]}}"#,
    ] {
        assert!(
            config::merge(text, AgentKind::Codex, Some("belfry --belfry-hook codex")).is_err(),
            "{text}"
        );
    }
}

#[test]
fn command_paths_are_quoted_for_spaces_and_shell_metacharacters() {
    let unix = config::command(
        Path::new("/tmp/a b's/$(no)/Belfry"),
        AgentKind::Codex,
        false,
    )
    .unwrap();
    assert_eq!("'/tmp/a b'\"'\"'s/$(no)/Belfry' --belfry-hook codex", unix);
    let windows = config::command(
        Path::new(r"C:\Program Files\Belfry\app.exe"),
        AgentKind::Claude,
        true,
    )
    .unwrap();
    assert_eq!(
        r#""C:\Program Files\Belfry\app.exe" --belfry-hook claude"#,
        windows
    );
    assert!(config::command(Path::new(r"C:\%BAD%\app.exe"), AgentKind::Codex, true).is_err());
}

#[test]
fn stale_detection_reverses_the_quoting_used_at_install_time() {
    for (raw, windows) in [
        ("/tmp/a b's/$(no)/Belfry", false),
        (r"C:\Program Files\Belfry\app.exe", true),
    ] {
        let command = config::command(Path::new(raw), AgentKind::Claude, windows).unwrap();
        assert_eq!(
            Some(raw.to_string()),
            config::command_path(&command, AgentKind::Claude)
        );
    }
    assert_eq!(
        None,
        config::command_path("'/app/belfry' --belfry-hook codex", AgentKind::Claude)
    );
}

#[test]
fn hooks_left_pointing_at_a_removed_build_are_reported_as_stale() {
    let root = std::env::temp_dir().join(format!("belfry-hook-stale-{}", ulid::Ulid::generate()));
    let directory = root.join("a b's");
    std::fs::create_dir_all(&directory).unwrap();
    let binary = directory.join("belfry-desktop");
    std::fs::write(&binary, b"").unwrap();
    let installed = config::parse(
        &config::merge(
            "{}",
            AgentKind::Codex,
            Some(&config::command(&binary, AgentKind::Codex, false).unwrap()),
        )
        .unwrap(),
    )
    .unwrap();
    let events = config::events(AgentKind::Codex).len();
    assert_eq!(events, config::owned_count(&installed, AgentKind::Codex));
    assert_eq!(0, config::stale_count(&installed, AgentKind::Codex));
    std::fs::remove_dir_all(&root).unwrap();
    assert_eq!(events, config::stale_count(&installed, AgentKind::Codex));
}
