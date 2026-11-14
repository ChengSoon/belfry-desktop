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
    thread,
    time::Duration,
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
            token: "test".repeat(13),
            instance: ulid::Ulid::generate().to_string(),
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

#[test]
fn legacy_daemon_cannot_silently_downgrade_checked_input_to_ordinary_write() {
    let peer = Peer::new(vec![(
        "ping",
        Some(Reply::ok(serde_json::json!({"capabilities": []}))),
    )]);
    let error = peer
        .client
        .write_checked("old", b"automatic", Some(7))
        .unwrap_err();
    assert_eq!(error.code, AppErrorCode::Conflict);
    assert_eq!(peer.commands().len(), 1);
    assert_eq!(peer.commands()[0]["kind"], "ping");
}

#[test]
fn checked_input_keeps_the_status_fence_and_structured_zero_write_rejection() {
    let peer = Peer::new(vec![
        (
            "ping",
            Some(Reply::ok(
                serde_json::json!({"capabilities": ["terminal_program_status_v1"]}),
            )),
        ),
        (
            "write_checked",
            Some(Reply::failure(AppError::conflict("status changed"))),
        ),
        ("write_checked", Some(Reply::ok(()))),
    ]);
    assert_eq!(
        peer.client
            .write_checked("pty", b"payload", Some(7))
            .unwrap_err()
            .code,
        AppErrorCode::Conflict
    );
    peer.client
        .write_checked("pty", b"payload", Some(8))
        .unwrap();
    let calls = peer.commands();
    assert_eq!(calls[1]["expected_program_sequence"], 7);
    assert_eq!(calls[2]["expected_program_sequence"], 8);
    assert!(calls.iter().all(|command| command["kind"] != "write"));
}

fn retain(primary: &Peer, previous: &Peer) {
    let endpoint = previous.client.endpoint.lock().unwrap().clone().unwrap();
    primary
        .client
        .previous
        .lock()
        .unwrap()
        .push(endpoint.clone());
    primary
        .client
        .routes
        .lock()
        .unwrap()
        .insert("old".into(), endpoint);
}

#[test]
fn a_rolling_upgrade_keeps_live_sessions_and_writes_with_their_original_owner() {
    let primary = Peer::new(vec![]);
    let previous = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Running, true)),
        reply("write", ()),
        reply("ping", serde_json::json!({"capabilities":[]})),
    ]);
    retain(&primary, &previous);
    let sink = Arc::new(Sink::default());
    let running = primary
        .client
        .spawn_prepared(request(), sink.clone(), |_| {
            panic!("must keep running task")
        })
        .unwrap();
    assert_eq!(running.id, "old");
    primary.client.write("old", b"manual input").unwrap();
    assert_eq!(
        primary
            .client
            .write_checked("old", b"automatic input", Some(7))
            .unwrap_err()
            .code,
        AppErrorCode::Conflict
    );
    sink.wait_exit();
    assert!(primary.commands().is_empty());
    assert_eq!(
        previous
            .commands()
            .iter()
            .map(|c| c["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["create", "write", "ping"]
    );
}

#[test]
fn new_tabs_use_the_new_daemon_and_its_own_status_capabilities() {
    let primary = Peer::new(vec![
        reply("lookup", Option::<SessionInfo>::None),
        reply("create", session("fresh", TerminalStatus::Running, false)),
        reply(
            "ping",
            serde_json::json!({"capabilities":["terminal_program_status_v1"]}),
        ),
        reply("write_checked", ()),
    ]);
    let previous = Peer::new(vec![reply("lookup", Option::<SessionInfo>::None)]);
    retain(&primary, &previous);
    let mut launch = request();
    launch.tab_id = Some("new-tab".into());
    launch.launch_overlay.attachment = None;
    let sink = Arc::new(Sink::default());
    let fresh = primary
        .client
        .spawn_prepared(launch, sink.clone(), |_| Ok(()))
        .unwrap();
    primary
        .client
        .write_checked(&fresh.id, b"prompt", Some(5))
        .unwrap();
    sink.wait_exit();
    assert_eq!(fresh.id, "fresh");
    assert!(
        previous
            .commands()
            .iter()
            .all(|call| call["kind"] == "lookup")
    );
    assert_eq!(
        primary.commands().last().unwrap()["expected_program_sequence"],
        5
    );
}

#[test]
fn an_exited_old_session_resumes_history_on_the_new_daemon_without_replaying_input() {
    let primary = Peer::new(vec![reply(
        "create",
        session("fresh", TerminalStatus::Running, false),
    )]);
    let mut old_info = info();
    old_info.native_session = Some(AgentSessionRef {
        agent: AgentKind::Codex,
        id: "exact-history".into(),
    });
    let previous = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Exited, true)),
        reply("info", old_info),
        reply("close", ()),
    ]);
    retain(&primary, &previous);
    let sink = Arc::new(Sink::default());
    let fresh = primary
        .client
        .spawn_prepared(request(), sink.clone(), |request| {
            assert_eq!(request.resume.as_deref(), Some("exact-history"));
            Ok(())
        })
        .unwrap();
    sink.wait_exit();
    assert_eq!(fresh.id, "fresh");
    let calls = primary.commands();
    assert_eq!(calls.len(), 1);
    assert!(calls[0]["attachment"].is_null());
    assert_eq!(calls[0]["launch"]["resume"], "exact-history");
    assert!(
        previous
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|c| c["kind"] != "poll")
    );
}

#[test]
fn a_failed_upgrade_preserves_the_old_exited_session_and_scrollback() {
    let primary = Peer::new(vec![(
        "create",
        Some(Reply::failure(AppError::not_found("launch failed"))),
    )]);
    let previous = Peer::new(vec![
        reply("create", session("old", TerminalStatus::Exited, true)),
        reply("info", info()),
    ]);
    retain(&primary, &previous);
    assert!(
        primary
            .client
            .spawn_prepared(request(), Arc::new(Sink::default()), |_| Ok(()))
            .is_err()
    );
    assert!(
        previous
            .commands()
            .iter()
            .all(|call| call["kind"] != "close" && call["kind"] != "shutdown")
    );
}

#[test]
fn session_lists_and_close_tab_cover_both_daemon_generations() {
    let mut fresh_info = info();
    fresh_info.session = session("fresh", TerminalStatus::Running, false);
    let primary = Peer::new(vec![
        reply("list", vec![fresh_info]),
        reply("close_tab", ()),
    ]);
    let previous = Peer::new(vec![
        reply("list", vec![info()]),
        reply("list", vec![info()]),
        reply("ping", serde_json::json!({})),
        reply("close_tab", ()),
    ]);
    retain(&primary, &previous);
    assert_eq!(primary.client.list().unwrap().len(), 2);
    primary.client.close_tab("tab").unwrap();
    assert_eq!(primary.commands().last().unwrap()["kind"], "close_tab");
    assert_eq!(previous.commands().last().unwrap()["kind"], "close_tab");
}

#[test]
fn a_worktree_lease_locks_every_generation_and_releases_all_after_a_failed_acquisition() {
    let primary = Peer::new(vec![]);
    let previous = Peer::new(vec![]);
    let mut endpoints = [
        primary.client.endpoint.lock().unwrap().clone().unwrap(),
        previous.client.endpoint.lock().unwrap().clone().unwrap(),
    ];
    endpoints.sort_by(|a, b| a.instance.cmp(&b.instance));
    let (first, second) = if endpoints[0].instance
        == primary
            .client
            .endpoint
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .instance
    {
        (&primary, &previous)
    } else {
        (&previous, &primary)
    };
    *first.remaining.lock().unwrap() = VecDeque::from(vec![
        reply("acquire_workspace", "first-lease"),
        reply("release_workspace", ()),
        reply("acquire_workspace", "next-first-lease"),
        reply("release_workspace", ()),
    ]);
    *second.remaining.lock().unwrap() = VecDeque::from(vec![
        (
            "acquire_workspace",
            Some(Reply::failure(AppError::io("busy"))),
        ),
        reply("acquire_workspace", "second-lease"),
        reply("release_workspace", ()),
    ]);
    assert!(super::super::leases::LeaseGuard::acquire_all(endpoints.to_vec()).is_err());
    let lease = super::super::leases::LeaseGuard::acquire_all(endpoints.to_vec()).unwrap();
    drop(lease);
    assert_eq!(
        first
            .commands()
            .iter()
            .filter(|c| c["kind"] == "release_workspace")
            .count(),
        2
    );
    assert_eq!(
        second
            .commands()
            .iter()
            .filter(|c| c["kind"] == "release_workspace")
            .count(),
        1
    );
}

#[test]
fn startup_selects_the_matching_release_and_retains_discovered_old_session_routes() {
    let version = env!("CARGO_PKG_VERSION");
    let ping = serde_json::json!({"appVersion": version,
        "capabilities":["terminal_program_status_v1", "rolling_upgrade_v1"]});
    let mut fresh_info = info();
    fresh_info.session = session("fresh", TerminalStatus::Running, false);
    let primary = Peer::new(vec![
        reply("ping", ping.clone()),
        reply("ping", ping),
        reply("list", vec![fresh_info]),
    ]);
    let mut old_info = info();
    old_info.session.status = TerminalStatus::Running;
    let previous = Peer::new(vec![
        reply(
            "ping",
            serde_json::json!({"appVersion":"0.1.0", "capabilities":["rolling_upgrade_v1"]}),
        ),
        reply("retire", ()),
        reply("list", vec![old_info.clone()]),
        reply("list", vec![old_info]),
        reply("write", ()),
    ]);
    let root =
        std::env::temp_dir().join(format!("belfry-client-upgrade-{}", ulid::Ulid::generate()));
    let release = root.join("versions").join(version);
    super::super::endpoint::private_directory(&root).unwrap();
    super::super::endpoint::private_directory(&release).unwrap();
    super::super::endpoint::save(
        &root,
        previous.client.endpoint.lock().unwrap().as_ref().unwrap(),
    )
    .unwrap();
    super::super::endpoint::save(
        &release,
        primary.client.endpoint.lock().unwrap().as_ref().unwrap(),
    )
    .unwrap();
    let client = DaemonClient::new(root.clone());
    let sessions = client.list().unwrap();
    assert_eq!(sessions.len(), 2);
    client.write("old", b"old-process-input").unwrap();
    assert_eq!(
        client.session_endpoint("fresh").unwrap().instance,
        primary
            .client
            .endpoint
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .instance
    );
    assert!(previous.commands().iter().any(|c| c["kind"] == "retire"));
    assert!(
        previous
            .commands()
            .iter()
            .all(|c| c["kind"] != "shutdown" && c["kind"] != "close")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_second_view_reconnects_to_a_tab_already_migrated_by_the_first_view() {
    let mut fresh_info = info();
    fresh_info.session = session("fresh", TerminalStatus::Running, true);
    let primary = Peer::new(vec![
        reply("lookup", Some(fresh_info)),
        reply("create", session("fresh", TerminalStatus::Running, true)),
    ]);
    let previous = Peer::new(vec![(
        "create",
        Some(Reply::failure(AppError::session_missing())),
    )]);
    retain(&primary, &previous);
    let sink = Arc::new(Sink::default());
    let fresh = primary
        .client
        .spawn_prepared(request(), sink.clone(), |_| {
            panic!("must not duplicate a live tab")
        })
        .unwrap();
    assert_eq!(fresh.id, "fresh");
    assert!(fresh.reconnected);
    sink.wait_exit();
    assert_eq!(primary.commands()[1]["attachment"], "fresh");
    assert!(
        previous
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|c| c["kind"] != "poll")
    );
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
                        program_status: None,
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
