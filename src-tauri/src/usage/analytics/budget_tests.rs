use super::{
    cache::{FileCache, FileRequest, ScanFile},
    contracts::ScanDiagnostics,
    fixtures::*,
    legacy,
    range::UsagePeriod,
    records::Record,
    replay::Replay,
};
use crate::{agent::AgentKind, usage::contracts::UsageQuery};

const SMALL_INDEX: usize = 2 * 1024;
const SMALL_STATE: usize = 16 * 1024;

#[test]
fn logs_over_the_index_budget_match_legacy_on_cold_hot_and_append() {
    let fixture = Fixture::new();
    let path = fixture.write_text("claude/one.jsonl", &lines(&[claude("one", 40)]).repeat(128));
    let query = UsageQuery::default();
    let mut cache = FileCache::default();
    cache.index_budget = SMALL_INDEX;
    cache.budget = SMALL_INDEX * 2;
    for _ in 0..2 {
        let reference = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
        let report = fixture.query(&mut cache, &query);
        assert_eq!(semantic(&reference), semantic(&report));
        assert_eq!(0, cache.len());
        assert!(report.diagnostics.read_bytes > 0);
    }
    append(&path, &lines(&[claude("one", 60), claude("two", 20)]));
    let reference = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let appended = fixture.query(&mut cache, &query);
    assert_eq!(semantic(&reference), semantic(&appended));
    assert_eq!(200, total(&appended));
    assert!(cache.bytes <= cache.budget);
}

#[test]
fn repeated_records_do_not_spend_the_retained_state_budget_again() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let query = UsageQuery::default();
    let expected = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let file = FileCache::default()
        .read(
            FileRequest {
                path: &path,
                agent: AgentKind::Claude,
                check: &|| Ok(()),
            },
            &mut ScanDiagnostics::default(),
        )
        .unwrap()
        .unwrap();
    let ScanFile::Cached(file) = file else {
        panic!("small file should stay cached")
    };
    let mut replay =
        Replay::new(UsagePeriod::new(&query, now()).unwrap(), None).with_budget(SMALL_STATE);
    replay.file((&path, &file), &|| Ok(())).unwrap();
    let retained = replay.retained_bytes();
    for _ in 0..256 {
        replay.file((&path, &file), &|| Ok(())).unwrap();
        assert_eq!(retained, replay.retained_bytes());
    }
    let buckets = replay.finish(&|| Ok(())).unwrap();
    assert_eq!(
        serde_json::to_value(expected.rows).unwrap(),
        serde_json::to_value(buckets.rows).unwrap()
    );
}

#[test]
fn an_append_crossing_the_index_budget_rebuilds_without_losing_prior_usage() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let query = UsageQuery::default();
    let mut cache = FileCache::default();
    cache.index_budget = SMALL_INDEX;
    fixture.query(&mut cache, &query);
    assert_eq!(1, cache.len());
    append(&path, &lines(&[claude("one", 60)]).repeat(128));
    let report = fixture.query(&mut cache, &query);
    let expected = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    assert_eq!(semantic(&expected), semantic(&report));
    assert_eq!(0, cache.len());
    assert_eq!(0, report.diagnostics.appended_files);
}

#[test]
fn codex_duplicate_events_and_replaced_context_do_not_accumulate_memory_charges() {
    let query = UsageQuery::default();
    let mut replay =
        Replay::new(UsagePeriod::new(&query, now()).unwrap(), None).with_budget(SMALL_STATE);
    let usage = parsed(AgentKind::Codex, snapshot(Some(TIME), cumulative(100)));
    let small = parsed(AgentKind::Codex, context("fixture"));
    replay.record("session:one", &small).unwrap();
    replay.record("session:one", &usage).unwrap();
    let retained = replay.retained_bytes();
    for _ in 0..256 {
        replay.record("session:one", &usage).unwrap();
        assert_eq!(retained, replay.retained_bytes());
    }
    let large = parsed(AgentKind::Codex, context(&"x".repeat(4096)));
    replay.record("session:one", &large).unwrap();
    let peak = replay.retained_bytes();
    assert!(peak > retained);
    for _ in 0..32 {
        replay.record("session:one", &small).unwrap();
        assert!(replay.retained_bytes() <= peak);
        replay.record("session:one", &large).unwrap();
        assert_eq!(peak, replay.retained_bytes());
    }
    assert!(replay.finish(&|| Ok(())).is_ok());
}

#[test]
fn retained_state_budget_counts_unique_keys_and_actual_aggregation_buckets() {
    let query = UsageQuery::default();
    for unique_keys in [true, false] {
        let mut replay =
            Replay::new(UsagePeriod::new(&query, now()).unwrap(), None).with_budget(SMALL_STATE);
        let mut result = Ok(());
        for index in 0..256 {
            let mut record = claude("one", index + 40);
            let unique = format!("{index:04}{}", "x".repeat(256));
            if unique_keys {
                record["requestId"] = unique.into();
            } else {
                record["message"]["model"] = unique.into();
            }
            result = replay.record("file:one", &parsed(AgentKind::Claude, record));
            if result.is_err() {
                break;
            }
        }
        assert!(result.unwrap_err().contains("保留的去重与聚合状态"));
        assert!(replay.retained_bytes() > SMALL_STATE);
    }
}

fn parsed(agent: AgentKind, record: serde_json::Value) -> Record {
    Record::parse(agent, record.to_string().as_bytes())
        .unwrap()
        .unwrap()
}
