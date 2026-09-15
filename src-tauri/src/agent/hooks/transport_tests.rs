use super::{
    contracts::{HookInput, HookMessage},
    helper,
    registry::{Registry, SessionSpec},
    server::Server,
};
use crate::agent::contracts::{AgentKind, AgentLifecycleState};
use std::sync::{Arc, Mutex};

#[test]
fn loopback_transport_delivers_the_authenticated_event_and_rejects_unknown_tokens() {
    let registry = Arc::new(Registry::default());
    let records = Arc::new(Mutex::new(Vec::new()));
    let saved = records.clone();
    let token = registry
        .issue(
            SessionSpec {
                tab_id: "tab".into(),
                agent: AgentKind::Codex,
                resume_id: None,
                fallback: "未连接".into(),
            },
            Arc::new(move |id, state| saved.lock().unwrap().push((id, state))),
        )
        .unwrap();
    registry.bind(&token, "pty");
    let server = Server::start(registry.clone()).unwrap();
    let mut message = HookMessage {
        version: 1,
        token,
        agent: AgentKind::Codex,
        input: HookInput {
            event: "UserPromptSubmit".into(),
            session_id: "native".into(),
            occurred_at: 1,
            ..Default::default()
        },
    };
    assert!(helper::send(server.port(), &message));
    assert_eq!(
        AgentLifecycleState::Processing,
        records.lock().unwrap().last().unwrap().1.state
    );
    message.token = "unknown-token".into();
    assert!(!helper::send(server.port(), &message));
    let count = records.lock().unwrap().len();
    assert_eq!(2, count);
}
