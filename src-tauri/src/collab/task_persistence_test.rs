use super::*;
use std::{fs, path::PathBuf};

struct Disk(PathBuf);
impl Disk {
    fn new() -> Self { Self(std::env::temp_dir().join(format!("belfry-task-test-{}", ulid::Ulid::generate()))) }
    fn load(&self) -> TaskBoard { TaskBoard::load(Some(self.0.clone())) }
}
impl Drop for Disk { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn entry(id: &str) -> CollabTask {
    build_task(id.into(), &TaskRequest { from: "sender", to: "worker", instruction: "recover this task", parent: None }, 0, &Verdict::Allowed)
}
fn update(board: &TaskBoard, id: &str, sequence: u64, phase: DeliveryPhase) {
    assert!(board.delivery_update(id, "attempt-one", sequence, phase, None).unwrap());
}

#[test]
fn regression_accepted_task_is_queryable_and_settleable_after_restart() {
    let disk = Disk::new();
    let board = disk.load();
    board.insert(entry("01original-task-87654321")).unwrap();
    drop(board);
    let restored = disk.load();
    let task = restored.snapshot().into_iter().find(|task| short_id(&task.id) == "87654321")
        .expect("a successful acceptance must survive restarting the application");
    assert_eq!(task.instruction, "recover this task");
    restored.settle(&task.id, "worker", TaskState::Done, Some("recovered result".into())).unwrap();
    drop(restored);
    let task = disk.load().get(&task.id).unwrap();
    assert_eq!(task.state, TaskState::Done);
    assert_eq!(task.result.as_deref(), Some("recovered result"));
}

#[test]
fn restart_only_retries_tasks_that_have_no_submission_intent() {
    let disk = Disk::new();
    let board = disk.load();
    for id in ["accepted", "queued", "submitting", "submitted"] {
        board.insert(entry(id)).unwrap();
        if id != "accepted" {
            assert!(board.claim_delivery(id, "attempt-one").unwrap());
            update(&board, id, 1, DeliveryPhase::Queued);
        }
        if matches!(id, "submitting" | "submitted") { update(&board, id, 2, DeliveryPhase::Submitting); }
        if id == "submitted" { update(&board, id, 3, DeliveryPhase::Submitted); }
    }
    drop(board);
    let restored = disk.load();
    let mut pending: Vec<_> = restored.pending().into_iter().map(|task| task.id).collect();
    pending.sort();
    assert_eq!(pending, ["accepted", "queued"]);
    assert!(restored.get("queued").unwrap().delivery.attempt_id.is_none());
    assert_eq!(restored.get("submitting").unwrap().delivery.phase, DeliveryPhase::Uncertain);
    assert_eq!(restored.get("submitted").unwrap().state, TaskState::Dispatched);
    assert!(!restored.claim_delivery("submitting", "new-attempt").unwrap());
    assert!(!restored.claim_delivery("submitted", "new-attempt").unwrap());
    drop(restored);
    assert_eq!(disk.load().get("submitting").unwrap().delivery.phase, DeliveryPhase::Uncertain);
}

#[test]
fn submitted_requires_a_durable_intent_and_late_receipts_never_rewind_it() {
    let disk = Disk::new();
    let board = disk.load();
    board.insert(entry("task")).unwrap();
    assert!(board.claim_delivery("task", "attempt-one").unwrap());
    update(&board, "task", 1, DeliveryPhase::Queued);
    assert!(board.delivery_update("task", "attempt-one", 2, DeliveryPhase::Submitted, None).is_err());
    update(&board, "task", 3, DeliveryPhase::Submitting);
    update(&board, "task", 2, DeliveryPhase::Queued);
    assert_eq!(board.get("task").unwrap().delivery.phase, DeliveryPhase::Submitting);
    update(&board, "task", 4, DeliveryPhase::Submitted);
    update(&board, "task", 5, DeliveryPhase::Queued);
    assert_eq!(board.get("task").unwrap().delivery.phase, DeliveryPhase::Submitted);
    assert!(!board.delivery_update("task", "attempt-one", 3, DeliveryPhase::Submitting, None).unwrap());
    assert!(!board.delivery_update("task", "attempt-one", 6, DeliveryPhase::Submitting, None).unwrap());
    assert!(board.pending().is_empty());
}

#[test]
fn cancellation_blocks_even_an_idempotent_gate_but_keeps_late_submission_facts() {
    let disk = Disk::new();
    let board = disk.load();
    board.insert(entry("task")).unwrap();
    assert!(board.claim_delivery("task", "attempt-one").unwrap());
    update(&board, "task", 1, DeliveryPhase::Submitting);
    assert_eq!(board.stop_all().unwrap(), 1);
    assert!(!board.delivery_update("task", "attempt-one", 1, DeliveryPhase::Submitting, None).unwrap());
    assert!(!board.delivery_update("task", "attempt-one", 2, DeliveryPhase::Submitting, None).unwrap());
    update(&board, "task", 3, DeliveryPhase::Submitted);
    assert_eq!(board.get("task").unwrap().state, TaskState::Abandoned);
    drop(board);
    let restored = disk.load();
    assert_eq!(restored.get("task").unwrap().delivery.phase, DeliveryPhase::Submitted);
    assert!(restored.pending().is_empty());
}

#[test]
fn a_restart_invalidates_old_queue_owners_and_keeps_short_ids_unique() {
    let disk = Disk::new();
    let board = disk.load();
    board.insert(entry("prefix-87654321")).unwrap();
    assert!(board.claim_delivery("prefix-87654321", "attempt-one").unwrap());
    drop(board);
    let restored = disk.load();
    assert!(restored.claim_delivery("prefix-87654321", "attempt-two").unwrap());
    assert!(!restored.delivery_update("prefix-87654321", "attempt-one", 100, DeliveryPhase::Submitting, None).unwrap());
    assert!(restored.insert(entry("different-87654321")).is_err());
    assert_eq!(restored.snapshot().len(), 1);
}

#[test]
fn failed_persistence_never_publishes_acceptance_or_delivery_receipts() {
    let disk = Disk::new();
    let board = disk.load();
    board.insert(entry("task")).unwrap();
    assert!(board.claim_delivery("task", "attempt-one").unwrap());
    update(&board, "task", 1, DeliveryPhase::Submitting);
    let path = disk.0.join("tasks.json");
    let committed = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(board.delivery_update("task", "attempt-one", 2, DeliveryPhase::Submitted, None).is_err());
    assert!(board.insert(entry("not-accepted")).is_err());
    assert_eq!(board.snapshot().len(), 1);
    assert_eq!(board.get("task").unwrap().delivery.phase, DeliveryPhase::Submitting);
    fs::remove_dir(&path).unwrap();
    fs::write(&path, committed).unwrap();
    update(&board, "task", 2, DeliveryPhase::Submitted);
    drop(board);
    let restored = disk.load();
    assert!(restored.pending().is_empty());
    assert!(restored.get("not-accepted").is_none());
}

#[test]
fn stale_writers_and_unknown_versions_preserve_the_committed_file() {
    let disk = Disk::new();
    let board = disk.load();
    let stale = disk.load();
    board.insert(entry("task")).unwrap();
    assert!(stale.insert(entry("stale")).is_err());
    let path = disk.0.join("tasks.json");
    let newer = r#"{"version":99,"revision":1,"tasks":[]}"#;
    fs::write(&path, newer).unwrap();
    let unknown = disk.load();
    assert!(unknown.load_error().is_some());
    assert!(unknown.insert(entry("invalid")).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), newer);
}

#[test]
fn duplicate_claims_do_not_rewrite_tasks_and_claimed_room_text_is_immutable() {
    let disk = Disk::new();
    let board = disk.load();
    let post = crate::collab::RoomPost { room_id: "room".into(), room_name: "Room".into(), message_id: "first".into(),
        tab_id: "worker".into(), member_title: "Worker".into(), line: "first message".into(), ask: false };
    enqueue_room_post(&board, "sender", &post, 0).unwrap();
    let id = board.snapshot()[0].id.clone();
    assert!(board.claim_delivery(&id, "attempt-one").unwrap());
    let before = fs::read(disk.0.join("tasks.json")).unwrap();
    assert!(board.claim_delivery(&id, "attempt-one").unwrap());
    enqueue_room_post(&board, "sender", &post, 1).unwrap();
    assert_eq!(before, fs::read(disk.0.join("tasks.json")).unwrap());
    enqueue_room_post(&board, "sender", &crate::collab::RoomPost { message_id: "second".into(), line: "second message".into(), ..post }, 1).unwrap();
    assert_eq!(board.snapshot().len(), 2);
    assert_eq!(board.get(&id).unwrap().instruction, "first message");
}

#[test]
fn manual_resolution_rejects_stale_panels_and_persists_the_users_exact_decision() {
    for submitted in [true, false] {
        let disk = Disk::new();
        let board = disk.load();
        board.insert(entry("task")).unwrap();
        assert!(board.claim_delivery("task", "attempt-one").unwrap());
        update(&board, "task", 1, DeliveryPhase::Submitting);
        update(&board, "task", 2, DeliveryPhase::Uncertain);
        assert!(board.resolve_delivery("task", "old-attempt", 2, submitted).is_err());
        assert!(board.resolve_delivery("task", "attempt-one", 1, submitted).is_err());
        assert!(board.resolve_delivery("task", "attempt-one", 3, submitted).is_err());
        board.resolve_delivery("task", "attempt-one", 2, submitted).unwrap();
        assert!(board.resolve_delivery("task", "attempt-one", 2, !submitted).is_err());
        drop(board);
        let restored = disk.load();
        assert!(restored.pending().is_empty());
        assert_eq!(restored.get("task").unwrap().delivery.phase, if submitted { DeliveryPhase::Submitted } else { DeliveryPhase::Cancelled });
        assert_eq!(restored.get("task").unwrap().delivery.sequence, 3);
    }
}
