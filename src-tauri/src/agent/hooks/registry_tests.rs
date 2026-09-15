use super::{
    contracts::{HookInput, HookMessage, HookSnapshot},
    registry::{Registry, SessionSpec, SnapshotSink},
};
use crate::agent::contracts::{AgentKind, AgentLifecycleState as State, AgentStateSource};
use std::sync::{Arc, Mutex};

type Records = Arc<Mutex<Vec<(String, HookSnapshot)>>>;

fn setup() -> (Registry, Records, Arc<SnapshotSink>) {
    let records = Arc::new(Mutex::new(Vec::new()));
    let saved = records.clone();
    (
        Registry::default(),
        records,
        Arc::new(move |id, snapshot| saved.lock().unwrap().push((id, snapshot))),
    )
}

fn spec(tab: &str) -> SessionSpec {
    SessionSpec {
        tab_id: tab.into(),
        agent: AgentKind::Codex,
        resume_id: None,
        fallback: "未连接".into(),
    }
}

fn message(token: &str, event: &str, session: &str) -> HookMessage {
    HookMessage {
        version: 1,
        token: token.into(),
        agent: AgentKind::Codex,
        input: HookInput {
            event: event.into(),
            session_id: session.into(),
            occurred_at: 1,
            ..Default::default()
        },
    }
}

#[test]
fn parallel_sessions_route_only_to_their_own_terminal() {
    let (registry, records, sink) = setup();
    let a = registry.issue(spec("tab-a"), sink.clone()).unwrap();
    let b = registry.issue(spec("tab-b"), sink).unwrap();
    registry.bind(&a, "pty-a");
    registry.bind(&b, "pty-b");
    assert!(registry.accept(message(&a, "UserPromptSubmit", "native-a")));
    assert!(registry.accept(message(&b, "SessionStart", "native-b")));
    assert!(registry.accept(message(&b, "PermissionRequest", "native-b")));
    let records = records.lock().unwrap();
    let a = records.iter().rfind(|(id, _)| id == "pty-a").unwrap();
    let b = records.iter().rfind(|(id, _)| id == "pty-b").unwrap();
    assert_eq!(State::Processing, a.1.state);
    assert_eq!(State::AwaitingInput, b.1.state);
    assert_eq!("native-a", a.1.session.as_ref().unwrap().id);
    assert_eq!("native-b", b.1.session.as_ref().unwrap().id);
}

#[test]
fn restarted_session_rejects_its_old_token_and_foreign_agent_kind() {
    let (registry, _, sink) = setup();
    let old = registry.issue(spec("tab-a"), sink.clone()).unwrap();
    let current = registry.issue(spec("tab-a"), sink).unwrap();
    registry.bind(&current, "pty-new");
    assert!(!registry.accept(message(&old, "Stop", "native-old")));
    let mut wrong_agent = message(&current, "Stop", "native-new");
    wrong_agent.agent = AgentKind::Claude;
    assert!(!registry.accept(wrong_agent));
    assert!(registry.accept(message(&current, "SessionStart", "native-new")));
}

#[test]
fn early_hook_is_retained_until_the_pty_identity_is_available() {
    let (registry, records, sink) = setup();
    let token = registry.issue(spec("tab"), sink).unwrap();
    assert!(registry.accept(message(&token, "UserPromptSubmit", "native")));
    assert!(records.lock().unwrap().is_empty());
    registry.bind(&token, "pty");
    let records = records.lock().unwrap();
    assert_eq!(1, records.len());
    assert_eq!(State::Processing, records[0].1.state);
    assert_eq!("pty", records[0].0);
}

#[test]
fn process_failure_is_reported_and_further_events_are_rejected() {
    let (registry, records, sink) = setup();
    let token = registry.issue(spec("tab"), sink).unwrap();
    registry.bind(&token, "pty");
    registry.exited(&token, 1, false);
    let records = records.lock().unwrap();
    assert_eq!(State::Failed, records.last().unwrap().1.state);
    assert_eq!(AgentStateSource::Process, records.last().unwrap().1.source);
    assert!(!registry.accept(message(&token, "Stop", "native")));
}

#[test]
fn explicit_revocation_cannot_affect_another_live_session() {
    let (registry, _, sink) = setup();
    let a = registry.issue(spec("a"), sink.clone()).unwrap();
    let b = registry.issue(spec("b"), sink).unwrap();
    registry.revoke(&a);
    assert!(!registry.accept(message(&a, "Stop", "a")));
    assert!(registry.accept(message(&b, "SessionStart", "b")));
}

#[test]
fn a_resumed_session_rejects_a_different_native_identity() {
    let (registry, _, sink) = setup();
    let token = registry
        .issue(
            SessionSpec {
                resume_id: Some("resume-me".into()),
                ..spec("tab")
            },
            sink,
        )
        .unwrap();
    assert!(!registry.accept(message(&token, "SessionStart", "another")));
    assert!(registry.accept(message(&token, "SessionStart", "resume-me")));
}
