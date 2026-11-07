use super::*;
use crate::agent::AgentKind;

#[derive(Default)]
struct Sink(Mutex<Vec<TerminalEvent>>);
impl TerminalEventSink for Sink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

fn native(id: &str) -> AgentSessionRef {
    AgentSessionRef {
        agent: AgentKind::Codex,
        id: id.into(),
    }
}
fn info(session: Option<AgentSessionRef>) -> SessionInfo {
    SessionInfo {
        session: serde_json::from_value(serde_json::json!({
            "id":"pty", "platform":"macos", "shell":"codex", "cwd":"file:///tmp",
            "cols":80, "rows":24, "status":"running", "exitCode":null, "connectionId":"view"
        }))
        .unwrap(),
        tab_id: Some("tab".into()),
        profile_id: "agent:codex".into(),
        native_session: session,
    }
}
fn hook(id: &str, sequence: u64) -> TerminalEvent {
    TerminalEvent::AgentState {
        session_id: "pty".into(),
        snapshot: crate::agent::hooks::HookSnapshot {
            agent: AgentKind::Codex,
            session: Some(native(id)),
            sequence,
            state: serde_json::from_value(serde_json::json!("processing")).unwrap(),
            source: serde_json::from_value(serde_json::json!("hook")).unwrap(),
            occurred_at: sequence as i64,
            reason: "test".into(),
            transcript_path: None,
        },
    }
}

#[test]
fn a_hook_during_lookup_wins_over_a_delayed_mcp_result_and_its_cached_resume() {
    let identities = Arc::new(NativeIdentities::default());
    let sink = Arc::new(Sink::default());
    identities.listen(&info(None).session, sink.clone(), Some(&native("A")));
    identities.observe(sink.clone()).send(hook("B", 2)).unwrap();
    // 这份查询快照是 Hook B 到达前取到的 A；完成查询后不能把 UI 再改回 A。
    identities.publish("pty", &native("A"), Some(&native("A")));
    assert!(
        matches!(sink.0.lock().unwrap().last(), Some(TerminalEvent::SessionIdentity { session, .. }) if session.id == "B")
    );
    assert_eq!(
        Some(native("B")),
        identities.enrich(info(None)).native_session
    );
}

#[test]
fn daemon_identity_wins_over_old_local_cache_and_old_hook_replay_cannot_lower_the_cache() {
    let identities = Arc::new(NativeIdentities::default());
    identities.publish("pty", &native("A"), None);
    assert_eq!(
        Some(native("B")),
        identities.enrich(info(Some(native("B")))).native_session
    );
    let sink = Arc::new(Sink::default());
    let observed = identities.observe(sink.clone());
    observed.send(hook("B", 2)).unwrap();
    observed.send(hook("A", 1)).unwrap();
    identities.listen(&info(None).session, sink.clone(), Some(&native("A")));
    identities.publish("pty", &native("A"), None);
    assert_eq!(
        Some(native("B")),
        identities.enrich(info(None)).native_session
    );
    assert!(
        matches!(sink.0.lock().unwrap().last(), Some(TerminalEvent::SessionIdentity { session, .. }) if session.id == "B")
    );
}

#[test]
fn a_late_native_lookup_cannot_downgrade_an_already_observed_hook() {
    let identities = Arc::new(NativeIdentities::default());
    let sink = Arc::new(Sink::default());
    identities.observe(sink.clone()).send(hook("B", 2)).unwrap();
    assert_eq!(
        native("B"),
        identities.resolve("pty", &native("A"), Some(&native("A")))
    );
    identities.listen(&info(None).session, sink.clone(), None);
    identities.publish("pty", &native("A"), Some(&native("A")));
    assert!(
        matches!(sink.0.lock().unwrap().last(), Some(TerminalEvent::SessionIdentity { session, .. }) if session.id == "B")
    );
}
