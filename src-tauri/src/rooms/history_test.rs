use super::{ledger, model::*, ops, RoomStore};
use std::{fs, io::{BufWriter, Write}, path::PathBuf, time::Instant};

#[test]
fn regression_startup_reads_only_the_committed_projection() {
    let root = std::env::temp_dir().join(format!("belfry-checkpoint-test-{}", new_id()));
    fs::create_dir_all(&root).unwrap();
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("Checkpoint", root.to_str().unwrap(), "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "worker", "Worker", "")).unwrap();
    let (posted, _) = store.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "pending reply", None, true, 1)).unwrap();
    drop(store);
    ledger::take_replay_bytes();
    let store = RoomStore::load(Some(root.clone()));
    assert!(store.get(&room.id).unwrap().message(&posted.message_id).is_some());
    assert_eq!(ledger::take_replay_bytes(), 0, "正常启动必须只读已提交快照，不能扫描历史账本");
    let snapshot: serde_json::Value = serde_json::from_slice(&fs::read(root.join("rooms.json")).unwrap()).unwrap();
    assert!(!snapshot["rooms"][0]["messages"].as_array().unwrap().is_empty());
    let _ = fs::remove_dir_all(root);
}

fn history_fixture() -> (PathBuf, RoomStore, Room) {
    let root = std::env::temp_dir().join(format!("belfry-history-test-{}", new_id()));
    fs::create_dir_all(&root).unwrap();
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("History", root.to_str().unwrap(), "").unwrap();
    (root, store, room)
}

fn add_events(store: &RoomStore, id: &str, count: usize) {
    store.mutate(id, |room| {
        for index in 0..count {
            let event = ledger::LedgerEvent { v: 1, id: format!("{index:026x}"), ts: index as i64,
                kind: ledger::CHAT_MESSAGE.into(), room_id: room.id.clone(), by: "user".into(),
                data: serde_json::json!({ "text": format!("history {index} {}", "x".repeat(256)), "to": [], "message_mode": "send" }) };
            ledger::apply(room, &event);
            room.pending.push(event);
        }
        Ok(())
    }).unwrap();
}

#[test]
fn history_pages_visit_old_messages_once_with_bounded_reads_and_a_stable_snapshot() {
    let (root, store, room) = history_fixture();
    add_events(&store, &room.id, 2500);
    let room = store.get(&room.id).unwrap();
    assert_eq!(room.ledger_bytes, fs::metadata(ledger::path(&root, &room.id).unwrap()).unwrap().len());
    assert_eq!(store.list().unwrap().rooms[0].ledger_bytes, room.ledger_bytes);
    super::history::take_read_bytes();
    let first = store.history(&room.id, None, Some(7)).unwrap();
    assert!(super::history::take_read_bytes() <= 16 * 1024, "首屏不应扫描整个账本");
    assert_eq!(first.entries.iter().map(|entry| entry.event.as_ref().unwrap().ts).collect::<Vec<_>>(), (2493..2500).collect::<Vec<_>>());
    store.mutate(&room.id, |room| {
        let event = ledger::LedgerEvent { v: 1, id: new_id(), ts: 9999, kind: ledger::CHAT_MESSAGE.into(), room_id: room.id.clone(), by: "user".into(),
            data: serde_json::json!({ "text": "later append", "to": [], "message_mode": "send" }) };
        ledger::apply(room, &event); room.pending.push(event); Ok(())
    }).unwrap();
    let snapshot_bytes = first.snapshot_bytes;
    let mut seen: Vec<_> = first.entries.into_iter().map(|entry| entry.event.unwrap().ts).collect();
    let mut cursor = first.next_cursor;
    while let Some(next) = cursor {
        let page = store.history(&room.id, Some(&next), Some(200)).unwrap();
        assert_eq!(page.snapshot_bytes, snapshot_bytes);
        seen.extend(page.entries.into_iter().map(|entry| entry.event.unwrap().ts));
        cursor = page.next_cursor;
    }
    seen.sort();
    assert_eq!(seen, (0..2500).collect::<Vec<_>>(), "翻页期间的新消息不混入既有游标，也不能重复或遗漏旧消息");
    assert_eq!(store.history(&room.id, None, Some(1)).unwrap().entries[0].event.as_ref().unwrap().ts, 9999);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn migration_streams_once_and_history_keeps_unknown_versions_and_broken_lines() {
    let (root, store, room) = history_fixture();
    add_events(&store, &room.id, 1010);
    drop(store);
    let path = ledger::path(&root, &room.id).unwrap();
    let future = ledger::LedgerEvent { v: 99, id: new_id(), ts: 1020, kind: "future.kind".into(), room_id: room.id.clone(), by: "system".into(), data: serde_json::json!({ "unknown": true }) };
    ledger::append(&path, &[future]).unwrap();
    fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"{broken record\n").unwrap();
    let original = fs::read(&path).unwrap();
    let mut file: serde_json::Value = serde_json::from_slice(&fs::read(root.join("rooms.json")).unwrap()).unwrap();
    file["version"] = serde_json::json!(2);
    file["ledgerLengths"][&room.id] = serde_json::json!(original.len());
    file["rooms"][0]["messages"] = serde_json::json!([]);
    file["rooms"][0]["retainedMessages"] = serde_json::json!([]);
    fs::write(root.join("rooms.json"), serde_json::to_vec(&file).unwrap()).unwrap();
    ledger::take_replay_bytes();
    let migrated = RoomStore::load(Some(root.clone()));
    assert!(migrated.list().unwrap().load_error.is_none());
    assert_eq!(ledger::take_replay_bytes(), original.len() as u64);
    let page = migrated.history(&room.id, None, Some(2)).unwrap();
    assert_eq!(page.entries[0].event.as_ref().unwrap().v, 99);
    assert_eq!(page.entries[0].event.as_ref().unwrap().kind, "future.kind");
    assert_eq!(page.entries[1].raw.as_deref(), Some("{broken record"));
    drop(migrated);
    let again = RoomStore::load(Some(root.clone()));
    assert_eq!(again.get(&room.id).unwrap().messages.len(), MAX_MESSAGES);
    assert_eq!(ledger::take_replay_bytes(), 0);
    assert_eq!(fs::read(path).unwrap(), original, "迁移与分页都不能改写原账本");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn oversized_history_records_use_a_bounded_preview_without_losing_the_next_page() {
    let (root, store, room) = history_fixture();
    drop(store);
    let path = ledger::path(&root, &room.id).unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let bytes = [b"first\n".as_slice(), &vec![b'x'; 128 * 1024], b"\nlast\n"].concat();
    fs::write(&path, &bytes).unwrap();
    let page = super::history::read_page(&path, bytes.len() as u64, None, Some(2)).unwrap();
    assert_eq!(page.entries.len(), 2);
    assert!(page.entries[0].truncated);
    assert_eq!(page.entries[0].raw.as_ref().unwrap().len(), 64 * 1024);
    assert_eq!(page.entries[1].raw.as_deref(), Some("last"));
    let next = super::history::read_page(&path, bytes.len() as u64, page.next_cursor.as_deref(), Some(2)).unwrap();
    assert_eq!(next.entries[0].raw.as_deref(), Some("first"));
    assert!(next.next_cursor.is_none());
    assert_eq!(fs::read(path).unwrap(), bytes);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn invalid_history_cursors_and_page_sizes_are_rejected() {
    let (root, store, room) = history_fixture();
    add_events(&store, &room.id, 2);
    let committed = store.get(&room.id).unwrap().ledger_bytes;
    for cursor in ["invalid".to_string(), format!("v1:{}:0", committed + 1), format!("v1:{committed}:1")] {
        assert!(store.history(&room.id, Some(&cursor), Some(2)).is_err(), "{cursor}");
    }
    assert!(store.history(&room.id, None, Some(0)).is_err());
    assert!(store.history(&room.id, None, Some(201)).is_err());
    assert!(store.history("../../bad", None, Some(1)).is_err());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn history_does_not_publish_an_uncommitted_tail_after_snapshot_failure() {
    let (root, store, room) = history_fixture();
    add_events(&store, &room.id, 2);
    let before = store.get(&room.id).unwrap().ledger_bytes;
    super::store::fail_next_commit("rename");
    assert!(store.mutate(&room.id, |room| {
        let event = ledger::LedgerEvent { v: 1, id: new_id(), ts: 999, kind: ledger::CHAT_MESSAGE.into(), room_id: room.id.clone(), by: "user".into(),
            data: serde_json::json!({ "text": "uncommitted ghost", "to": [], "message_mode": "send" }) };
        ledger::apply(room, &event); room.pending.push(event); Ok(())
    }).is_err());
    assert!(fs::metadata(ledger::path(&root, &room.id).unwrap()).unwrap().len() > before);
    drop(store);
    let store = RoomStore::load(Some(root.clone()));
    let page = store.history(&room.id, None, Some(200)).unwrap();
    assert_eq!(page.ledger_bytes, before);
    assert_eq!(page.entries.len(), 2);
    assert!(page.entries.iter().all(|entry| entry.event.as_ref().unwrap().ts < 999));
    let _ = fs::remove_dir_all(root);
}

fn benchmark_root() -> PathBuf {
    PathBuf::from(std::env::var("BELFRY_BENCH_ROOT").expect("set BELFRY_BENCH_ROOT to an isolated temporary directory"))
}

/// 单独准备，再用另一个进程测加载，避免夹具分配污染启动峰值内存。
#[test]
#[ignore = "explicit startup benchmark fixture"]
fn startup_benchmark_prepare() {
    let root = benchmark_root();
    assert!(!root.exists(), "benchmark fixture directory must be new");
    let count = std::env::var("BELFRY_BENCH_EVENTS").unwrap().parse::<usize>().unwrap();
    fs::create_dir_all(&root).unwrap();
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("Benchmark", root.to_str().unwrap(), "").unwrap();
    drop(store);
    let path = ledger::path(&root, &room.id).unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut writer = BufWriter::new(fs::File::create(&path).unwrap());
    for index in 0..count {
        let pending = index % 1000 == 0;
        let event = ledger::LedgerEvent { v: 1, id: format!("{index:026x}"), ts: index as i64,
            kind: ledger::CHAT_MESSAGE.into(), room_id: room.id.clone(), by: "user".into(), data: serde_json::json!({
                "text": format!("event {index}: {}", "x".repeat(1024)),
                "to": if pending { vec!["worker"] } else { vec![] },
                "message_mode": if pending { "request_reply" } else { "send" }
            }) };
        serde_json::to_writer(&mut writer, &event).unwrap();
        writer.write_all(b"\n").unwrap();
    }
    writer.flush().unwrap();
    drop(writer);
    let mut file: serde_json::Value = serde_json::from_slice(&fs::read(root.join("rooms.json")).unwrap()).unwrap();
    file["version"] = serde_json::json!(2);
    file["rooms"][0]["messages"] = serde_json::json!([]);
    file["rooms"][0]["retainedMessages"] = serde_json::json!([]);
    file["ledgerLengths"][&room.id] = serde_json::json!(fs::metadata(path).unwrap().len());
    fs::write(root.join("rooms.json"), serde_json::to_vec(&file).unwrap()).unwrap();
    println!("prepared events={count} root={}", root.display());
}

#[test]
#[ignore = "explicit startup benchmark load"]
fn startup_benchmark_load() {
    let started = Instant::now();
    let store = RoomStore::load(Some(benchmark_root()));
    let elapsed = started.elapsed();
    let view = store.list().unwrap();
    assert!(view.load_error.is_none(), "{:?}", view.load_error);
    let room = store.get(&view.rooms[0].id).unwrap();
    assert_eq!(room.messages.len(), MAX_MESSAGES);
    println!("load_ms={:.3} replay_bytes={} messages={} retained={}", elapsed.as_secs_f64() * 1000.0,
        ledger::take_replay_bytes(), room.messages.len(), room.retained_messages.len());
    std::hint::black_box(store);
}
