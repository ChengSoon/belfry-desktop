use super::aggregate::{AnalyticsAccumulator, UsageObservation};
use super::range::{DAY_SECONDS, UsagePeriod};
use crate::agent::AgentKind;
use crate::usage::contracts::{TokenTotals, UsageQuery};
use crate::usage::timestamp::parse_rfc3339;

fn at(value: &str) -> i64 {
    parse_rfc3339(value).unwrap()
}

fn period(days: Option<u32>) -> UsagePeriod {
    UsagePeriod::new(
        &UsageQuery {
            window_days: days,
            project_root: None,
        },
        at("2026-09-12T12:00:00Z"),
    )
    .unwrap()
}

fn observation(time: Option<i64>) -> UsageObservation<'static> {
    UsageObservation {
        agent: AgentKind::Codex,
        model: "sample-model",
        at: time,
        cwd: Some("/__belfry_analytics__/中文 项目"),
        tokens: TokenTotals {
            input: 10,
            cached_input: 20,
            cache_write: 30,
            output: 40,
        },
    }
}

#[test]
fn seven_days_are_calendar_days_including_today() {
    let range = period(Some(7));
    assert_eq!(Some(at("2026-09-06T00:00:00Z")), range.start);
    assert_eq!(at("2026-09-12T12:00:01Z"), range.end);
    assert!(
        UsagePeriod::new(
            &UsageQuery {
                window_days: Some(999),
                project_root: None
            },
            0
        )
        .is_err()
    );
}

#[test]
fn boundaries_and_explicit_offsets_land_in_one_daily_bucket() {
    let mut acc = AnalyticsAccumulator::new(period(Some(7)));
    acc.record(observation(Some(at("2026-09-05T23:59:59Z"))));
    acc.record(observation(Some(at("2026-09-06T00:00:00Z"))));
    acc.record(observation(Some(at("2026-09-06T08:00:00+08:00"))));
    acc.record(observation(Some(at("2026-09-06T23:59:59Z"))));
    acc.record(observation(Some(at("2026-09-07T00:00:00Z"))));
    acc.record(observation(Some(at("2026-09-12T12:00:01Z"))));
    let result = acc.finish().unwrap();
    assert_eq!(2, result.rows.len());
    assert_eq!(Some(at("2026-09-06T00:00:00Z")), result.rows[0].day);
    assert_eq!(300, result.rows[0].tokens.total());
    assert_eq!(100, result.rows[1].tokens.total());
    assert_eq!(
        DAY_SECONDS,
        result.rows[1].day.unwrap() - result.rows[0].day.unwrap()
    );
}

#[test]
fn all_time_preserves_undated_records_without_assigning_today() {
    let mut all = AnalyticsAccumulator::new(period(None));
    all.record(observation(None));
    let result = all.finish().unwrap();
    assert_eq!(1, result.rows.len());
    assert_eq!(None, result.rows[0].day);
    assert_eq!(1, result.undated_records);
    let mut recent = AnalyticsAccumulator::new(period(Some(30)));
    recent.record(observation(None));
    let result = recent.finish().unwrap();
    assert!(result.rows.is_empty());
    assert_eq!(1, result.undated_records);
}

#[test]
fn billing_keeps_raw_models_agents_and_projects_separate() {
    let mut acc = AnalyticsAccumulator::new(period(None));
    let base = observation(Some(at("2026-09-12T00:00:00Z")));
    acc.record(base.clone());
    acc.record(UsageObservation {
        model: "sample.model",
        ..base.clone()
    });
    acc.record(UsageObservation {
        agent: AgentKind::Claude,
        ..base.clone()
    });
    acc.record(UsageObservation {
        cwd: Some("/__belfry_analytics__/另一个项目"),
        ..base.clone()
    });
    acc.record(UsageObservation { cwd: None, ..base });
    let result = acc.finish().unwrap();
    assert_eq!(5, result.rows.len());
    assert_eq!(
        500,
        result
            .rows
            .iter()
            .map(|row| row.tokens.total())
            .sum::<u64>()
    );
    assert_eq!(
        1,
        result
            .rows
            .iter()
            .filter(|row| row.project_root.is_none())
            .count()
    );
}

#[test]
fn impossible_numeric_totals_fail_instead_of_returning_rounded_counts() {
    let mut acc = AnalyticsAccumulator::new(period(None));
    acc.record(UsageObservation {
        tokens: TokenTotals {
            input: u64::MAX,
            ..TokenTotals::default()
        },
        ..observation(None)
    });
    assert!(acc.finish().is_err());
}

#[test]
fn malformed_calendar_dates_are_not_silently_shifted() {
    for value in [
        "2026-02-30T00:00:00Z",
        "2026-09-12T25:00:00Z",
        "2026-09-12T00:60:00Z",
        "2026-09-12T00:00:00+99:00",
        "2026-09-12X00:00:00Z",
        "2026-09-12T00:00:00garbage",
        "2026-09-12T+1:00:00Z",
        "2026-09-12T00:00:00++1:00",
    ] {
        assert_eq!(None, parse_rfc3339(value), "{value}");
    }
}

#[test]
#[ignore = "手动只读验证本机日志的实际用量报告，不作为跨机器基线"]
fn native_analytics_smoke() {
    let report = super::service::collect(&UsageQuery {
        window_days: Some(30),
        project_root: None,
    })
    .unwrap();
    let total: u64 = report.rows.iter().map(|row| row.tokens.total()).sum();
    println!(
        "scanned={}, skipped={}, buckets={}, tokens={}, undated={}",
        report.scanned_files,
        report.skipped_files,
        report.rows.len(),
        total,
        report.undated_records
    );
    assert!(report.generated_at > 0);
}
