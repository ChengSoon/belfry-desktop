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

// Codex 写完 payload 不关管道；等 EOF 会一直阻塞到 `hook timed out after 1s`。
#[test]
fn reading_stops_at_the_closing_brace_instead_of_waiting_for_eof() {
    struct RefuseReadPastPayload {
        payload: Vec<u8>,
        offset: usize,
    }
    impl std::io::Read for RefuseReadPastPayload {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            assert!(
                self.offset < self.payload.len(),
                "payload 已读完仍继续读取——真实管道上这里会挂到 Hook 超时"
            );
            let count = (self.payload.len() - self.offset).min(buf.len());
            buf[..count].copy_from_slice(&self.payload[self.offset..self.offset + count]);
            self.offset += count;
            Ok(count)
        }
    }

    let reader = RefuseReadPastPayload {
        payload: br#"{"hook_event_name":"SessionStart","session_id":"session-1"}"#.to_vec(),
        offset: 0,
    };
    let input = helper::read_input(reader, 77).expect("完整的 payload 应当解析成功");
    assert_eq!("SessionStart", input.event);
    assert_eq!("session-1", input.session_id);
    assert_eq!(77, input.occurred_at);
}
