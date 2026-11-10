//! A temporary PTY consumer verifies the durable inbox against actual native input.
//! No model service, user shell configuration, or live collaboration storage is used.
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use belfry_protocol::inbox::{
    BatchRequest, BeginRequest, BindRequest, DeliveryPhase, MessageOptions, OfferRequest,
    PrepareRequest, ReceiptRequest,
};
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::{CreateTerminalRequest, TerminalEvent, TerminalRuntime};
use crate::{
    agent::AgentKind,
    collab::{SessionRegistry, TaskBoard, inbox::InboxService},
    resource::path_to_file_uri,
    rooms::{
        RoomStore,
        model::{Actor, now_millis},
        ops, semantics,
    },
};

struct Fixture {
    root: PathBuf,
    runtime: TerminalRuntime,
    events: Arc<Mutex<Vec<TerminalEvent>>>,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("belfry-inbox-native-{}", ulid::Ulid::generate()));
        fs::create_dir_all(root.join("shell")).unwrap();
        // The child records each byte without interpreting the payload as shell commands.
        fs::write(
            root.join("consumer.sh"),
            r#"set -eu
test -t 0
test -t 1
stty raw -echo
printf '\033[?2004h__INBOX_READY__'
while [ ! -s expected-size ]; do sleep 0.01; done
dd bs=1 count="$(cat expected-size)" of=payload.bin 2>/dev/null
printf '\033[6n'
dd bs=1 count=6 of=response.bin 2>/dev/null
dd bs=1 count=1 of=submit.bin 2>/dev/null
printf '__INBOX_CONSUMED__'
while [ ! -e release ]; do sleep 0.01; done
printf '\033[?2004l'
"#,
        )
        .unwrap();
        Self {
            root,
            runtime: TerminalRuntime::with_platform_backend(),
            events: Arc::default(),
        }
    }

    fn launch(&self) -> String {
        let mut request: CreateTerminalRequest = serde_json::from_value(json!({
            "platform": "macos", "profileId": "shell:zsh", "tabId": "native-worker",
            "cwd": path_to_file_uri(&self.root), "cols": 100, "rows": 30, "elevation": "normal"
        }))
        .unwrap();
        request.launch_overlay.arguments = vec![
            "-f".into(),
            "-c".into(),
            "exec /bin/bash --noprofile --norc \"$1\"".into(),
            "inbox-native-qa".into(),
            self.root.join("consumer.sh").to_string_lossy().into_owned(),
        ];
        request.launch_overlay.unset = std::env::vars_os()
            .filter_map(|(key, _)| key.into_string().ok())
            .filter(|key| key.starts_with("BELFRY_") || key == "ENV" || key == "BASH_ENV")
            .collect();
        request.launch_overlay.environment.insert(
            "ZDOTDIR".into(),
            self.root.join("shell").to_string_lossy().into_owned(),
        );
        let events = self.events.clone();
        let channel = Channel::new(move |body| {
            let event = match body {
                InvokeResponseBody::Json(text) => serde_json::from_str(&text).unwrap(),
                InvokeResponseBody::Raw(bytes) => serde_json::from_slice(&bytes).unwrap(),
            };
            events.lock().unwrap().push(event);
            Ok(())
        });
        self.runtime
            .create(request, channel, |_| Ok(()), |_| {})
            .unwrap()
            .id
    }

    fn output_contains(&self, marker: &[u8]) -> bool {
        let bytes: Vec<_> = self
            .events
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                TerminalEvent::Output { bytes, .. } => Some(bytes.as_slice()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect();
        bytes.windows(marker.len()).any(|window| window == marker)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::write(self.root.join("release"), "");
        let _ = self.runtime.prepare_exit(true);
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn wait_for(label: &str, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !ready() {
        assert!(Instant::now() < deadline, "timed out waiting for {label}");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn durable_inbox_submits_one_exact_payload_through_the_native_runtime() {
    let _native = super::native_tests::lock_native_test();
    let fixture = Fixture::new();
    let rooms = Arc::new(RoomStore::load(Some(fixture.root.join("rooms"))));
    let room = rooms
        .create(
            "Native inbox",
            fixture.root.to_str().unwrap(),
            "Temporary verification",
        )
        .unwrap();
    let at = now_millis() - 20_000;
    let (_, room) = rooms
        .mutate(&room.id, |room| {
            ops::add_member(
                room,
                "native-lead",
                "codex",
                "lead",
                "coordinate",
                false,
                at,
            )?;
            ops::add_member(
                room,
                "native-worker",
                "codex",
                "worker",
                "implement",
                false,
                at,
            )?;
            let notices: Vec<_> = room
                .all_messages()
                .flat_map(|message| {
                    message
                        .to
                        .iter()
                        .map(move |member| (message.id.clone(), member.clone()))
                })
                .collect();
            for (message, member) in notices {
                ops::record_delivery(room, &message, &member, at);
            }
            room.delivery_outbox.clear();
            Ok(())
        })
        .unwrap();
    let member = room.member_by_tab("native-worker").unwrap();
    rooms
        .set_member_model(
            &room.id,
            &member.id,
            &member.tab_id,
            "codex",
            None,
            Some("native-role-model"),
        )
        .unwrap();
    let (originals, _) = rooms
        .mutate_as_member("native-lead", Some(&room.name), |room, sender| {
            let mut originals = Vec::new();
            for text in ["分页从 1 开始。", "保留原有字段名，并说明 total 的含义。"]
            {
                let posted = semantics::say(
                    room,
                    &Actor::Member(sender),
                    &["worker".into()],
                    text,
                    None,
                    false,
                    &MessageOptions {
                        topic_id: Some("pagination".into()),
                        ..Default::default()
                    },
                    at + 1_000,
                )?;
                originals.extend(posted.into_iter().map(|post| post.message_id));
            }
            Ok(originals)
        })
        .unwrap();
    let registry = Arc::new(SessionRegistry::default());
    registry.replace(serde_json::from_value(json!([
        { "tabId": "native-lead", "name": "lead", "title": "lead", "agent": "codex", "activity": "idle", "canReceive": true, "projectRoot": room.project_root },
        { "tabId": "native-worker", "name": "worker", "title": "worker", "agent": "codex", "activity": "idle", "canReceive": true, "projectRoot": room.project_root }
    ])).unwrap());
    let board = Arc::new(TaskBoard::load(Some(fixture.root.join("collab"))));
    let service = InboxService::load(
        Some(fixture.root.join("inbox")),
        rooms.clone(),
        board,
        registry,
        fixture.runtime.input_gate.clone(),
    );
    service
        .activate("native-test-activation".into(), true)
        .unwrap();
    let session = fixture.launch();
    wait_for("native bracketed paste mode", || {
        fixture.output_contains(b"__INBOX_READY__")
            && fixture.runtime.input_gate.ready_tab("native-worker")
    });
    let sessions = service
        .sessions(&room.project_root, Some(&room.id))
        .unwrap();
    let recipient = sessions
        .sessions
        .iter()
        .find(|session| session.tab_id == "native-worker")
        .unwrap();
    assert_eq!(recipient.pending_count, 2);
    let binding = service
        .bind(&BindRequest {
            tab_id: "native-worker".into(),
            terminal_session_id: session.clone(),
            owner_id: "native-test".into(),
        })
        .unwrap();
    let offer = service
        .offer(&OfferRequest {
            binding,
            offer_id: "native-input-slot".into(),
            running: true,
            idle: true,
            composer_empty: true,
            awaiting_input: false,
            prompt_queue_empty: true,
        })
        .unwrap();
    let batch = service
        .prepare(&PrepareRequest {
            session_key: recipient.session_key.clone(),
            offer: offer.clone(),
            operation_id: "native-batch".into(),
        })
        .unwrap()
        .batch
        .unwrap();
    assert_eq!(batch.entry_ids.len(), 2);
    assert!(originals.iter().all(|id| batch.message_ids.contains(id)));
    let begin = service
        .begin(&BeginRequest {
            batch: BatchRequest {
                batch_id: batch.id.clone(),
                attempt_id: batch.attempt_id.clone(),
                expected_revision: batch.revision,
            },
            offer,
        })
        .unwrap();
    let frame = format!("\x1b[200~{}\x1b[201~", batch.payload.replace('\n', "\r")).into_bytes();
    fs::write(fixture.root.join("expected-size"), frame.len().to_string()).unwrap();
    // Wrong content must not reach the child; duplicate sequences must not be sent twice.
    assert!(
        fixture
            .runtime
            .write_inbox(&session, b"wrong payload", &begin.write_guard, 1)
            .is_err()
    );
    let midpoint = frame.len() / 2;
    fixture
        .runtime
        .write_inbox(&session, &frame[..midpoint], &begin.write_guard, 1)
        .unwrap();
    fixture
        .runtime
        .write_inbox(&session, &frame[..midpoint], &begin.write_guard, 1)
        .unwrap();
    fixture
        .runtime
        .write_inbox(&session, &frame[midpoint..], &begin.write_guard, 2)
        .unwrap();
    wait_for("consumer cursor query", || {
        fixture.output_contains(b"\x1b[6n")
    });
    // This ordinary terminal write is an actual queried protocol response, not user input.
    fixture.runtime.write(&session, b"\x1b[1;1R").unwrap();
    fixture
        .runtime
        .write_inbox(&session, b"\r", &begin.write_guard, 3)
        .unwrap();
    wait_for("consumer payload and submit key", || {
        fixture.output_contains(b"__INBOX_CONSUMED__")
    });
    assert_eq!(fs::read(fixture.root.join("payload.bin")).unwrap(), frame);
    assert_eq!(
        fs::read(fixture.root.join("response.bin")).unwrap(),
        b"\x1b[1;1R"
    );
    assert_eq!(fs::read(fixture.root.join("submit.bin")).unwrap(), b"\r");
    let receipt = ReceiptRequest {
        batch_id: batch.id.clone(),
        attempt_id: batch.attempt_id.clone(),
        sequence: begin.batch.sequence + 1,
        phase: "submitted".into(),
        payload_hash: batch.payload_hash,
        message: None,
    };
    assert_eq!(service.receipt(&receipt).unwrap().phase, "submitted");
    assert_eq!(service.receipt(&receipt).unwrap().phase, "submitted");
    service.sync().unwrap();
    let messages = service
        .messages(&recipient.session_key, Some(&room.id), None, Some(50), None)
        .unwrap()
        .messages;
    let delivered: Vec<_> = messages
        .iter()
        .filter(|message| originals.contains(&message.message_id))
        .collect();
    assert_eq!(delivered.len(), originals.len());
    assert!(delivered.iter().all(|message| {
        message.delivery_phase == DeliveryPhase::Submitted
            && message.handling_status.code == "unknown_handling"
    }));
    let restored = RoomStore::load(Some(fixture.root.join("rooms")));
    assert_eq!(
        restored
            .model_override_for("native-worker", &room.project_root, AgentKind::Codex)
            .unwrap()
            .as_deref(),
        Some("native-role-model")
    );
    assert!(
        fixture
            .runtime
            .write_inbox(&session, &frame, &begin.write_guard, 4)
            .is_err()
    );
    fs::write(fixture.root.join("release"), "").unwrap();
    wait_for("consumer exit", || {
        fixture
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|event| matches!(event, TerminalEvent::Exit { exit_code: 0, .. }))
    });
}
