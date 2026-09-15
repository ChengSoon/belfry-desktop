use super::{
    cache::{FileCache, FileRequest, ScanFile},
    contracts::ScanDiagnostics,
    fixtures::*,
    service::{self, ScanRequest},
};
use crate::{agent::AgentKind, usage::contracts::UsageQuery};
use std::{cell::Cell, fs};

#[test]
fn unchanged_queries_reuse_records_without_reading_or_parsing_body() {
    let fixture = Fixture::new();
    fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    fixture.write(
        "codex/one.jsonl",
        &[
            meta("one"),
            context("fixture-codex"),
            snapshot(Some(TIME), cumulative(100)),
        ],
    );
    let mut cache = FileCache::default();
    let cold = fixture.query(&mut cache, &UsageQuery::default());
    let hot = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(210, total(&cold));
    assert_eq!(semantic(&cold), semantic(&hot));
    assert!(cold.diagnostics.read_bytes > 0);
    assert_eq!(
        (0, 0, 0, 2),
        (
            hot.diagnostics.read_bytes,
            hot.diagnostics.validation_bytes,
            hot.diagnostics.parsed_lines,
            hot.diagnostics.cache_hits
        )
    );
    assert_eq!(2, cache.len());
}

#[test]
fn appended_codex_stream_corrections_replay_the_original_cumulative_baseline() {
    let fixture = Fixture::new();
    let mut tokens = cumulative(100);
    let path = fixture.write(
        "codex/one.jsonl",
        &[
            meta("one"),
            context("fixture"),
            snapshot(Some(TIME), tokens),
        ],
    );
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    tokens.cached_input = 60;
    tokens.output = 20;
    let added = lines(&[snapshot(Some("2026-09-14T11:00:00Z"), tokens)]);
    append(&path, &added);
    let report = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(120, total(&report));
    assert_eq!(40, report.rows[0].tokens.input);
    assert_eq!(60, report.rows[0].tokens.cached_input);
    assert_eq!(1, report.rows[0].requests);
    assert_eq!(added.len() as u64, report.diagnostics.read_bytes);
    assert_eq!(1, report.diagnostics.parsed_lines);
    assert_eq!(1, report.diagnostics.appended_files);
    assert!(report.diagnostics.validation_bytes <= 1024);
    assert_eq!(
        semantic(&report),
        semantic(&fixture.query(&mut FileCache::default(), &UsageQuery::default()))
    );
}

#[test]
fn copied_claude_messages_and_codex_resume_fragments_stay_deduplicated() {
    let fixture = Fixture::new();
    let claude_path = fixture.write("claude/01.jsonl", &[claude("one", 40)]);
    let first = [
        meta("session"),
        context("fixture"),
        snapshot(Some(TIME), cumulative(100)),
    ];
    fixture.write("codex/01.jsonl", &first);
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    append(
        &claude_path,
        &lines(&[claude("one", 60), claude("one", 40)]),
    );
    fixture.write("claude/02.jsonl", &[claude("one", 60)]);
    let resumed = [
        first.to_vec(),
        vec![snapshot(Some("2026-09-14T11:00:00Z"), cumulative(200))],
    ]
    .concat();
    fixture.write("codex/02.jsonl", &resumed);
    let report = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(340, total(&report));
    assert_eq!(1, report.diagnostics.cache_hits);
    assert_eq!(
        semantic(&report),
        semantic(&fixture.query(&mut FileCache::default(), &UsageQuery::default()))
    );
}

#[test]
fn truncation_same_length_rewrite_atomic_replacement_and_deletion_invalidate() {
    const REWRITE_TIME_STEP: std::time::Duration = std::time::Duration::from_secs(1);
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let mut modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    for output in [5, 6] {
        fs::write(&path, lines(&[claude("one", output)])).unwrap();
        // 连续写入可能落在同一文件时钟刻度，显式推进时间以验证元数据变更失效。
        modified += REWRITE_TIME_STEP;
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        let report = fixture.query(&mut cache, &UsageQuery::default());
        assert_eq!(60 + output, total(&report));
        assert_eq!(0, report.diagnostics.cache_hits);
        assert_eq!(0, report.diagnostics.appended_files);
    }
    let replacement = fixture.write("replacement.tmp", &[claude("different", 70)]);
    fs::rename(replacement, &path).unwrap();
    let replaced = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(130, total(&replaced));
    assert_eq!(0, replaced.diagnostics.appended_files);
    fs::remove_file(path).unwrap();
    assert!(
        fixture
            .query(&mut cache, &UsageQuery::default())
            .rows
            .is_empty()
    );
    assert_eq!(0, cache.len());
    assert_eq!(0, cache.bytes);
}

#[test]
fn growing_in_place_replacement_falls_back_when_boundary_bytes_change() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("first", 40)]);
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    let changed = lines(&[claude("new-first", 50), claude("new-second", 60)]);
    fs::write(path, &changed).unwrap();
    let report = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(230, total(&report));
    assert_eq!(changed.len() as u64, report.diagnostics.read_bytes);
    assert_eq!(0, report.diagnostics.appended_files);
}

#[test]
fn unreadable_file_does_not_return_a_previously_cached_record() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let result = cache
        .read(
            FileRequest {
                path: &path,
                agent: AgentKind::Claude,
                check: &|| Ok(()),
            },
            &mut ScanDiagnostics::default(),
        )
        .unwrap();
    assert!(result.is_none());
    assert_eq!(0, cache.len());
}

#[test]
fn cancelled_append_cannot_commit_a_partial_cursor_or_evict_completed_files() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    let before = cache.bytes;
    let added = " ".repeat(4 * 1024 * 1024) + "\n" + &lines(&[claude("two", 50)]);
    append(&path, &added);
    let checks = Cell::new(0);
    let check = || {
        checks.set(checks.get() + 1);
        if checks.get() > 20 {
            Err("cancelled".into())
        } else {
            Ok(())
        }
    };
    assert!(
        service::refresh(
            &mut cache,
            ScanRequest {
                query: &UsageQuery::default(),
                roots: &fixture.roots,
                now: now(),
                check: &check
            }
        )
        .is_err()
    );
    assert_eq!(before, cache.bytes);
    assert_eq!(1, cache.len());
    let report = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(210, total(&report));
    assert_eq!(added.len() as u64, report.diagnostics.read_bytes);
    assert_eq!(1, report.diagnostics.appended_files);
}

#[test]
fn cache_eviction_is_bounded_and_rebuilds_complete_statistics() {
    let fixture = Fixture::new();
    fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let mut cache = FileCache::default();
    fixture.query(&mut cache, &UsageQuery::default());
    cache.budget = cache.bytes + 128;
    fixture.write("claude/two.jsonl", &[claude("two", 50)]);
    let report = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(210, total(&report));
    assert_eq!(1, cache.len());
    assert!(cache.bytes <= cache.budget);
    assert_eq!(
        semantic(&report),
        semantic(&fixture.query(&mut cache, &UsageQuery::default()))
    );
}

#[test]
fn a_file_growing_during_the_scan_keeps_a_complete_snapshot_and_reads_the_rest_next_time() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let initial_len = fs::metadata(&path).unwrap().len();
    let added = lines(&[claude("two", 50)]);
    let checks = Cell::new(0);
    let check = || {
        checks.set(checks.get() + 1);
        if checks.get() == 2 {
            append(&path, &added);
        }
        Ok(())
    };
    let mut cache = FileCache::default();
    let first = cache
        .read(
            FileRequest {
                path: &path,
                agent: AgentKind::Claude,
                check: &check,
            },
            &mut ScanDiagnostics::default(),
        )
        .unwrap()
        .unwrap();
    let ScanFile::Cached(first) = first else {
        panic!("small file should stay cached")
    };
    assert_eq!(initial_len, first.log.offset);
    assert_eq!(1, first.log.records().count());
    let next = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(210, total(&next));
    assert_eq!(added.len() as u64, next.diagnostics.read_bytes);
    assert_eq!(1, next.diagnostics.appended_files);
}
