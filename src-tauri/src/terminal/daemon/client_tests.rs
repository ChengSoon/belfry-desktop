use super::super::protocol::{Frame, PollResult, Reply};
use super::*;
use crate::{
    agent::{AgentKind, AgentSessionRef},
    terminal::{
        TerminalEvent,
        contracts::{Platform, TerminalExitReason},
    },
};
use std::{
    collections::VecDeque,
    net::TcpListener,
    sync::{
        Condvar,
        atomic::{AtomicBool, Ordering},
    },
};

struct Peer {
    client: DaemonClient,
    calls: Arc<Mutex<Vec<serde_json::Value>>>,
    remaining: Arc<Mutex<VecDeque<(&'static str, Option<Reply>)>>>,
    stopping: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Peer {
    fn new(replies: Vec<(&'static str, Option<Reply>)>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = Endpoint {
            version: 1,
            port: listener.local_addr().unwrap().port(),
            token: "test".into(),
            instance: "isolated-test".into(),
            pid: std::process::id(),
        };
        let client = DaemonClient::new(PathBuf::new());
        *client.endpoint.lock().unwrap() = Some(endpoint);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let remaining = Arc::new(Mutex::new(VecDeque::from(replies)));
        let stopping = Arc::new(AtomicBool::new(false));
        let (observed, queued, stop) = (calls.clone(), remaining.clone(), stopping.clone());
        let worker = thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                let (mut stream, _) = match listener.accept() {
                    Ok(stream) => stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("test listener failed: {error}"),
                };
                transport::prepare_peer(&stream).unwrap();
                let request: serde_json::Value = transport::read(&mut stream).unwrap();
                let command = &request["command"];
                observed.lock().unwrap().push(command.clone());
                let custom_poll = command["kind"] == "poll"
                    && queued
                        .lock()
                        .unwrap()
                        .front()
                        .is_some_and(|(kind, _)| *kind == "poll");
                let reply = if command["kind"] == "poll" && !custom_poll {
                    Some(Reply::ok(PollResult {
                        cursor: 1,
                        gap: None,
                        frames: vec![Frame {
                            cursor: 0,
                            event: TerminalEvent::Exit {
                                session_id: command["id"].as_str().unwrap().into(),
                                exit_code: 0,
                                reason: TerminalExitReason::Normal,
                            },
                        }],
                    }))
                } else {
                    let (kind, reply) = queued
                        .lock()
                        .unwrap()
                        .pop_front()
                        .expect("unexpected daemon command");
                    assert_eq!(kind, command["kind"].as_str().unwrap());
                    reply
                };
                if let Some(reply) = reply {
                    let _ = transport::write(&mut stream, &reply);
                }
            }
        });
        Self {
            client,
            calls,
            remaining,
            stopping,
            worker: Some(worker),
        }
    }
    fn commands(&self) -> Vec<serde_json::Value> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call["kind"] != "poll")
            .cloned()
            .collect()
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.client.detach_all();
        self.stopping.store(true, Ordering::Release);
        let result = self.worker.take().unwrap().join();
        if !thread::panicking() {
            result.unwrap();
            assert!(
                self.remaining.lock().unwrap().is_empty(),
                "expected daemon calls were not made"
            );
        }
    }
}

#[derive(Default)]
struct Sink {
    events: Mutex<Vec<TerminalEvent>>,
    changed: Condvar,
}
impl TerminalEventSink for Sink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        self.events.lock().unwrap().push(event);
        self.changed.notify_all();
        Ok(())
    }
}
impl Sink {
    fn wait_exit(&self) {
        let (events, _) = self
            .changed
            .wait_timeout_while(
                self.events.lock().unwrap(),
                Duration::from_secs(2),
                |events| {
                    !events
                        .iter()
                        .any(|event| matches!(event, TerminalEvent::Exit { .. }))
                },
            )
            .unwrap();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, TerminalEvent::Exit { .. }))
        );
    }
}

fn session(id: &str, status: TerminalStatus, reconnected: bool) -> TerminalSession {
    TerminalSession {
        id: id.into(),
        platform: Platform::Macos,
        shell: "codex".into(),
        cwd: "file:///tmp".into(),
        cols: 80,
        rows: 24,
        status,
        exit_code: (status == TerminalStatus::Exited).then_some(9),
        reconnected,
        connection_id: None,
    }
}
fn request() -> CreateTerminalRequest {
    let mut request: CreateTerminalRequest = serde_json::from_value(serde_json::json!({
        "platform":"macos", "profileId":"agent:codex", "tabId":"tab", "cwd":"file:///tmp",
        "cols":80, "rows":24, "elevation":"normal", "resume":"saved-native"
    }))
    .unwrap();
    request.launch_overlay.attachment = Some("old".into());
    request.launch_overlay.recover_exited = true;
    request
}
fn info() -> SessionInfo {
    SessionInfo {
        session: session("old", TerminalStatus::Exited, false),
        tab_id: Some("tab".into()),
        profile_id: "agent:codex".into(),
        native_session: None,
    }
}
fn reply(kind: &'static str, value: impl serde::Serialize) -> (&'static str, Option<Reply>) {
    (kind, Some(Reply::ok(value)))
}

#[test]
fn legacy_daemon_recovers_only_the_verified_exited_id_and_subscribes_only_to_the_new_pty() {
    let peer = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Exited, true)),
        reply("info", info()),
        reply("ping", serde_json::json!({"version":1,"pid":1})),
        reply("close", ()),
        reply("create", session("fresh", TerminalStatus::Running, false)),
    ]);
    let sink = Arc::new(Sink::default());
    let mut prepared = 0;
    let fresh = peer
        .client
        .spawn_prepared(request(), sink.clone(), |request| {
            assert_eq!(Some("saved-native"), request.resume.as_deref());
            prepared += 1;
            Ok(())
        })
        .unwrap();
    assert_eq!(1, prepared);
    assert_eq!("fresh", fresh.id);
    assert!(!fresh.reconnected);
    sink.wait_exit();
    let calls = peer.commands();
    assert_eq!("old", calls[3]["id"]);
    assert!(calls[4]["attachment"].is_null());
    assert_eq!("saved-native", calls[4]["launch"]["resume"]);
    assert_eq!(false, calls[4]["recover_exited"]);
    assert!(
        peer.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call["kind"] == "poll")
            .all(|call| call["id"] == "fresh")
    );
    assert!(sink.events.lock().unwrap().iter().all(|event| match event {
        TerminalEvent::Exit { session_id, .. }
        | TerminalEvent::SessionIdentity { session_id, .. } => session_id == "fresh",
        _ => false,
    }));
}

#[test]
fn new_daemon_uses_atomic_recovery_and_does_not_retry_a_replacement_that_already_exited() {
    let peer = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Exited, true)),
        reply("info", info()),
        reply(
            "ping",
            serde_json::json!({"capabilities":["recover_exited"]}),
        ),
        reply("create", session("fresh", TerminalStatus::Exited, false)),
    ]);
    let sink = Arc::new(Sink::default());
    let fresh = peer
        .client
        .spawn_prepared(request(), sink.clone(), |_| Ok(()))
        .unwrap();
    sink.wait_exit();
    assert_eq!(TerminalStatus::Exited, fresh.status);
    assert!(!fresh.reconnected);
    let calls = peer.commands();
    assert_eq!(4, calls.len());
    assert_eq!(true, calls[3]["recover_exited"]);
    assert_eq!("old", calls[3]["attachment"]);
}

#[test]
fn running_connections_and_ordinary_exited_replay_do_not_prepare_or_spawn() {
    for (recover, status) in [
        (true, TerminalStatus::Running),
        (false, TerminalStatus::Exited),
    ] {
        let peer = Peer::new(vec![reply("create", session("old", status, true))]);
        let mut request = request();
        request.launch_overlay.recover_exited = recover;
        let sink = Arc::new(Sink::default());
        assert_eq!(
            "old",
            peer.client
                .spawn_prepared(request, sink.clone(), |_| panic!(
                    "live/replay must not prepare a new launch"
                ))
                .unwrap()
                .id
        );
        sink.wait_exit();
        assert_eq!(1, peer.commands().len());
    }
}

#[test]
fn io_and_target_errors_do_not_close_or_create_another_session() {
    for failure in [
        None,
        Some(Reply::failure(AppError::invalid_argument(
            "different project",
        ))),
        Some(Reply::failure(AppError {
            code: AppErrorCode::PermissionDenied,
            message: "permission denied".into(),
            retryable: false,
            details: None,
            params: Default::default(),
        })),
    ] {
        let peer = Peer::new(vec![("create", failure)]);
        let result = peer
            .client
            .spawn_prepared(request(), Arc::new(Sink::default()), |_| {
                panic!("failed attachment must not prepare")
            });
        assert!(result.is_err());
        assert_eq!(1, peer.commands().len());
    }
}

#[test]
fn failed_preparation_keeps_the_legacy_exited_record_untouched() {
    let peer = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Exited, true)),
        reply("info", info()),
    ]);
    let result = peer
        .client
        .spawn_prepared(request(), Arc::new(Sink::default()), |_| {
            Err(AppError::not_found("provider unavailable"))
        });
    assert_eq!(AppErrorCode::NotFound, result.unwrap_err().code);
    assert_eq!(2, peer.commands().len());
}

#[test]
fn old_daemon_identity_is_cached_and_delivered_to_the_view_without_a_new_wire_command() {
    let peer = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Exited, true)),
        reply("info", info()),
        reply("ping", serde_json::json!({"version":1})),
        reply("info", info()),
    ]);
    let sink = Arc::new(Sink::default());
    let mut request = request();
    request.resume = None;
    request.launch_overlay.recover_exited = false;
    let session = peer
        .client
        .spawn_prepared(request, sink.clone(), |_| Ok(()))
        .unwrap();
    sink.wait_exit();
    let identity = AgentSessionRef {
        agent: AgentKind::Codex,
        id: "exact-native".into(),
    };
    peer.client
        .bind_native_session(&session.id, identity.clone())
        .unwrap();
    assert!(
        sink.events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event,
        TerminalEvent::SessionIdentity { session: value, .. } if value == &identity))
    );
    assert_eq!(
        Some(identity),
        peer.client.attachment("old").unwrap().native_session
    );
    assert!(
        peer.commands()
            .iter()
            .all(|call| call["kind"] != "bind_identity")
    );
}

#[test]
fn initial_resume_precedes_hook_replay_and_late_mcp_cannot_replace_the_newer_hook_identity() {
    let newer = AgentSessionRef {
        agent: AgentKind::Codex,
        id: "newer-hook".into(),
    };
    let page = PollResult {
        cursor: 2,
        gap: None,
        frames: vec![
            Frame {
                cursor: 0,
                event: TerminalEvent::AgentState {
                    session_id: "old".into(),
                    snapshot: crate::agent::hooks::HookSnapshot {
                        agent: AgentKind::Codex,
                        session: Some(newer.clone()),
                        sequence: 2,
                        state: serde_json::from_value(serde_json::json!("processing")).unwrap(),
                        source: serde_json::from_value(serde_json::json!("hook")).unwrap(),
                        occurred_at: 2,
                        reason: "test".into(),
                        transcript_path: None,
                    },
                },
            },
            Frame {
                cursor: 1,
                event: TerminalEvent::Exit {
                    session_id: "old".into(),
                    exit_code: 0,
                    reason: TerminalExitReason::Normal,
                },
            },
        ],
    };
    let peer = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Running, true)),
        reply("poll", page),
        reply("info", info()),
        reply("ping", serde_json::json!({"version":1})),
        reply("info", info()),
    ]);
    let sink = Arc::new(Sink::default());
    peer.client
        .spawn_prepared(request(), sink.clone(), |_| {
            panic!("running PTY must not respawn")
        })
        .unwrap();
    sink.wait_exit();
    assert!(
        matches!(sink.events.lock().unwrap().first(), Some(TerminalEvent::SessionIdentity { session, .. }) if session.id == "saved-native")
    );
    peer.client
        .bind_native_session(
            "old",
            AgentSessionRef {
                agent: AgentKind::Codex,
                id: "saved-native".into(),
            },
        )
        .unwrap();
    assert!(
        matches!(sink.events.lock().unwrap().last(), Some(TerminalEvent::SessionIdentity { session, .. }) if session == &newer)
    );
    assert_eq!(
        Some(newer),
        peer.client.attachment("old").unwrap().native_session
    );
    assert!(
        peer.commands()
            .iter()
            .all(|command| command["kind"] != "bind_identity")
    );
}
