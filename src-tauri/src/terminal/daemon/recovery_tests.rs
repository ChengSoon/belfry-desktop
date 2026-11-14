use super::*;
use crate::agent::{AgentKind, AgentSessionRef};
use crate::terminal::{
    TerminalEvent,
    backend::{StubBackend, TerminalEventSink},
    contracts::{AppErrorCode, TerminalExitReason, TerminalPalette},
};

#[derive(Default)]
struct RecordingBackend {
    inner: StubBackend,
    requests: Mutex<Vec<CreateTerminalRequest>>,
    sinks: Mutex<HashMap<String, Arc<dyn TerminalEventSink>>>,
    fail_next: AtomicBool,
    exit_on_spawn: AtomicBool,
    exit_on_resize: AtomicBool,
}

impl PtyBackend for RecordingBackend {
    fn spawn(
        &self,
        request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalSession, AppError> {
        self.requests.lock().unwrap().push(request.clone());
        if self.fail_next.swap(false, Ordering::AcqRel) {
            return Err(AppError::not_found("test executable unavailable"));
        }
        let session = self.inner.spawn(request, sink.clone())?;
        self.sinks
            .lock()
            .unwrap()
            .insert(session.id.clone(), sink.clone());
        if self.exit_on_spawn.load(Ordering::Acquire) {
            sink.send(exited(&session.id))?;
        }
        Ok(session)
    }
    fn write(&self, _id: &str, _bytes: &[u8]) -> Result<(), AppError> {
        panic!("recovery must never replay input")
    }
    fn resize(&self, id: &str, size: TerminalSize) -> Result<(), AppError> {
        if self.exit_on_resize.swap(false, Ordering::AcqRel) {
            self.sinks.lock().unwrap()[id].send(exited(id))?;
            return Err(AppError::process_exited());
        }
        self.inner.resize(id, size)
    }
    fn set_palette(&self, id: &str, palette: &TerminalPalette) -> Result<(), AppError> {
        self.inner.set_palette(id, palette)
    }
    fn close(&self, id: &str) -> Result<(), AppError> {
        self.inner.close(id)
    }
    fn close_all(&self) {
        self.inner.close_all();
    }
}

fn exited(id: &str) -> TerminalEvent {
    TerminalEvent::Exit {
        session_id: id.into(),
        exit_code: 9,
        reason: TerminalExitReason::Normal,
    }
}

fn hook(id: &str, session: AgentSessionRef) -> TerminalEvent {
    TerminalEvent::AgentState {
        session_id: id.into(),
        snapshot: crate::agent::hooks::HookSnapshot {
            sequence: 2,
            agent: session.agent,
            session: Some(session),
            state: serde_json::from_value(serde_json::json!("processing")).unwrap(),
            source: serde_json::from_value(serde_json::json!("hook")).unwrap(),
            occurred_at: 1,
            reason: "test hook".into(),
            transcript_path: None,
            program_status: None,
        },
    }
}

struct Fixture {
    service: Arc<Service>,
    backend: Arc<RecordingBackend>,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-recovery-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&root).unwrap();
        let backend = Arc::new(RecordingBackend::default());
        let mut service = Service::new(root.clone()).unwrap();
        Arc::get_mut(&mut service).unwrap().backend = backend.clone();
        Self {
            service,
            backend,
            root,
        }
    }
    fn request(&self) -> CreateTerminalRequest {
        serde_json::from_value(serde_json::json!({
            "platform":"macos", "profileId":"agent:codex", "tabId":"recovery-tab",
            "cwd":crate::resource::path_to_file_uri(&self.root), "cols":80, "rows":24,
            "elevation":"normal", "env":{"BELFRY_CODEX_NATIVE":"1"}
        }))
        .unwrap()
    }
    fn create(&self) -> TerminalSession {
        self.service
            .create(self.request(), WireOverlay::default(), None)
            .unwrap()
    }
    fn end(&self, id: &str) {
        self.service.slot(id).unwrap().push(exited(id));
    }
    fn recover(
        &self,
        old: &TerminalSession,
        mut request: CreateTerminalRequest,
    ) -> Result<TerminalSession, AppError> {
        request.launch_overlay.recover_exited = true;
        self.service
            .create(request, WireOverlay::default(), Some(old.id.clone()))
    }
    fn spawn_count(&self) -> usize {
        self.backend.requests.lock().unwrap().len()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.service.shutdown();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn ordinary_wire_create_replays_exited_but_explicit_recovery_replaces_it_once() {
    let fixture = Fixture::new();
    let old = fixture.create();
    fixture.end(&old.id);
    let command: Command = serde_json::from_value(serde_json::json!({
        "kind":"create", "launch":fixture.request(), "attachment":old.id,
        "overlay":{"arguments":[],"environment":{},"unset":[],"files":[]}
    }))
    .unwrap();
    let replay: TerminalSession =
        serde_json::from_value(fixture.service.handle(command).result.unwrap()).unwrap();
    assert_eq!(old.id, replay.id);
    assert!(replay.reconnected);
    assert_eq!(TerminalStatus::Exited, replay.status);
    assert_eq!(1, fixture.spawn_count());

    let fresh = fixture.recover(&old, fixture.request()).unwrap();
    assert_ne!(old.id, fresh.id);
    assert!(!fresh.reconnected);
    assert_eq!(TerminalStatus::Running, fresh.status);
    assert_eq!(2, fixture.spawn_count());
    let duplicate = fixture.recover(&old, fixture.request()).unwrap();
    assert_eq!(fresh.id, duplicate.id);
    assert!(duplicate.reconnected);
    assert_eq!(2, fixture.spawn_count());
    assert_eq!(1, fixture.service.list().len());
}

#[test]
fn recovery_keeps_live_pty_and_validates_every_target_before_retiring_exited() {
    let fixture = Fixture::new();
    let old = fixture.create();
    assert_eq!(old.id, fixture.recover(&old, fixture.request()).unwrap().id);
    fixture.end(&old.id);
    for change in 0..4 {
        let mut request = fixture.request();
        match change {
            0 => request.tab_id = Some("other-tab".into()),
            1 => request.profile_id = "agent:claude".into(),
            2 => request.cwd = Some("file:///other-project".into()),
            _ => request.collaboration_mode = true,
        }
        assert_eq!(
            "TERMINAL_THE_BACKGROUND_TASK_PROJECT_OR_TYPE_CHANGED",
            fixture.recover(&old, request).unwrap_err().code.0
        );
        assert!(!fixture.service.slot(&old.id).unwrap().is_closed());
        assert_eq!(1, fixture.spawn_count());
    }
}

#[test]
fn recovery_preserves_saved_resume_without_native_identity_and_uses_latest_matching_identity() {
    let fixture = Fixture::new();
    let old = fixture.create();
    fixture.end(&old.id);
    let mut saved = fixture.request();
    saved.resume = Some("saved-native".into());
    let fresh = fixture.recover(&old, saved).unwrap();
    assert_eq!(
        Some("saved-native"),
        fixture.backend.requests.lock().unwrap()[1]
            .resume
            .as_deref()
    );
    let native = AgentSessionRef {
        agent: AgentKind::Codex,
        id: "latest-native".into(),
    };
    fixture
        .service
        .slot(&fresh.id)
        .unwrap()
        .push(hook(&fresh.id, native.clone()));
    fixture.end(&fresh.id);
    let mut stale = fixture.request();
    stale.resume = Some("stale-native".into());
    let latest = fixture.recover(&fresh, stale).unwrap();
    assert_eq!(
        Some("latest-native"),
        fixture.backend.requests.lock().unwrap()[2]
            .resume
            .as_deref()
    );
    assert_eq!(
        Some(native),
        fixture
            .service
            .slot(&latest.id)
            .unwrap()
            .info()
            .native_session
    );
}

#[test]
fn identity_binding_rejects_the_wrong_agent_and_replays_the_valid_identity() {
    let fixture = Fixture::new();
    let session = fixture.create();
    let invalid = fixture.service.handle(Command::BindIdentity {
        id: session.id.clone(),
        session: AgentSessionRef {
            agent: AgentKind::Claude,
            id: "wrong-kind".into(),
        },
    });
    assert_eq!("TERMINAL_THE_NATIVE_SESSION_IDENTITY_DOES_NOT_MATCH", invalid.failure.unwrap().code.0);
    assert!(
        fixture
            .service
            .slot(&session.id)
            .unwrap()
            .info()
            .native_session
            .is_none()
    );
    let identity = AgentSessionRef {
        agent: AgentKind::Codex,
        id: "native-from-plugin".into(),
    };
    assert!(
        fixture
            .service
            .handle(Command::BindIdentity {
                id: session.id.clone(),
                session: identity.clone()
            })
            .error
            .is_none()
    );
    let slot = fixture.service.slot(&session.id).unwrap();
    assert_eq!(Some(identity.clone()), slot.info().native_session);
    assert!(
        slot.poll(&session.id, 0)
            .unwrap()
            .frames
            .iter()
            .any(|frame| matches!(&frame.event,
        TerminalEvent::SessionIdentity { session: value, .. } if value == &identity))
    );
    let newer = AgentSessionRef {
        agent: AgentKind::Codex,
        id: "newer-hook-session".into(),
    };
    slot.push(hook(&session.id, newer.clone()));
    let late = fixture.service.handle(Command::BindIdentity {
        id: session.id.clone(),
        session: identity,
    });
    assert!(late.error.is_some());
    slot.announce_hook(&session.id);
    assert_eq!(Some(newer), slot.info().native_session);
}

#[test]
fn a_replacement_that_exits_during_spawn_is_returned_without_another_spawn() {
    let fixture = Fixture::new();
    let old = fixture.create();
    fixture.end(&old.id);
    fixture.backend.exit_on_spawn.store(true, Ordering::Release);
    let fresh = fixture.recover(&old, fixture.request()).unwrap();
    assert_ne!(old.id, fresh.id);
    assert_eq!(TerminalStatus::Exited, fresh.status);
    assert!(!fresh.reconnected);
    assert_eq!(2, fixture.spawn_count());
}

#[test]
fn failed_replacement_keeps_the_old_record_available_for_replay() {
    let fixture = Fixture::new();
    let old = fixture.create();
    fixture.end(&old.id);
    fixture.backend.fail_next.store(true, Ordering::Release);
    assert_eq!(
        AppErrorCode::NotFound,
        fixture.recover(&old, fixture.request()).unwrap_err().code
    );
    let slot = fixture.service.slot(&old.id).unwrap();
    assert!(!slot.is_closed());
    assert_eq!(TerminalStatus::Exited, slot.info().session.status);
    assert_eq!(old.id, fixture.service.list()[0].session.id);
}

#[test]
fn reattachment_replays_terminal_protocol_independently_of_a_later_hook() {
    use crate::agent::{AgentLifecycleState, AgentStateSource};
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.profile_id = "agent:claude".into();
    let session = fixture.service.create(request, WireOverlay::default(), None).unwrap();
    let slot = fixture.service.slot(&session.id).unwrap();
    slot.push(TerminalEvent::AgentState { session_id: session.id.clone(), snapshot: crate::agent::hooks::HookSnapshot {
        sequence: 3, agent: AgentKind::Claude, session: None, state: AgentLifecycleState::AwaitingInput,
        source: AgentStateSource::TerminalProtocol, occurred_at: 0, reason: String::new(), transcript_path: None,
        program_status: Some(crate::agent::TerminalProgramStatus { state: crate::agent::ProgramState::Blocked,
            kind: Some(crate::agent::ProgramBlockKind::Permission), progress: Some(42), title: None, message: None }),
    } });
    slot.push(hook(&session.id, AgentSessionRef { agent: AgentKind::Claude, id: "native-claude".into() }));
    let cursor = slot.poll(&session.id, 0).unwrap().cursor;
    slot.announce_hook(&session.id);
    let replay = slot.poll(&session.id, cursor).unwrap();
    let states: Vec<_> = replay.frames.iter().filter_map(|frame| match &frame.event {
        TerminalEvent::AgentState { snapshot, .. } => Some(snapshot),
        _ => None,
    }).collect();
    assert_eq!(states.len(), 2);
    assert_eq!(states[0].source, AgentStateSource::Hook);
    assert_eq!(states[1].source, AgentStateSource::TerminalProtocol);
    assert_eq!(states[1].state, AgentLifecycleState::AwaitingInput);
    assert_eq!(states[1].sequence, 3);
    let status = states[1].program_status.as_ref().unwrap();
    assert_eq!(status.state, crate::agent::ProgramState::Blocked);
    assert_eq!(status.kind, Some(crate::agent::ProgramBlockKind::Permission));
    assert_eq!(status.progress, Some(42));
    assert_eq!(slot.info().native_session.unwrap().id, "native-claude");
}

#[test]
fn an_exit_during_resize_can_be_recovered_and_a_workspace_lease_does_not_retire_it() {
    let fixture = Fixture::new();
    let old = fixture.create();
    fixture
        .backend
        .exit_on_resize
        .store(true, Ordering::Release);
    let token: String = serde_json::from_value(
        fixture
            .service
            .handle(Command::AcquireWorkspace)
            .result
            .unwrap(),
    )
    .unwrap();
    assert!(fixture.recover(&old, fixture.request()).is_err());
    assert!(!fixture.service.slot(&old.id).unwrap().is_closed());
    fixture.service.handle(Command::ReleaseWorkspace { token });
    let fresh = fixture.recover(&old, fixture.request()).unwrap();
    assert_ne!(old.id, fresh.id);
    assert_eq!(2, fixture.spawn_count());
}
