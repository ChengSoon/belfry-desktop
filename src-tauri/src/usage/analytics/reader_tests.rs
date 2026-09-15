use super::{
    cache::FileCache,
    cancel::Cancellation,
    contracts::ScanDiagnostics,
    fixtures::*,
    reader::{MAX_FILE_INDEX_BYTES, MAX_LINE_BYTES, ParsedLog, ReadContext, ReadTarget},
};
use crate::{agent::AgentKind, usage::contracts::UsageQuery};
use std::{cell::Cell, fs::File};

#[test]
fn unterminated_record_is_counted_once_and_partial_json_is_repaired_on_append() {
    let fixture = Fixture::new();
    let text = claude("one", 40).to_string();
    let cut = text.len() / 2;
    let path = fixture.write_text("claude/one.jsonl", &text[..cut]);
    let mut cache = FileCache::default();
    let partial = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(1, partial.diagnostics.skipped_lines);
    assert_eq!(0, total(&partial));
    append(&path, &text[cut..]);
    let complete = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(100, total(&complete));
    assert_eq!(0, complete.diagnostics.skipped_lines);
    assert_eq!((text.len() - cut) as u64, complete.diagnostics.read_bytes);
    append(&path, "\n");
    let terminated = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(semantic(&complete), semantic(&terminated));
    assert_eq!(1, terminated.diagnostics.read_bytes);
    assert_eq!(
        0,
        fixture
            .query(&mut cache, &UsageQuery::default())
            .diagnostics
            .read_bytes
    );
}

#[test]
fn oversized_and_invalid_records_are_bounded_diagnosed_and_do_not_hide_later_usage() {
    let fixture = Fixture::new();
    let oversized = "x".repeat(MAX_LINE_BYTES + 100);
    let path = fixture.write_text("claude/one.jsonl", &oversized);
    let mut cache = FileCache::default();
    let partial = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(1, partial.diagnostics.skipped_lines);
    assert!(cache.bytes < MAX_LINE_BYTES);
    append(
        &path,
        &("\n{\"usage\":bad}\n".to_string() + &lines(&[claude("one", 40)])),
    );
    let report = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(100, total(&report));
    assert_eq!(2, report.diagnostics.skipped_lines);
    assert_eq!(1, report.diagnostics.appended_files);
    assert_eq!(
        semantic(&report),
        semantic(&fixture.query(&mut cache, &UsageQuery::default()))
    );
}

#[test]
fn invalid_utf8_is_consumed_once_and_good_records_still_contribute() {
    let fixture = Fixture::new();
    let path = fixture.path.join("claude/one.jsonl");
    let mut bytes = b"{\"usage\":".to_vec();
    bytes.extend_from_slice(&[0xff, 0xfe, b'}', b'\n']);
    bytes.extend_from_slice(lines(&[claude("one", 40)]).as_bytes());
    std::fs::write(path, bytes).unwrap();
    let report = fixture.query(&mut FileCache::default(), &UsageQuery::default());
    assert_eq!(100, total(&report));
    assert_eq!(1, report.diagnostics.skipped_lines);
}

#[test]
fn cancellation_interrupts_real_file_reads_before_reaching_eof() {
    let fixture = Fixture::new();
    let text = "x".repeat(MAX_LINE_BYTES + 100);
    let path = fixture.write_text("claude/one.jsonl", &text);
    let mut file = File::open(path).unwrap();
    let mut log = ParsedLog::default();
    let mut metrics = ScanDiagnostics::default();
    let cancel = Cancellation::default();
    let checks = Cell::new(0);
    let check = || {
        checks.set(checks.get() + 1);
        if checks.get() == 6 {
            cancel.cancel();
        }
        cancel.check()
    };
    let result = log.read(
        &mut file,
        text.len() as u64,
        &mut ReadContext {
            agent: AgentKind::Claude,
            check: &check,
            metrics: &mut metrics,
            target: ReadTarget::Index(MAX_FILE_INDEX_BYTES),
        },
    );
    assert!(result.is_err());
    assert!(metrics.read_bytes > 0 && metrics.read_bytes < text.len() as u64);
    assert!(metrics.read_bytes <= 3 * 64 * 1024);
    assert_eq!(6, checks.get());
}

#[test]
fn utf8_split_across_read_chunks_preserves_the_complete_usage_record() {
    let fixture = Fixture::new();
    let mut record = claude("one", 40);
    record["message"]["model"] = serde_json::json!("模型🧪");
    record["message"]["content"] = serde_json::json!("界🧪".repeat(40_000));
    fixture.write("claude/one.jsonl", &[record]);
    let report = fixture.query(&mut FileCache::default(), &UsageQuery::default());
    assert_eq!(100, total(&report));
    assert_eq!("模型🧪", report.rows[0].model);
    assert_eq!(0, report.diagnostics.skipped_lines);
}
