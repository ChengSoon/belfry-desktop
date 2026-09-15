use super::{
    cache::{FileCache, FileRequest, ScanFile},
    contracts::ScanDiagnostics,
    fixtures::*,
    legacy,
    range::UsagePeriod,
    replay::Replay,
    service::{self, ScanRequest},
};
use crate::{agent::AgentKind, usage::contracts::UsageQuery};
use std::{cell::Cell, fs};

#[test]
fn streaming_uses_the_captured_eof_even_if_an_unterminated_record_is_extended() {
    let fixture = Fixture::new();
    let text = claude("one", 40).to_string();
    let path = fixture.write_text("claude/one.jsonl", &text);
    let query = UsageQuery::default();
    let expected = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let mut cache = uncached();
    let mut metrics = ScanDiagnostics::default();
    let request = FileRequest {
        path: &path,
        agent: AgentKind::Claude,
        check: &|| Ok(()),
    };
    let ScanFile::Streaming(snapshot) = cache.read(request, &mut metrics).unwrap().unwrap() else {
        panic!("zero cache budget must stream")
    };
    append(&path, &("\n".to_string() + &lines(&[claude("two", 50)])));
    let mut replay = Replay::new(UsagePeriod::new(&query, now()).unwrap(), None);
    snapshot.replay(request, &mut replay, &mut metrics).unwrap();
    let actual = replay.finish(&|| Ok(())).unwrap();
    assert_eq!(
        serde_json::to_value(expected.rows).unwrap(),
        serde_json::to_value(actual.rows).unwrap()
    );
    assert_eq!(text.len() as u64, metrics.read_bytes);
    assert_streamed_matches_legacy(&fixture, &mut cache, query);
}

#[test]
fn cancellation_stops_streaming_body_reads_before_eof_and_a_retry_is_complete() {
    let fixture = Fixture::new();
    let text = lines(&[claude("one", 40)]).repeat(10_000);
    let path = fixture.write_text("claude/one.jsonl", &text);
    let mut cache = uncached();
    let mut metrics = ScanDiagnostics::default();
    let request = FileRequest {
        path: &path,
        agent: AgentKind::Claude,
        check: &|| Ok(()),
    };
    let ScanFile::Streaming(snapshot) = cache.read(request, &mut metrics).unwrap().unwrap() else {
        panic!("zero cache budget must stream")
    };
    let checks = Cell::new(0);
    let check = || {
        checks.set(checks.get() + 1);
        if checks.get() >= 80 {
            Err("cancelled".into())
        } else {
            Ok(())
        }
    };
    let query = UsageQuery::default();
    let mut replay = Replay::new(UsagePeriod::new(&query, now()).unwrap(), None);
    let result = snapshot.replay(
        FileRequest {
            check: &check,
            ..request
        },
        &mut replay,
        &mut metrics,
    );
    assert_eq!("cancelled", result.unwrap_err());
    assert!(metrics.read_bytes > 0 && metrics.read_bytes < text.len() as u64);
    assert!(metrics.read_bytes <= 64 * 1024);
    assert_streamed_matches_legacy(&fixture, &mut cache, query);
}

#[test]
fn cancelling_a_fallback_cannot_publish_a_partial_cache_or_cursor() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let query = UsageQuery::default();
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &query);
    let before = cache.bytes;
    cache.index_budget = 2 * 1024;
    append(&path, &lines(&[claude("one", 60)]).repeat(10_000));
    let checks = Cell::new(0);
    let check = || {
        checks.set(checks.get() + 1);
        if checks.get() >= 80 {
            Err("cancelled".into())
        } else {
            Ok(())
        }
    };
    let result = service::refresh(
        &mut cache,
        ScanRequest {
            query: &query,
            roots: &fixture.roots,
            now: now(),
            check: &check,
        },
    );
    assert_eq!("cancelled", result.unwrap_err());
    assert_eq!(before, cache.bytes);
    assert_eq!(1, cache.len());
    assert_streamed_matches_legacy(&fixture, &mut cache, query);
}

#[test]
fn a_file_replaced_during_streaming_fails_the_query_instead_of_returning_partial_rows() {
    let fixture = Fixture::new();
    let path = fixture.write_text("claude/one.jsonl", &lines(&[claude("one", 40)]).repeat(128));
    let query = UsageQuery::default();
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &query);
    let before = cache.bytes;
    cache.index_budget = 0;
    let checks = Cell::new(0);
    let replacement = fixture.write("replacement.tmp", &[claude("two", 50)]);
    let check = || {
        checks.set(checks.get() + 1);
        if checks.get() == 20 {
            fs::rename(&replacement, &path).unwrap();
        }
        Ok(())
    };
    let result = service::refresh(
        &mut cache,
        ScanRequest {
            query: &query,
            roots: &fixture.roots,
            now: now(),
            check: &check,
        },
    );
    assert!(result.unwrap_err().contains("流式扫描期间"));
    assert_eq!(before, cache.bytes);
    assert_eq!(1, cache.len());
    assert_streamed_matches_legacy(&fixture, &mut cache, query);
}
