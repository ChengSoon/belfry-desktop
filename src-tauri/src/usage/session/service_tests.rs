use super::{
    contracts::SessionStatisticsQuery, fixtures::*, paths, service::SessionStatisticsState,
};
use crate::agent::AgentKind;
use serde_json::json;
use std::fs;

fn query() -> SessionStatisticsQuery {
    SessionStatisticsQuery {
        session: session(AgentKind::Claude),
        transcript_path: None,
    }
}

#[test]
fn only_the_requested_native_session_is_discovered() {
    let fixture = Fixture::new();
    let own = fixture.write("native.jsonl", &[claude("message", 3)]);
    fixture.write("other.jsonl", &[claude("other", 100)]);
    let result = paths::resolve(&fixture.0, &session(AgentKind::Claude), None).unwrap();
    assert_eq!(vec![own.canonicalize().unwrap()], result.paths);
}

#[test]
fn a_transcript_hint_cannot_read_outside_the_cli_log_root() {
    let root = Fixture::new();
    let outside = Fixture::new();
    let path = outside.write("native.jsonl", &[claude("private", 100)]);
    assert!(paths::resolve(&root.0, &session(AgentKind::Claude), path.to_str()).is_err());
}

#[cfg(unix)]
#[test]
fn a_symlink_cannot_escape_the_cli_log_root() {
    let root = Fixture::new();
    let outside = Fixture::new();
    let path = outside.write("native.jsonl", &[claude("private", 100)]);
    let link = root.0.join("native.jsonl");
    std::os::unix::fs::symlink(path, &link).unwrap();
    assert!(paths::resolve(&root.0, &session(AgentKind::Claude), link.to_str()).is_err());
}

#[test]
fn state_isolates_parallel_sessions_and_configuration_roots() {
    let first = Fixture::new();
    let second = Fixture::new();
    first.write("native.jsonl", &[claude("same-message", 3)]);
    second.write("native.jsonl", &[claude("same-message", 8)]);
    let state = SessionStatisticsState::default();
    assert_eq!(
        Some(3),
        state.read_in(&first.0, query()).unwrap().tokens.output
    );
    assert_eq!(
        Some(8),
        state.read_in(&second.0, query()).unwrap().tokens.output
    );
    let mut other = claude("same-message", 15);
    other["sessionId"] = json!("other");
    first.write("other.jsonl", &[other]);
    let mut request = query();
    request.session.id = "other".into();
    assert_eq!(
        Some(15),
        state.read_in(&first.0, request).unwrap().tokens.output
    );
    assert_eq!(
        Some(3),
        state.read_in(&first.0, query()).unwrap().tokens.output
    );
}

#[test]
fn malformed_native_identity_is_rejected_before_scanning() {
    let root = Fixture::new();
    let mut request = query();
    request.session.id = "../outside".into();
    assert!(
        SessionStatisticsState::default()
            .read_in(&root.0, request)
            .is_err()
    );
}

#[test]
fn codex_metadata_takes_precedence_over_a_misleading_filename() {
    let root = Fixture::new();
    root.write(
        "rollout-native.jsonl",
        &[
            json!({"type":"session_meta","payload":{"id":"different"}}),
            codex(100),
        ],
    );
    let found = paths::resolve(&root.0, &session(AgentKind::Codex), None).unwrap();
    assert!(found.paths.is_empty());
}

#[test]
fn missing_logs_return_a_retriable_notice_and_do_not_create_files() {
    let root = Fixture::new();
    let absent = root.0.join("absent");
    let report = SessionStatisticsState::default()
        .read_in(&absent, query())
        .unwrap();
    assert_eq!(None, report.tokens.output);
    assert!(report.note.is_some());
    assert!(!absent.exists());
    assert_eq!(0, fs::read_dir(&root.0).unwrap().count());
}

#[test]
fn codex_native_log_discovery_supports_both_identity_field_spellings() {
    let root = Fixture::new();
    root.write(
        "rollout-early-native.jsonl",
        &[
            json!({"type":"session_meta","payload":{"session_id":"native"}}),
            codex(10),
        ],
    );
    root.write(
        "rollout-late-native.jsonl",
        &[
            json!({"type":"session_meta","payload":{"id":"native"}}),
            codex(10),
            codex(20),
        ],
    );
    let request = SessionStatisticsQuery {
        session: session(AgentKind::Codex),
        transcript_path: None,
    };
    let report = SessionStatisticsState::default()
        .read_in(&root.0, request)
        .unwrap();
    assert_eq!(Some(20), report.tokens.output);
    assert_eq!(2, report.source_files);
}

#[cfg(unix)]
#[test]
fn replacing_a_cached_log_with_an_external_link_is_rejected_on_the_next_read() {
    let root = Fixture::new();
    let outside = Fixture::new();
    let path = root.write("native.jsonl", &[claude("message", 3)]);
    let foreign = outside.write("native.jsonl", &[claude("private", 99)]);
    let state = SessionStatisticsState::default();
    assert_eq!(
        Some(3),
        state.read_in(&root.0, query()).unwrap().tokens.output
    );
    fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(foreign, path).unwrap();
    assert!(state.read_in(&root.0, query()).is_err());
}
