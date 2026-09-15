use super::{cache::SessionCache, fixtures::*};
use crate::agent::AgentKind;
use serde_json::json;
use std::fs;

#[test]
fn append_updates_only_the_new_bytes_and_retains_one_message_identity() {
    let fixture = Fixture::new();
    let path = fixture.write("native.jsonl", &[claude("message", 2)]);
    let mut cache = SessionCache::new(session(AgentKind::Claude));
    let first = cache.refresh(&[path.clone()]).unwrap();
    assert_eq!(Some(2), first.tokens.output);
    append(&path, &(claude("message", 8).to_string() + "\n"));
    let updated = cache.refresh(&[path.clone()]).unwrap();
    assert_eq!(Some(8), updated.tokens.output);
    assert_eq!(fs::metadata(&path).unwrap().len(), updated.scanned_bytes);
    let unchanged = cache.refresh(&[path]).unwrap();
    assert_eq!(updated.scanned_bytes, unchanged.scanned_bytes);
    assert_eq!(updated.tokens, unchanged.tokens);
}

#[test]
fn a_partial_json_line_is_retained_until_its_remainder_arrives() {
    let fixture = Fixture::new();
    let path = fixture.0.join("native.jsonl");
    let line = claude("message", 7).to_string();
    let half = line.len() / 2;
    fs::write(&path, &line[..half]).unwrap();
    let mut cache = SessionCache::new(session(AgentKind::Claude));
    assert_eq!(None, cache.refresh(&[path.clone()]).unwrap().tokens.output);
    append(&path, &(line[half..].to_owned() + "\n"));
    assert_eq!(Some(7), cache.refresh(&[path]).unwrap().tokens.output);
}

#[test]
fn a_complete_final_line_without_newline_is_counted_once() {
    let fixture = Fixture::new();
    let path = fixture.0.join("native.jsonl");
    fs::write(&path, claude("message", 7).to_string()).unwrap();
    let mut cache = SessionCache::new(session(AgentKind::Claude));
    assert_eq!(
        Some(7),
        cache.refresh(&[path.clone()]).unwrap().tokens.output
    );
    append(&path, "\n");
    assert_eq!(Some(7), cache.refresh(&[path]).unwrap().tokens.output);
}

#[test]
fn truncating_or_replacing_a_file_rebuilds_without_old_usage() {
    let fixture = Fixture::new();
    let path = fixture.write(
        "native.jsonl",
        &[claude("message-long", 95), claude("extra", 7)],
    );
    let mut cache = SessionCache::new(session(AgentKind::Claude));
    assert_eq!(
        Some(102),
        cache.refresh(&[path.clone()]).unwrap().tokens.output
    );
    fixture.write("native.jsonl", &[claude("new", 3)]);
    assert_eq!(
        Some(3),
        cache.refresh(&[path.clone()]).unwrap().tokens.output
    );
    let replacement = fixture.write("replacement.jsonl", &[claude("new", 9)]);
    fs::rename(replacement, &path).unwrap();
    assert_eq!(Some(9), cache.refresh(&[path]).unwrap().tokens.output);
}

#[test]
fn resume_fragments_do_not_repeat_old_cumulative_usage() {
    let fixture = Fixture::new();
    let meta = json!({"type":"session_meta","payload":{"id":"native"}});
    let first = fixture.write("a.jsonl", &[meta.clone(), codex(10)]);
    let second = fixture.write("b.jsonl", &[meta, codex(10), codex(20)]);
    let mut cache = SessionCache::new(session(AgentKind::Codex));
    assert_eq!(
        Some(20),
        cache.refresh(&[first, second]).unwrap().tokens.output
    );
}

#[test]
fn file_metadata_and_record_identity_keep_parallel_sessions_separate() {
    let fixture = Fixture::new();
    let foreign = fixture.write(
        "foreign.jsonl",
        &[
            json!({"type":"session_meta","payload":{"id":"foreign"}}),
            codex(90),
        ],
    );
    let own = fixture.write(
        "own.jsonl",
        &[
            json!({"type":"session_meta","payload":{"id":"native"}}),
            codex(2),
        ],
    );
    let mut cache = SessionCache::new(session(AgentKind::Codex));
    let result = cache.refresh(&[foreign, own]).unwrap();
    assert_eq!(Some(2), result.tokens.output);
}

#[test]
fn oversized_and_invalid_records_are_skipped_with_a_visible_partial_notice() {
    let fixture = Fixture::new();
    let path = fixture.0.join("native.jsonl");
    let text =
        "x".repeat(5 * 1024 * 1024) + "\ninvalid\n" + &claude("message", 4).to_string() + "\n";
    fs::write(&path, text).unwrap();
    let mut cache = SessionCache::new(session(AgentKind::Claude));
    let first = cache.refresh(&[path.clone()]).unwrap();
    assert!(first.pending);
    assert!(first.scanned_bytes <= 4 * 1024 * 1024);
    let last = cache.refresh(&[path]).unwrap();
    assert_eq!(Some(4), last.tokens.output);
    assert_eq!(2, last.skipped_lines);
    assert!(last.note.is_some());
}

#[test]
fn removing_all_session_logs_drops_cached_totals() {
    let fixture = Fixture::new();
    let path = fixture.write("native.jsonl", &[claude("message", 2)]);
    let mut cache = SessionCache::new(session(AgentKind::Claude));
    assert_eq!(Some(2), cache.refresh(&[path]).unwrap().tokens.output);
    let empty = cache.refresh(&[]).unwrap();
    assert_eq!(None, empty.tokens.output);
    assert!(empty.note.is_some());
}
