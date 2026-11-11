use super::*;
use crate::collab::registry::SessionSnapshot;
use crate::rooms::{
    model::{Actor as RoomActor, MemberRole},
    ops,
};
use std::{collections::BTreeMap, fs};

struct Rig {
    root: PathBuf,
    service: Arc<InboxService>,
    room_id: String,
    sender: String,
    worker: String,
}
impl Rig {
    fn new() -> Self {
        Self::setup(true)
    }
    fn setup(active: bool) -> Self {
        let root = std::env::temp_dir().join(format!("belfry-inbox-test-{}", new_id()));
        fs::create_dir_all(&root).unwrap();
        let rooms = Arc::new(RoomStore::load(Some(root.join("rooms"))));
        let room = rooms.create("Inbox test", root.to_str().unwrap(), "Test durable inbox").unwrap();
        let (_, room) = rooms
            .mutate(&room.id, |room| {
                ops::add_member(room, "a", "codex", "lead", "coordinate", false, now() - 20_000)?;
                ops::add_member(room, "b", "codex", "worker", "implement", false, now() - 20_000)?;
                let delivered: Vec<_> = room
                    .all_messages()
                    .flat_map(|message| message.to.iter().map(move |member| (message.id.clone(), member.clone())))
                    .collect();
                for (message, member) in delivered {
                    ops::record_delivery(room, &message, &member, now() - 20_000);
                }
                room.delivery_outbox.clear();
                Ok(())
            })
            .unwrap();
        let sender = room.member_by_tab("a").unwrap().id.clone();
        let worker = room.member_by_tab("b").unwrap().id.clone();
        let board = Arc::new(TaskBoard::load(Some(root.join("collab"))));
        let registry = Arc::new(SessionRegistry::default());
        registry.replace(
            ["a", "b"]
                .iter()
                .map(|tab| SessionSnapshot {
                    tab_id: (*tab).into(),
                    name: Some(if *tab == "a" { "lead" } else { "worker" }.into()),
                    title: "test".into(),
                    agent: "codex".into(),
                    activity: "idle".into(),
                    can_receive: true,
                    project_root: Some(root.to_str().unwrap().into()),
                })
                .collect(),
        );
        let gate = Arc::new(InputGate::default());
        gate.register("pty-b", Some("b".into()), root.clone());
        gate.register("pty-a", Some("a".into()), root.clone());
        gate.observe_output("pty-a", 1, b"\x1b[?2004h");
        gate.observe_output("pty-b", 1, b"\x1b[?2004h");
        let service = Arc::new(InboxService::load(Some(root.join("inbox")), rooms, board, registry, gate));
        if active {
            service.activate("activate".into(), true).unwrap();
        }
        Self { root, service, room_id: room.id, sender, worker }
    }
    fn post(&self, text: &str, topic: &str) -> String {
        self.say("a", "worker", text, MessageOptions { topic_id: Some(topic.into()), ..Default::default() }, None)[0]
            .clone()
    }
    fn say(&self, tab: &str, to: &str, text: &str, options: MessageOptions, reply: Option<&str>) -> Vec<String> {
        let (posts, _) = self
            .service
            .rooms
            .mutate(&self.room_id, |room| {
                let member = room.member_by_tab(tab).unwrap().clone();
                crate::rooms::semantics::say(
                    room,
                    &RoomActor::Member(&member),
                    &[to.into()],
                    text,
                    reply,
                    false,
                    &options,
                    now() - 10_000,
                )
            })
            .unwrap();
        posts.into_iter().map(|post| post.message_id).collect()
    }
    fn key(&self, tab: &str) -> String {
        source::session_key(self.root.to_str().unwrap(), tab)
    }
    fn offer(&self, tab: &str) -> Offer {
        let binding = self
            .service
            .bind(&BindRequest { tab_id: tab.into(), terminal_session_id: format!("pty-{tab}"), owner_id: "ui".into() })
            .unwrap();
        self.service
            .offer(&OfferRequest {
                binding,
                offer_id: new_id(),
                running: true,
                idle: true,
                composer_empty: true,
                awaiting_input: false,
                prompt_queue_empty: true,
            })
            .unwrap()
    }
    fn prepare(&self, tab: &str) -> (Offer, BatchView) {
        let offer = self.offer(tab);
        let result = self
            .service
            .prepare(&PrepareRequest { session_key: self.key(tab), offer: offer.clone(), operation_id: new_id() })
            .unwrap();
        assert!(result.batch.is_some(), "blocked: {:?}", result.blocker);
        (offer, result.batch.unwrap())
    }
    fn begin(&self, offer: Offer, batch: &BatchView) -> BeginResult {
        self.service
            .begin(&BeginRequest {
                batch: BatchRequest {
                    batch_id: batch.id.clone(),
                    attempt_id: batch.attempt_id.clone(),
                    expected_revision: batch.revision,
                },
                offer,
            })
            .unwrap()
    }
    fn submit(&self, tab: &str) -> BatchView {
        let (offer, batch) = self.prepare(tab);
        let begin = self.begin(offer, &batch);
        self.finish(&begin)
    }
    fn finish(&self, begin: &BeginResult) -> BatchView {
        let session = &begin.batch.terminal_session_id;
        self.service
            .gate
            .guarded_write(
                session,
                &begin.write_guard,
                1,
                format!("\x1b[200~{}\x1b[201~", begin.batch.payload).as_bytes(),
                || Ok(()),
            )
            .unwrap();
        self.service.gate.guarded_write(session, &begin.write_guard, 2, b"\r", || Ok(())).unwrap();
        self.service
            .receipt(&ReceiptRequest {
                batch_id: begin.batch.id.clone(),
                attempt_id: begin.batch.attempt_id.clone(),
                sequence: begin.batch.sequence + 1,
                phase: "submitted".into(),
                payload_hash: begin.batch.payload_hash.clone(),
                message: None,
            })
            .unwrap()
    }
    fn messages(&self, tab: &str) -> Vec<MessageView> {
        self.service.messages(&self.key(tab), Some(&self.room_id), None, Some(50), None).unwrap().messages
    }
    fn task(&self, title: &str) -> String {
        self.service
            .rooms
            .mutate(&self.room_id, |room| {
                let member = room.member_by_tab("a").unwrap().clone();
                ops::task_add(room, &RoomActor::Member(&member), title, None, Some("worker"), &[], now() - 10_000)
            })
            .unwrap()
            .0
            .0
    }
}
impl Drop for Rig {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn busy_arrivals_are_durable_and_only_freeze_at_an_input_opportunity() {
    let rig = Rig::new();
    let mut sessions = rig.service.registry.all();
    let worker = sessions.iter_mut().find(|s| s.tab_id == "b").unwrap();
    worker.activity = "working".into();
    worker.can_receive = false;
    rig.service.registry.replace(sessions);
    let ids: Vec<_> = ["one", "two", "three"].iter().map(|text| rig.post(text, "api")).collect();
    rig.service.sync().unwrap();
    assert!(rig.service.store.snapshot().unwrap().batches.is_empty());
    let waiting = rig.messages("b");
    assert_eq!(waiting.iter().filter(|m| ids.contains(&m.message_id)).count(), 3);
    assert!(
        waiting
            .iter()
            .filter(|m| ids.contains(&m.message_id))
            .all(|m| m.waiting_reason.as_ref().unwrap().code == "turn_busy")
    );
    let paths =
        [rig.root.join("rooms/rooms.json"), rig.root.join("collab/tasks.json"), rig.root.join("inbox/inbox.json")];
    let before: Vec<_> = paths.iter().map(|p| fs::read(p).unwrap()).collect();
    for _ in 0..3 {
        rig.messages("b");
        rig.service.sessions(rig.root.to_str().unwrap(), None).unwrap();
        rig.service.pending().unwrap();
    }
    assert_eq!(before, paths.iter().map(|p| fs::read(p).unwrap()).collect::<Vec<_>>());
    let mut sessions = rig.service.registry.all();
    let worker = sessions.iter_mut().find(|s| s.tab_id == "b").unwrap();
    worker.activity = "idle".into();
    worker.can_receive = true;
    rig.service.registry.replace(sessions);
    let (offer, batch) = rig.prepare("b");
    assert_eq!(batch.entry_ids.len(), 3);
    let later = rig.post("four", "api");
    rig.service.sync().unwrap();
    let frozen = rig.service.batch(&batch.id).unwrap();
    assert_eq!(batch.payload, frozen.payload);
    assert_eq!(batch.payload_hash, frozen.payload_hash);
    assert!(!frozen.message_ids.contains(&later));
    let begin = rig.begin(offer, &frozen);
    rig.finish(&begin);
    assert_eq!(rig.submit("b").message_ids, vec![later]);
}

#[test]
fn source_lag_is_visible_and_reads_do_not_import_or_claim() {
    let rig = Rig::new();
    let id = rig.post("saved in source", "api");
    let before = fs::read(rig.root.join("inbox/inbox.json")).unwrap();
    let entry = rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap();
    assert_eq!(entry.waiting_reason.unwrap().code, "source_sync_pending");
    assert_eq!(before, fs::read(rig.root.join("inbox/inbox.json")).unwrap());
    rig.service.sync().unwrap();
    assert_eq!(rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap().id, entry.id);
}

#[test]
fn only_explicit_answers_close_questions_and_submitted_does_not_mean_processed() {
    let rig = Rig::new();
    let id = rig.say(
        "a",
        "worker",
        "two questions",
        MessageOptions {
            topic_id: Some("api".into()),
            questions: vec!["schema?".into(), "error codes?".into()],
            operation_id: Some("ask".into()),
            ..Default::default()
        },
        None,
    )[0]
    .clone();
    assert_eq!(
        rig.service
            .sessions(rig.root.to_str().unwrap(), Some(&rig.room_id))
            .unwrap()
            .sessions
            .iter()
            .find(|s| s.tab_id == "b")
            .unwrap()
            .awaiting_reply_count,
        0
    );
    rig.submit("b");
    let entry = rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap();
    assert_eq!(entry.handling_status.code, "unknown_handling");
    rig.say("b", "lead", "reference only", MessageOptions::default(), Some(&id));
    assert!(
        rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap().questions.iter().all(|q| q.state == "open")
    );
    rig.say(
        "b",
        "lead",
        "schema answer",
        MessageOptions {
            answers: vec![entry.questions[0].id.clone()],
            operation_id: Some("answer-one".into()),
            ..Default::default()
        },
        Some(&id),
    );
    let partial = rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap();
    assert_eq!(partial.questions.iter().map(|q| q.state.as_str()).collect::<Vec<_>>(), vec!["replied", "open"]);
    let reloaded = RoomStore::load(Some(rig.root.join("rooms"))).get(&rig.room_id).unwrap();
    assert!(reloaded.message(&id).unwrap().awaiting().contains(&rig.worker));
    assert!(!reloaded.message(&id).unwrap().replied_by.contains(&rig.worker));
    assert_eq!(
        rig.service
            .sessions(rig.root.to_str().unwrap(), Some(&rig.room_id))
            .unwrap()
            .sessions
            .iter()
            .find(|s| s.tab_id == "b")
            .unwrap()
            .awaiting_reply_count,
        1
    );
}

#[test]
fn task_delivery_slot_requires_formal_completion_but_discussion_passes() {
    let rig = Rig::new();
    let first = rig.task("first task");
    let second = rig.task("second task");
    let batch = rig.submit("b");
    assert_eq!(batch.entry_ids.len(), 1);
    let offer = rig.offer("b");
    let blocked =
        rig.service.prepare(&PrepareRequest { session_key: rig.key("b"), offer, operation_id: new_id() }).unwrap();
    assert_eq!(blocked.blocker.unwrap().code, "previous_task");
    let discussion = rig.post("need an API decision", "work-discussion");
    assert_eq!(rig.submit("b").message_ids, vec![discussion]);
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("b").unwrap().clone();
            ops::task_note(room, &RoomActor::Member(&member), &first, "progress", now())
        })
        .unwrap();
    assert_eq!(
        rig.service.rooms.get(&rig.room_id).unwrap().tasks.iter().find(|task| task.id == first).unwrap().generation,
        1
    );
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("b").unwrap().clone();
            ops::task_done(room, &RoomActor::Member(&member), &first, Some("done"), now())
        })
        .unwrap();
    let next = rig.submit("b");
    assert!(next.payload.contains(&second));
}

#[test]
fn input_race_aborts_without_resetting_age_and_no_intent_cannot_report_submitted() {
    let rig = Rig::new();
    rig.post("message", "api");
    let (offer, prepared) = rig.prepare("b");
    let before = rig.service.store.snapshot().unwrap().entries[&prepared.entry_ids[0]].received_at;
    rig.service.gate.user_write("pty-b", b"human", || Ok(())).unwrap();
    assert!(
        rig.service
            .begin(&BeginRequest {
                batch: BatchRequest {
                    batch_id: prepared.id.clone(),
                    attempt_id: prepared.attempt_id.clone(),
                    expected_revision: prepared.revision
                },
                offer
            })
            .is_err()
    );
    assert_eq!(rig.service.batch(&prepared.id).unwrap().phase, "aborted");
    assert_eq!(rig.service.store.snapshot().unwrap().entries[&prepared.entry_ids[0]].received_at, before);
    assert!(
        rig.service
            .receipt(&ReceiptRequest {
                batch_id: prepared.id,
                attempt_id: prepared.attempt_id,
                sequence: 1,
                phase: "submitted".into(),
                payload_hash: prepared.payload_hash,
                message: None
            })
            .is_err()
    );
}

#[test]
fn failed_persistence_never_grants_a_write_guard_and_receipts_are_idempotent() {
    let rig = Rig::new();
    rig.post("message", "api");
    let (offer, prepared) = rig.prepare("b");
    store::FAIL_WRITE.set(true);
    assert!(
        rig.service
            .begin(&BeginRequest {
                batch: BatchRequest {
                    batch_id: prepared.id.clone(),
                    attempt_id: prepared.attempt_id.clone(),
                    expected_revision: prepared.revision
                },
                offer: offer.clone()
            })
            .is_err()
    );
    assert_eq!(rig.service.batch(&prepared.id).unwrap().phase, "prepared");
    let begin = rig.begin(offer, &prepared);
    assert!(
        rig.service
            .receipt(&ReceiptRequest {
                batch_id: prepared.id.clone(),
                attempt_id: prepared.attempt_id.clone(),
                sequence: begin.batch.sequence + 1,
                phase: "submitted".into(),
                payload_hash: prepared.payload_hash.clone(),
                message: None
            })
            .is_err()
    );
    let final_batch = rig.finish(&begin);
    let receipt = ReceiptRequest {
        batch_id: final_batch.id.clone(),
        attempt_id: final_batch.attempt_id.clone(),
        sequence: final_batch.sequence,
        phase: "submitted".into(),
        payload_hash: final_batch.payload_hash.clone(),
        message: None,
    };
    assert_eq!(rig.service.receipt(&receipt).unwrap().revision, final_batch.revision);
    let mut mismatch = receipt;
    mismatch.phase = "uncertain".into();
    assert!(rig.service.receipt(&mismatch).is_err());
}

#[test]
fn restart_keeps_uncertain_batch_and_blocks_later_delivery_across_rooms() {
    let rig = Rig::new();
    rig.post("first", "api");
    let (offer, prepared) = rig.prepare("b");
    rig.begin(offer, &prepared);
    let restored = InboxService::load(
        Some(rig.root.join("inbox")),
        rig.service.rooms.clone(),
        rig.service.board.clone(),
        rig.service.registry.clone(),
        rig.service.gate.clone(),
    );
    let uncertain = restored.batch(&prepared.id).unwrap();
    assert_eq!(uncertain.phase, "uncertain");
    rig.post("later", "other-topic");
    restored.sync().unwrap();
    let data = restored.store.snapshot().unwrap();
    let (_, sources, _) = restored.read_context().unwrap();
    let mut candidate = data.clone();
    let offered = Offer {
        binding: Binding {
            tab_id: "b".into(),
            terminal_session_id: "pty-b".into(),
            owner_id: "ui".into(),
            target_epoch: "new".into(),
            input_revision: 0,
        },
        offer_id: new_id(),
        expires_at: now() + 5000,
    };
    assert_eq!(
        scheduler::prepare(
            &mut candidate,
            &sources,
            &restored.registry,
            &PrepareRequest { session_key: rig.key("b"), offer: offered, operation_id: new_id() },
            now()
        )
        .unwrap()
        .blocker
        .unwrap()
        .code,
        "uncertain"
    );
    let request = ResolveRequest {
        batch: BatchRequest {
            batch_id: uncertain.id.clone(),
            attempt_id: uncertain.attempt_id.clone(),
            expected_revision: uncertain.revision,
        },
        sequence: uncertain.sequence,
        decision: "abandon".into(),
    };
    restored.resolve(&request).unwrap();
    assert!(restored.resolve(&request).is_err());
    assert_eq!(restored.batch(&prepared.id).unwrap().phase, "abandoned");
    assert!(!restored.store.snapshot().unwrap().entries.values().any(
        |entry| prepared.entry_ids.contains(&entry.view.id) && entry.view.delivery_phase == DeliveryPhase::Pending
    ));
}

#[test]
fn activation_retires_legacy_claims_and_keeps_offline_work() {
    let rig = Rig::new();
    let task = crate::collab::task::build_task(
        new_id(),
        &crate::collab::task::TaskRequest { from: "a", to: "b", instruction: "direct", parent: None },
        now(),
        &crate::collab::task::Verdict::Allowed,
    );
    let id = task.id.clone();
    rig.service.board.insert(task).unwrap();
    assert!(rig.service.board.pending().is_empty());
    assert!(!rig.service.board.claim_delivery(&id, "old-owner").unwrap());
    assert!(
        !rig.service
            .board
            .delivery_update(&id, "old-owner", 1, crate::collab::task::DeliveryPhase::Submitting, None)
            .unwrap()
    );
    rig.service.board.abandon_for("b").unwrap();
    assert_eq!(rig.service.board.get(&id).unwrap().state, crate::collab::task::TaskState::Queued);
}

#[test]
fn pause_collects_and_fyi_does_not_wake_or_inflate_pending_count() {
    let rig = Rig::new();
    rig.service.rooms.mutate(&rig.room_id, |room| ops::set_paused(room, true, now())).unwrap();
    let id = rig.post("saved while paused", "paused");
    rig.service.sync().unwrap();
    let view = rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap();
    assert_eq!(view.waiting_reason.unwrap().code, "room_paused");
    rig.service.rooms.mutate(&rig.room_id, |room| ops::set_paused(room, false, now())).unwrap();
    assert_eq!(rig.submit("b").message_ids, vec![id]);
    rig.say(
        "a",
        "worker",
        "FYI only",
        MessageOptions { topic_id: Some("fyi".into()), class: Some(MessageClass::Fyi), ..Default::default() },
        None,
    );
    rig.service.sync().unwrap();
    let offer = rig.offer("b");
    assert_eq!(
        rig.service
            .prepare(&PrepareRequest { session_key: rig.key("b"), offer, operation_id: new_id() })
            .unwrap()
            .blocker
            .unwrap()
            .code,
        "empty"
    );
    assert_eq!(
        rig.service
            .sessions(rig.root.to_str().unwrap(), None)
            .unwrap()
            .sessions
            .iter()
            .find(|s| s.tab_id == "b")
            .unwrap()
            .pending_count,
        0
    );
}

#[test]
fn role_extensions_survive_storage_upgrade_and_same_agent_tabs_stay_distinct() {
    let rig = Rig::new();
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            room.members.iter_mut().find(|m| m.id == rig.worker).unwrap().extensions =
                BTreeMap::from([
                    ("modelOverride".into(), serde_json::json!("role-model")),
                    ("futureRoleSetting".into(), serde_json::json!({ "enabled": true })),
                ]);
            Ok(())
        })
        .unwrap();
    let reopened = RoomStore::load(Some(rig.root.join("rooms")));
    let room = reopened.get(&rig.room_id).unwrap();
    let member = room.members.iter().find(|m| m.id == rig.worker).unwrap();
    assert_eq!(member.model_override.as_deref(), Some("role-model"));
    assert!(!member.extensions.contains_key("modelOverride"));
    assert_eq!(member.extensions["futureRoleSetting"], serde_json::json!({ "enabled": true }));
    assert!(room.members.iter().any(|m| m.role == MemberRole::Foreman && m.id == rig.sender));
    let sessions = rig.service.sessions(rig.root.to_str().unwrap(), None).unwrap();
    assert_eq!(sessions.sessions.iter().filter(|s| s.agent == "codex").count(), 2);
    assert_ne!(rig.key("a"), rig.key("b"));
}

#[test]
fn latest_page_and_stable_older_cursor_survive_new_arrivals() {
    let rig = Rig::new();
    let base = now() - 10_000;
    let (ids, _) = rig
        .service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            (0..60)
                .map(|index| {
                    crate::rooms::semantics::say(
                        room,
                        &RoomActor::Member(&member),
                        &["worker".into()],
                        &format!("message {index}"),
                        None,
                        false,
                        &MessageOptions { topic_id: Some("paging".into()), ..Default::default() },
                        base + index,
                    )
                    .map(|posts| posts[0].message_id.clone())
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap();
    let latest = rig.service.messages(&rig.key("b"), Some(&rig.room_id), None, Some(10), None).unwrap();
    assert_eq!(latest.messages.iter().map(|m| m.message_id.clone()).collect::<Vec<_>>(), ids[50..60]);
    let cursor = latest.next_cursor.unwrap();
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            crate::rooms::semantics::say(
                room,
                &RoomActor::Member(&member),
                &["worker".into()],
                "new arrival",
                None,
                false,
                &MessageOptions { topic_id: Some("paging".into()), ..Default::default() },
                base + 100,
            )
        })
        .unwrap();
    rig.service.sync().unwrap();
    let older = rig.service.messages(&rig.key("b"), Some(&rig.room_id), Some(&cursor), Some(10), None).unwrap();
    assert_eq!(older.messages.iter().map(|m| m.message_id.clone()).collect::<Vec<_>>(), ids[40..50]);
    assert!(rig.service.messages(&rig.key("a"), Some(&rig.room_id), Some(&cursor), Some(10), None).is_err());
}

#[test]
fn two_priority_batches_are_followed_by_the_oldest_normal_item() {
    let rig = Rig::new();
    let normal = rig.post("normal", "normal");
    let highs: Vec<_> = (0..3).map(|index| rig.post(&format!("high {index}"), &format!("high-{index}"))).collect();
    rig.service.sync().unwrap();
    for (index, id) in highs.iter().enumerate() {
        let entry = rig.messages("b").into_iter().find(|m| m.message_id == *id).unwrap();
        rig.service
            .agent(
                "b",
                &AgentCommand::Policy {
                    room: Some("Inbox test".into()),
                    topic_id: entry.topic_id,
                    expected_revision: 0,
                    priority: Some("high".into()),
                    hold_until: None,
                    resume: false,
                    operation_id: format!("policy-{index}"),
                },
            )
            .unwrap();
    }
    assert!(highs.contains(&rig.submit("b").message_ids[0]));
    assert!(highs.contains(&rig.submit("b").message_ids[0]));
    assert_eq!(rig.submit("b").message_ids, vec![normal]);
}

#[test]
fn uncertain_batches_can_only_be_resolved_by_recipient_or_current_coordinator() {
    let rig = Rig::new();
    rig.post("ambiguous", "api");
    let (offer, prepared) = rig.prepare("b");
    let begin = rig.begin(offer, &prepared);
    let uncertain = rig
        .service
        .receipt(&ReceiptRequest {
            batch_id: prepared.id.clone(),
            attempt_id: prepared.attempt_id.clone(),
            sequence: begin.batch.sequence + 1,
            phase: "uncertain".into(),
            payload_hash: prepared.payload_hash,
            message: None,
        })
        .unwrap();
    assert!(rig.service.agent("outsider", &AgentCommand::BatchGet { batch_id: uncertain.id.clone() }).is_err());
    assert!(rig.service.agent("a", &AgentCommand::BatchGet { batch_id: uncertain.id.clone() }).is_ok());
    let command = AgentCommand::Resolve {
        request: ResolveRequest {
            batch: BatchRequest {
                batch_id: uncertain.id.clone(),
                attempt_id: uncertain.attempt_id,
                expected_revision: uncertain.revision,
            },
            sequence: uncertain.sequence,
            decision: "abandon".into(),
        },
        operation_id: "verified".into(),
    };
    assert!(rig.service.agent("outsider", &command).is_err());
    rig.service.agent("b", &command).unwrap();
    rig.service.agent("b", &command).unwrap();
    assert_eq!(rig.service.batch(&uncertain.id).unwrap().phase, "abandoned");
}

#[test]
fn ack_and_withdraw_are_authorized_cas_and_do_not_forge_delivery() {
    let rig = Rig::new();
    let id = rig.post("unread", "api");
    rig.service.sync().unwrap();
    let entry = rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap();
    let ack = AgentCommand::Ack {
        entries: vec![EntryVersion { id: entry.id.clone(), revision: entry.revision }],
        state: Handling::Processed,
        operation_id: "ack".into(),
    };
    assert!(rig.service.agent("a", &ack).is_err());
    rig.service.agent("b", &ack).unwrap();
    rig.service.agent("b", &ack).unwrap();
    let handled = rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap();
    assert_eq!(handled.delivery_phase, DeliveryPhase::Pending);
    assert_eq!(handled.handling_status.code, "processed");
    assert!(
        rig.service
            .agent(
                "a",
                &AgentCommand::Withdraw {
                    entries: vec![EntryVersion { id: entry.id.clone(), revision: entry.revision }],
                    operation_id: "stale".into()
                }
            )
            .is_err()
    );
    rig.service
        .agent(
            "a",
            &AgentCommand::Withdraw {
                entries: vec![EntryVersion { id: entry.id, revision: handled.revision }],
                operation_id: "withdraw".into(),
            },
        )
        .unwrap();
    assert_eq!(
        rig.messages("b").into_iter().find(|m| m.message_id == id).unwrap().delivery_phase,
        DeliveryPhase::Withdrawn
    );
}

#[test]
fn activation_imports_legacy_submission_intent_as_a_resolvable_uncertain_batch() {
    let rig = Rig::setup(false);
    let mut task = crate::collab::task::build_task(
        new_id(),
        &crate::collab::task::TaskRequest { from: "a", to: "b", instruction: "old task", parent: None },
        now(),
        &crate::collab::task::Verdict::Allowed,
    );
    task.project_root = Some(rig.root.to_str().unwrap().into());
    let id = task.id.clone();
    rig.service.board.insert(task).unwrap();
    assert!(rig.service.board.claim_delivery(&id, "legacy").unwrap());
    rig.service.board.delivery_update(&id, "legacy", 1, crate::collab::task::DeliveryPhase::Submitting, None).unwrap();
    rig.service.activate("switch".into(), true).unwrap();
    let batch = rig.service.batch(&format!("legacy:{id}")).unwrap();
    assert_eq!(batch.phase, "uncertain");
    assert_eq!(batch.attempt_id, "legacy");
    assert_eq!(rig.service.pending().unwrap().recipients.iter().find(|r| r.tab_id == "b").unwrap().pending_count, 1);
}

#[test]
fn reopened_task_rejects_completion_from_the_previous_assignment_generation() {
    let rig = Rig::new();
    let task = rig.task("lifecycle");
    rig.submit("b");
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            ops::task_done(room, &RoomActor::Member(&member), &task, Some("first lifecycle done"), now())?;
            ops::task_reopen(room, &RoomActor::Member(&member), &task, now() - 10_000)
        })
        .unwrap();
    let directory = crate::rooms::member_directory(rig.service.rooms.clone(), rig.service.registry.clone());
    assert!(
        directory
            .handle(
                "b",
                &belfry_protocol::Command::RoomTask {
                    room: Some("Inbox test".into()),
                    op: belfry_protocol::RoomTaskOp::Done {
                        task: task.clone(),
                        result: Some("late completion".into()),
                        generation: Some(1)
                    }
                }
            )
            .is_err()
    );
    assert!(rig.submit("b").payload.contains("--generation 2"));
}

#[test]
fn oversized_task_delivers_a_stable_full_text_reference_and_keeps_its_full_outcome() {
    let rig = Rig::new();
    let outcome = "详细要求".repeat(5000);
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            ops::task_add(
                room,
                &RoomActor::Member(&member),
                "large",
                Some(&outcome),
                Some("worker"),
                &[],
                now() - 10_000,
            )
        })
        .unwrap();
    let (_, prepared) = rig.prepare("b");
    assert_eq!(prepared.content_mode, "reference");
    assert!(prepared.payload.len() <= MAX_BATCH_BYTES);
    let message = rig
        .service
        .agent("b", &AgentCommand::Read { message_id: prepared.message_ids[0].clone(), cursor: None, limit: None })
        .unwrap();
    let belfry_protocol::ResponseData::CollaborationInbox { result } = message else { panic!() };
    assert!(result["messages"][0]["text"].as_str().unwrap().contains(&outcome));
}

#[test]
fn references_cross_recipient_sessions_and_older_question_details_refresh() {
    let rig = Rig::new();
    let original = rig.say(
        "a",
        "worker",
        "question before history",
        MessageOptions {
            topic_id: Some("history-question".into()),
            questions: vec!["the decision?".into()],
            ..Default::default()
        },
        None,
    )[0]
    .clone();
    rig.submit("b");
    let question = rig.messages("b").into_iter().find(|m| m.message_id == original).unwrap().questions[0].id.clone();
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            for index in 0..55 {
                crate::rooms::semantics::say(
                    room,
                    &RoomActor::Member(&member),
                    &["worker".into()],
                    &format!("later {index}"),
                    None,
                    false,
                    &MessageOptions::default(),
                    now(),
                )?;
            }
            Ok(())
        })
        .unwrap();
    assert!(!rig.messages("b").iter().any(|m| m.message_id == original));
    let reply = rig.say(
        "b",
        "lead",
        "the decision is yes",
        MessageOptions { answers: vec![question], operation_id: Some("history-answer".into()), ..Default::default() },
        None,
    )[0]
    .clone();
    let received = rig.messages("a").into_iter().find(|m| m.message_id == reply).unwrap();
    assert_eq!(received.reply_preview.as_ref().unwrap().message_id, original);
    assert!(received.reply_preview.as_ref().unwrap().text.contains("question before history"));
    let refreshed = rig.service.messages(&rig.key("b"), Some(&rig.room_id), None, None, Some(&original)).unwrap();
    assert_eq!(refreshed.messages[0].questions[0].state, "replied");
    let cross_session = rig.service.messages(&rig.key("a"), Some(&rig.room_id), None, None, Some(&original)).unwrap();
    assert_eq!(cross_session.messages[0].recipient.tab_id, "b");
    assert_eq!(cross_session.messages[0].questions[0].state, "replied");
}

#[test]
fn deleted_room_keeps_only_the_original_recipient_recovery_right_and_never_reposts() {
    for decision in ["submitted", "abandon"] {
        let mut rig = Rig::new();
        let original = rig.post("deleted source body", "old");
        let (offer, batch) = rig.prepare("b");
        let begin = rig.begin(offer, &batch);
        let uncertain = rig
            .service
            .receipt(&ReceiptRequest {
                batch_id: batch.id.clone(),
                attempt_id: batch.attempt_id.clone(),
                sequence: begin.batch.sequence + 1,
                phase: "uncertain".into(),
                payload_hash: batch.payload_hash.clone(),
                message: None,
            })
            .unwrap();
        let other = rig.service.rooms.create("Other room", rig.root.to_str().unwrap(), "keep working").unwrap();
        let (next, _) = rig
            .service
            .rooms
            .mutate(&other.id, |room| {
                ops::add_member(room, "a", "codex", "lead", "coordinate", false, now() - 20_000)?;
                ops::add_member(room, "b", "codex", "worker", "implement", false, now() - 20_000)?;
                let delivered: Vec<_> = room
                    .all_messages()
                    .flat_map(|message| message.to.iter().map(move |member| (message.id.clone(), member.clone())))
                    .collect();
                for (message, member) in delivered {
                    ops::record_delivery(room, &message, &member, now() - 20_000);
                }
                room.delivery_outbox.clear();
                let member = room.member_by_tab("a").unwrap().clone();
                crate::rooms::semantics::say(
                    room,
                    &RoomActor::Member(&member),
                    &["worker".into()],
                    "other room body",
                    None,
                    false,
                    &MessageOptions::default(),
                    now() - 10_000,
                )
            })
            .unwrap();
        rig.service.rooms.delete(&rig.room_id).unwrap();
        rig.service.sync().unwrap();
        let offered = rig.offer("b");
        let blocked = rig
            .service
            .prepare(&PrepareRequest { session_key: rig.key("b"), offer: offered, operation_id: new_id() })
            .unwrap();
        assert_eq!(blocked.blocker.unwrap().code, "uncertain");
        let read = AgentCommand::BatchGet { batch_id: batch.id.clone() };
        assert!(rig.service.agent("a", &read).is_err(), "another room's coordinator gains no recovery rights");
        assert!(rig.service.agent("outsider", &read).is_err());
        rig.service.agent("b", &read).unwrap();
        let resolve = AgentCommand::Resolve {
            request: ResolveRequest {
                batch: BatchRequest {
                    batch_id: batch.id.clone(),
                    attempt_id: batch.attempt_id.clone(),
                    expected_revision: uncertain.revision,
                },
                sequence: uncertain.sequence,
                decision: decision.into(),
            },
            operation_id: "resolve-deleted".into(),
        };
        assert!(rig.service.agent("a", &resolve).is_err());
        rig.service.agent("b", &resolve).unwrap();
        rig.service = Arc::new(InboxService::load(
            Some(rig.root.join("inbox")),
            rig.service.rooms.clone(),
            rig.service.board.clone(),
            rig.service.registry.clone(),
            rig.service.gate.clone(),
        ));
        rig.service.sync().unwrap();
        let next_batch = rig.submit("b");
        assert_eq!(next_batch.message_ids, vec![next[0].message_id.clone()]);
        assert!(!next_batch.payload.contains("deleted source body"));
        assert!(matches!(
            rig.service
                .store
                .snapshot()
                .unwrap()
                .entries
                .values()
                .find(|entry| entry.view.message_id == original)
                .unwrap()
                .view
                .delivery_phase,
            DeliveryPhase::Submitted | DeliveryPhase::Abandoned
        ));
    }
}

#[test]
fn message_operation_receipts_survive_projection_trimming_and_restart() {
    let rig = Rig::new();
    let options = MessageOptions { operation_id: Some("durable-message-operation".into()), ..Default::default() };
    let original = rig.say("a", "worker", "exact original", options.clone(), None)[0].clone();
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| {
            ops::record_delivery(room, &original, &rig.worker, now());
            room.delivery_outbox.clear();
            let member = room.member_by_tab("a").unwrap().clone();
            for index in 0..crate::rooms::model::MAX_MESSAGES + 2 {
                crate::rooms::semantics::say(
                    room,
                    &RoomActor::Member(&member),
                    &["user".into()],
                    &format!("newer {index}"),
                    None,
                    false,
                    &MessageOptions::default(),
                    now(),
                )?;
            }
            assert!(room.message(&original).is_none(), "the acceptance receipt must outlive the message window");
            Ok(())
        })
        .unwrap();
    let reopened = RoomStore::load(Some(rig.root.join("rooms")));
    let ledger_before = reopened.get(&rig.room_id).unwrap().ledger_bytes;
    let (retried, room) = reopened
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            crate::rooms::semantics::say(
                room,
                &RoomActor::Member(&member),
                &["worker".into()],
                "exact original",
                None,
                false,
                &options,
                now(),
            )
        })
        .unwrap();
    assert_eq!(retried[0].message_id, original);
    assert_eq!(room.ledger_bytes, ledger_before);
    assert!(room.delivery_outbox.iter().all(|entry| entry.message_id != original));
    assert!(
        reopened
            .mutate(&rig.room_id, |room| {
                let member = room.member_by_tab("a").unwrap().clone();
                crate::rooms::semantics::say(
                    room,
                    &RoomActor::Member(&member),
                    &["worker".into()],
                    "changed payload",
                    None,
                    false,
                    &options,
                    now(),
                )
            })
            .is_err()
    );
}

#[test]
fn one_answer_operation_splits_by_asking_author_and_rejects_unrelated_questions() {
    let rig = Rig::new();
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| ops::add_member(room, "c", "codex", "peer", "ask", false, now() - 20_000))
        .unwrap();
    let first = rig.say(
        "a",
        "worker",
        "first author",
        MessageOptions { topic_id: Some("joint".into()), questions: vec!["a?".into()], ..Default::default() },
        None,
    )[0]
    .clone();
    let second = rig.say(
        "c",
        "worker",
        "second author",
        MessageOptions { topic_id: Some("joint".into()), questions: vec!["c?".into()], ..Default::default() },
        None,
    )[0]
    .clone();
    let unrelated = rig.say(
        "a",
        "worker",
        "other topic",
        MessageOptions { topic_id: Some("other".into()), questions: vec!["other?".into()], ..Default::default() },
        None,
    )[0]
    .clone();
    let question =
        |id: &str| rig.messages("b").into_iter().find(|entry| entry.message_id == id).unwrap().questions[0].id.clone();
    let first_q = question(&first);
    let second_q = question(&second);
    let other_q = question(&unrelated);
    let answer = |tab: &str, questions: Vec<String>, operation: &str| {
        rig.service.rooms.mutate(&rig.room_id, |room| {
            let member = room.member_by_tab(tab).unwrap().clone();
            crate::rooms::semantics::say(
                room,
                &RoomActor::Member(&member),
                &[],
                "shared answer",
                None,
                false,
                &MessageOptions { answers: questions, operation_id: Some(operation.into()), ..Default::default() },
                now(),
            )
        })
    };
    let original_bytes = fs::read(rig.root.join("rooms/rooms.json")).unwrap();
    assert!(answer("a", vec![first_q.clone()], "unauthorized").is_err());
    assert!(answer("b", vec![first_q.clone(), other_q], "wrong-topic").is_err());
    assert_eq!(fs::read(rig.root.join("rooms/rooms.json")).unwrap(), original_bytes);
    let (replies, _) = answer("b", vec![first_q.clone(), second_q.clone()], "joint-answer").unwrap();
    assert_eq!(replies.len(), 2);
    assert!(replies.iter().all(|reply| reply.to.len() == 1));
    assert_eq!(answer("b", vec![first_q.clone(), second_q.clone()], "joint-answer").unwrap().0, replies);
    let room = RoomStore::load(Some(rig.root.join("rooms"))).get(&rig.room_id).unwrap();
    for (original, q) in [(first, first_q), (second, second_q)] {
        let message = room.message(&original).unwrap();
        assert!(message.awaiting().is_empty());
        let reply = replies.iter().find(|reply| reply.to[0] == message.by).unwrap();
        let received = room.message(&reply.message_id).unwrap();
        assert_eq!(received.inbox.as_ref().unwrap().answers, vec![q]);
        assert_eq!(received.reply_to.as_ref(), Some(&original));
    }
}

#[test]
fn source_answer_revisions_advance_even_before_background_import() {
    let rig = Rig::new();
    let original = rig.say(
        "a",
        "worker",
        "two obligations",
        MessageOptions { questions: vec!["first?".into(), "second?".into()], ..Default::default() },
        None,
    )[0]
    .clone();
    rig.service.sync().unwrap();
    let original_entry = rig.messages("b").into_iter().find(|message| message.message_id == original).unwrap();
    rig.say(
        "b",
        "lead",
        "answer one",
        MessageOptions { answers: vec![original_entry.questions[0].id.clone()], ..Default::default() },
        None,
    );
    let partial = rig.messages("b").into_iter().find(|message| message.message_id == original).unwrap();
    rig.say(
        "b",
        "lead",
        "answer two",
        MessageOptions { answers: vec![original_entry.questions[1].id.clone()], ..Default::default() },
        None,
    );
    let complete = rig.messages("b").into_iter().find(|message| message.message_id == original).unwrap();
    assert!(complete.revision > partial.revision && partial.revision > original_entry.revision);
    assert!(
        rig.service
            .agent(
                "b",
                &AgentCommand::Ack {
                    entries: vec![EntryVersion { id: partial.id, revision: partial.revision }],
                    state: Handling::Processed,
                    operation_id: "stale-partial".into()
                }
            )
            .is_err()
    );
}

#[test]
fn prepare_operation_retry_after_begin_returns_the_same_batch_without_a_second_guard() {
    let rig = Rig::new();
    rig.post("frozen once", "api");
    let request =
        PrepareRequest { session_key: rig.key("b"), offer: rig.offer("b"), operation_id: "prepare-once".into() };
    let prepared = rig.service.prepare(&request).unwrap().batch.unwrap();
    let begin = rig.begin(request.offer.clone(), &prepared);
    let replay = rig.service.prepare(&request).unwrap().batch.unwrap();
    assert_eq!(replay.id, prepared.id);
    assert_eq!(replay.phase, "submitting");
    assert_eq!(replay.payload_hash, prepared.payload_hash);
    assert!(
        rig.service
            .begin(&BeginRequest {
                batch: BatchRequest {
                    batch_id: replay.id,
                    attempt_id: replay.attempt_id,
                    expected_revision: replay.revision
                },
                offer: request.offer
            })
            .is_err()
    );
    rig.finish(&begin);
    assert_eq!(rig.service.store.snapshot().unwrap().batches.len(), 1);
}

#[test]
fn legacy_direct_work_waits_for_its_fixed_target_project_then_pins_it() {
    let rig = Rig::new();
    let task = crate::collab::task::build_task(
        new_id(),
        &crate::collab::task::TaskRequest { from: "a", to: "b", instruction: "legacy pending", parent: None },
        now(),
        &crate::collab::task::Verdict::Allowed,
    );
    let id = task.id.clone();
    rig.service.board.insert(task).unwrap();
    let roster = rig.service.registry.all();
    rig.service.registry.replace(vec![]);
    rig.service.sync().unwrap();
    assert!(rig.service.board.get(&id).is_some());
    assert!(!rig.service.store.snapshot().unwrap().entries.values().any(|entry| entry.view.message_id == id));
    rig.service.registry.replace(roster.clone());
    rig.service.sync().unwrap();
    let expected_root = source::normalize_root(rig.root.to_str().unwrap());
    assert_eq!(rig.service.board.get(&id).unwrap().project_root.as_deref(), Some(expected_root.as_str()));
    let mut moved = roster;
    moved.iter_mut().find(|session| session.tab_id == "b").unwrap().project_root =
        Some(rig.root.join("another").to_string_lossy().into_owned());
    rig.service.registry.replace(moved);
    rig.service.sync().unwrap();
    let entry = rig.messages("b").into_iter().find(|entry| entry.message_id == id);
    assert!(entry.is_none(), "room-filtered reads exclude direct work");
    let direct = rig.service.messages(&rig.key("b"), None, None, None, Some(&id)).unwrap().messages.remove(0);
    assert_eq!(direct.recipient.project_root, expected_root);
    assert_eq!(direct.waiting_reason.unwrap().code, "runtime_not_ready");
}

#[test]
fn declared_wait_prioritizes_its_answer_and_returns_without_blocking_the_turn() {
    let rig = Rig::new();
    let original = rig.say(
        "a",
        "worker",
        "decision needed",
        MessageOptions { questions: vec!["which schema?".into()], ..Default::default() },
        None,
    )[0]
    .clone();
    rig.submit("b");
    let question =
        rig.messages("b").into_iter().find(|entry| entry.message_id == original).unwrap().questions[0].id.clone();
    rig.service
        .agent(
            "a",
            &AgentCommand::Wait {
                question_ids: vec![question.clone()],
                task: None,
                clear: false,
                operation_id: "wait".into(),
            },
        )
        .unwrap();
    let ordinary = rig.say("b", "lead", "ordinary later work", MessageOptions::default(), None)[0].clone();
    let reply =
        rig.say("b", "lead", "schema answer", MessageOptions { answers: vec![question], ..Default::default() }, None)
            [0]
        .clone();
    assert_eq!(rig.submit("a").message_ids, vec![reply]);
    assert_eq!(rig.submit("a").message_ids, vec![ordinary]);
    rig.service
        .agent(
            "a",
            &AgentCommand::Wait { question_ids: vec![], task: None, clear: true, operation_id: "clear-wait".into() },
        )
        .unwrap();
    assert!(!rig.service.store.snapshot().unwrap().waits.contains_key(&rig.key("a")));
}

#[test]
fn continuous_arrivals_have_a_bounded_debounce_and_batches_obey_capacity() {
    let rig = Rig::new();
    let at = now();
    let (messages, _) = rig
        .service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            (0..MAX_BATCH_MESSAGES + 1)
                .map(|index| {
                    crate::rooms::semantics::say(
                        room,
                        &RoomActor::Member(&member),
                        &["worker".into()],
                        &format!("arrival {index}"),
                        None,
                        false,
                        &MessageOptions { topic_id: Some("continuous".into()), ..Default::default() },
                        if index == 0 { at - 6_000 } else { at },
                    )
                    .map(|posts| posts[0].message_id.clone())
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap();
    let (_, batch) = rig.prepare("b");
    assert_eq!(batch.entry_ids.len(), MAX_BATCH_MESSAGES);
    assert!(batch.payload.len() <= MAX_BATCH_BYTES);
    assert!(batch.message_ids.contains(&messages[0]));
    let pending = rig
        .service
        .store
        .snapshot()
        .unwrap()
        .entries
        .values()
        .filter(|entry| {
            messages.contains(&entry.view.message_id) && entry.view.delivery_phase == DeliveryPhase::Pending
        })
        .count();
    assert_eq!(pending, 1);
}

#[test]
fn unknown_inbox_schema_is_readonly_and_preserves_the_original_file() {
    let rig = Rig::new();
    let path = rig.root.join("inbox/inbox.json");
    let mut data: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    data["schemaVersion"] = serde_json::json!(999);
    let original = serde_json::to_vec(&data).unwrap();
    fs::write(&path, &original).unwrap();
    let restored = InboxService::load(
        Some(rig.root.join("inbox")),
        rig.service.rooms.clone(),
        rig.service.board.clone(),
        rig.service.registry.clone(),
        rig.service.gate.clone(),
    );
    assert!(restored.store.error().is_some());
    assert!(
        restored
            .store
            .edit(|data| {
                data.enabled = false;
                Ok(())
            })
            .is_err()
    );
    assert!(restored.sessions(rig.root.to_str().unwrap(), None).unwrap().load_error.is_some());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn withdrawing_one_recipient_cancels_only_their_unanswered_obligations() {
    let rig = Rig::new();
    rig.service
        .rooms
        .mutate(&rig.room_id, |room| ops::add_member(room, "c", "codex", "peer", "answer", false, now()))
        .unwrap();
    let (posts, _) = rig
        .service
        .rooms
        .mutate(&rig.room_id, |room| {
            let member = room.member_by_tab("a").unwrap().clone();
            crate::rooms::semantics::say(
                room,
                &RoomActor::Member(&member),
                &["worker".into(), "peer".into()],
                "questions for both",
                None,
                false,
                &MessageOptions { questions: vec!["first?".into(), "second?".into()], ..Default::default() },
                now(),
            )
        })
        .unwrap();
    let id = &posts[0].message_id;
    let question =
        rig.messages("b").into_iter().find(|message| &message.message_id == id).unwrap().questions[0].id.clone();
    rig.say("b", "lead", "first answer", MessageOptions { answers: vec![question], ..Default::default() }, None);
    let entry = rig.messages("b").into_iter().find(|message| &message.message_id == id).unwrap();
    let withdraw = AgentCommand::Withdraw {
        entries: vec![EntryVersion { id: entry.id.clone(), revision: entry.revision }],
        operation_id: "withdraw-only-b".into(),
    };
    let before = fs::read(rig.root.join("rooms/rooms.json")).unwrap();
    store::FAIL_WRITE.set(true);
    assert!(rig.service.agent("a", &withdraw).is_err());
    assert_eq!(fs::read(rig.root.join("rooms/rooms.json")).unwrap(), before);
    rig.service.agent("a", &withdraw).unwrap();
    let withdrawn = rig.messages("b").into_iter().find(|message| &message.message_id == id).unwrap();
    assert_eq!(withdrawn.delivery_phase, DeliveryPhase::Withdrawn);
    assert_eq!(
        withdrawn.questions.iter().map(|question| question.state.as_str()).collect::<Vec<_>>(),
        ["replied", "cancelled"]
    );
    let room = RoomStore::load(Some(rig.root.join("rooms"))).get(&rig.room_id).unwrap();
    let peer = room.member_by_tab("c").unwrap();
    assert_eq!(room.message(id).unwrap().awaiting(), vec![peer.id.clone()]);
    assert!(!room.message(id).unwrap().replied_by.contains(&rig.worker));
    let to_peer =
        rig.service.messages(&rig.key("c"), Some(&rig.room_id), None, None, Some(id)).unwrap().messages.remove(0);
    assert!(to_peer.questions.iter().all(|question| question.state == "open"));
    assert!(
        rig.service
            .rooms
            .mutate(&rig.room_id, |room| {
                let member = room.member_by_tab("b").unwrap().clone();
                crate::rooms::semantics::say(
                    room,
                    &RoomActor::Member(&member),
                    &[],
                    "late answer",
                    None,
                    false,
                    &MessageOptions { answers: vec![entry.questions[1].id.clone()], ..Default::default() },
                    now(),
                )
            })
            .is_err()
    );
}
