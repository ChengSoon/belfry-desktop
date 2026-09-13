use super::*;
use crate::usage::analytics::aggregate::AnalyticsAccumulator;
use crate::usage::analytics::range::UsagePeriod;
use crate::usage::contracts::UsageQuery;

fn accumulator() -> UsageAccumulator {
    let now = parse_rfc3339("2026-09-12T12:00:00Z").unwrap();
    UsageAccumulator::with_analytics(AnalyticsAccumulator::new(
        UsagePeriod::new(&UsageQuery::default(), now).unwrap(),
    ))
}

fn snapshot(at: &str, values: (u64, u64, u64)) -> String {
    serde_json::json!({ "type": "event_msg", "timestamp": at,
        "payload": { "type": "token_count", "info": { "total_token_usage": {
            "input_tokens": values.0, "cached_input_tokens": values.1, "output_tokens": values.2
        } } } })
    .to_string()
}

fn context(model: &str) -> String {
    serde_json::json!({ "type": "turn_context",
        "payload": { "model": model, "cwd": "/__belfry_insights__/project" } })
    .to_string()
}

#[test]
fn copied_earlier_snapshots_do_not_become_new_usage() {
    let mut acc = accumulator();
    let mut file = FileScan::new(None);
    let first = snapshot("2026-09-11T23:59:00Z", (100, 20, 10));
    let second = snapshot("2026-09-12T00:01:00Z", (200, 40, 20));
    for line in [context("model-a"), first.clone(), second, first] {
        file.consume(&line, &mut acc, None);
    }
    file.flush(&mut acc, None);
    let report = acc.finish_analytics().unwrap();
    assert_eq!(
        220,
        report
            .rows
            .iter()
            .map(|row| row.tokens.total())
            .sum::<u64>()
    );
}

#[test]
fn changing_models_assigns_only_each_increment_to_the_current_model() {
    let mut acc = accumulator();
    let mut file = FileScan::new(None);
    for line in [
        context("model-a"),
        snapshot("2026-09-12T00:00:00Z", (100, 20, 10)),
        context("model-b"),
        snapshot("2026-09-12T00:01:00Z", (300, 80, 30)),
    ] {
        file.consume(&line, &mut acc, None);
    }
    file.flush(&mut acc, None);
    let rows = acc.finish_analytics().unwrap().rows;
    assert_eq!(2, rows.len());
    assert_eq!(110, rows[0].tokens.total());
    assert_eq!(220, rows[1].tokens.total());
}

#[test]
fn backfilled_cache_classification_does_not_produce_an_inflated_estimate() {
    let mut acc = accumulator();
    let mut file = FileScan::new(None);
    for line in [
        context("model-a"),
        snapshot("2026-09-12T00:00:00Z", (100, 20, 10)),
        snapshot("2026-09-12T00:01:00Z", (120, 60, 20)),
    ] {
        file.consume(&line, &mut acc, None);
    }
    file.flush(&mut acc, None);
    assert!(acc.finish_analytics().is_err());
}

#[test]
fn streamed_cache_classification_is_finalized_before_counting_the_request() {
    let mut acc = accumulator();
    let mut file = FileScan::new(None);
    for line in [
        context("model-a"),
        snapshot("2026-09-11T23:59:59Z", (100, 20, 10)),
        snapshot("2026-09-12T00:00:00Z", (100, 60, 20)),
        snapshot("2026-09-12T01:00:00Z", (100, 60, 20)),
    ] {
        file.consume(&line, &mut acc, None);
    }
    file.flush(&mut acc, None);
    let rows = acc.finish_analytics().unwrap().rows;
    assert_eq!(1, rows.len());
    assert_eq!(120, rows[0].tokens.total());
    assert_eq!(40, rows[0].tokens.input);
    assert_eq!(60, rows[0].tokens.cached_input);
    assert_eq!(
        Some(parse_rfc3339("2026-09-12T00:00:00Z").unwrap()),
        rows[0].day
    );
}

#[test]
fn resume_fragments_share_the_baseline_and_keep_original_files_unchanged() {
    let directory = std::env::temp_dir().join(format!("belfry-cm10-codex-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let meta = serde_json::json!({ "type": "session_meta", "payload": {
        "id": "cm10-fixture", "cwd": "/__belfry_insights__/project"
    } })
    .to_string();
    let first = snapshot("2026-09-11T23:59:00Z", (100, 20, 10));
    let initial = [meta.clone(), context("model-a"), first.clone()].join("\n");
    let resumed = [
        meta,
        context("model-a"),
        first,
        snapshot("2026-09-12T00:01:00Z", (200, 40, 20)),
    ]
    .join("\n");
    let one = directory.join("01.jsonl");
    let two = directory.join("02.jsonl");
    std::fs::write(&one, &initial).unwrap();
    std::fs::write(&two, &resumed).unwrap();
    let mut acc = accumulator();
    let scan = scanning::scan_at(
        &directory,
        &mut acc,
        scanning::ScanOptions {
            cutoff: None,
            project_root: None,
        },
    );
    let report = acc.finish_analytics().unwrap();
    assert_eq!(2, scan.tally.scanned);
    assert_eq!(
        220,
        report
            .rows
            .iter()
            .map(|row| row.tokens.total())
            .sum::<u64>()
    );
    assert_eq!(initial, std::fs::read_to_string(&one).unwrap());
    assert_eq!(resumed, std::fs::read_to_string(&two).unwrap());
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn errors_outside_the_selected_dates_or_project_do_not_block_the_report() {
    let now = parse_rfc3339("2026-09-12T12:00:00Z").unwrap();
    let period = UsagePeriod::new(
        &UsageQuery {
            window_days: Some(7),
            project_root: None,
        },
        now,
    )
    .unwrap();
    let mut acc = UsageAccumulator::with_analytics(AnalyticsAccumulator::new(period));
    let mut file = FileScan::new(None);
    for line in [
        context("model-a"),
        snapshot("2026-09-01T00:00:00Z", (100, 20, 10)),
        snapshot("2026-09-01T00:01:00Z", (120, 60, 20)),
        snapshot("2026-09-12T00:01:00Z", (220, 80, 30)),
    ] {
        file.consume(&line, &mut acc, None);
    }
    file.flush(&mut acc, None);
    assert_eq!(110, acc.finish_analytics().unwrap().rows[0].tokens.total());
    let mut acc = accumulator();
    let mut file = FileScan::new(Some("/not-this-project"));
    for line in [
        context("model-a"),
        snapshot("2026-09-12T00:00:00Z", (100, 20, 10)),
        snapshot("2026-09-12T00:01:00Z", (120, 60, 20)),
    ] {
        file.consume(&line, &mut acc, None);
    }
    file.flush(&mut acc, None);
    assert!(acc.finish_analytics().unwrap().rows.is_empty());
}
