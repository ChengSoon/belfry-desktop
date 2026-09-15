use super::{cache::FileCache, fixtures::*};
use crate::usage::contracts::UsageQuery;
use serde_json::json;

#[test]
fn date_and_project_changes_reuse_records_without_losing_baselines_undated_usage_or_quota() {
    let fixture = Fixture::new();
    let mut quota = snapshot(None, cumulative(300));
    quota["payload"]["rate_limits"] =
        json!({"plan_type":"fixture-plan","primary":{"used_percent":42,"window_minutes":300}});
    fixture.write(
        "codex/one.jsonl",
        &[
            meta("one"),
            context("fixture"),
            snapshot(Some("2026-09-01T10:00:00Z"), cumulative(100)),
            snapshot(Some("2026-09-10T10:00:00Z"), cumulative(200)),
            quota,
        ],
    );
    let mut cache = FileCache::default();
    let all = fixture.query(&mut cache, &UsageQuery::default());
    assert_eq!(330, total(&all));
    assert_eq!(1, all.undated_records);
    let recent = fixture.query(
        &mut cache,
        &UsageQuery {
            window_days: Some(7),
            project_root: Some(PROJECT.into()),
        },
    );
    assert_eq!(110, total(&recent));
    assert_eq!(1, recent.undated_records);
    assert_eq!(0, recent.diagnostics.read_bytes);
    assert_eq!(1, recent.quotas.len());
    let absent = fixture.query(
        &mut cache,
        &UsageQuery {
            window_days: Some(7),
            project_root: Some("/unrelated".into()),
        },
    );
    assert!(absent.rows.is_empty());
    assert_eq!(0, absent.diagnostics.read_bytes);
    assert_eq!(
        serde_json::to_value(&recent.quotas).unwrap(),
        serde_json::to_value(&absent.quotas).unwrap()
    );
}

#[test]
fn claude_duplicate_filtering_keeps_original_date_and_project_semantics() {
    let fixture = Fixture::new();
    let mut earlier = claude("one", 40);
    earlier["timestamp"] = json!("2026-09-01T10:00:00Z");
    earlier["cwd"] = json!("/different-project");
    fixture.write("claude/one.jsonl", &[earlier, claude("one", 40)]);
    let mut cache = FileCache::default();
    let recent = fixture.query(
        &mut cache,
        &UsageQuery {
            window_days: Some(7),
            project_root: None,
        },
    );
    assert!(recent.rows.is_empty());
    let scoped = fixture.query(
        &mut cache,
        &UsageQuery {
            window_days: Some(7),
            project_root: Some(PROJECT.into()),
        },
    );
    assert_eq!(100, total(&scoped));
    assert_eq!(0, scoped.diagnostics.read_bytes);
    assert_eq!(1, scoped.rows[0].requests);
}

#[test]
fn invalid_cache_reclassification_remains_an_error_only_in_its_date_and_project() {
    let fixture = Fixture::new();
    let mut correction = cumulative(120);
    correction.cached_input = 60;
    fixture.write(
        "codex/one.jsonl",
        &[
            meta("one"),
            context("fixture"),
            snapshot(Some("2026-09-01T10:00:00Z"), cumulative(100)),
            snapshot(Some("2026-09-01T11:00:00Z"), correction),
            snapshot(Some(TIME), cumulative(300)),
        ],
    );
    let recent = fixture.query(
        &mut FileCache::default(),
        &UsageQuery {
            window_days: Some(7),
            project_root: None,
        },
    );
    assert_eq!(198, total(&recent));
    let result = super::service::refresh(
        &mut FileCache::default(),
        super::service::ScanRequest {
            query: &UsageQuery::default(),
            roots: &fixture.roots,
            now: now(),
            check: &|| Ok(()),
        },
    );
    assert!(result.unwrap_err().contains("缓存回溯修正"));
}

#[test]
fn session_identity_only_uses_the_first_metadata_in_the_first_eight_lines() {
    let fixture = Fixture::new();
    let prefix = "{}\n".repeat(8);
    let logs = lines(&[
        meta("shared"),
        context("fixture"),
        snapshot(Some(TIME), cumulative(100)),
    ]);
    fixture.write_text("codex/01.jsonl", &(prefix.clone() + &logs));
    fixture.write_text("codex/02.jsonl", &(prefix + &logs));
    let report = fixture.query(&mut FileCache::default(), &UsageQuery::default());
    assert_eq!(220, total(&report));
}

#[test]
fn cached_queries_match_the_original_full_scan_across_windows_projects_and_resume() {
    let fixture = Fixture::new();
    fixture.write("claude/01.jsonl", &[claude("one", 40), claude("one", 60)]);
    fixture.write("claude/02.jsonl", &[claude("one", 40), claude("two", 50)]);
    let records = [
        meta("shared"),
        context("fixture"),
        snapshot(Some("2026-09-01T10:00:00Z"), cumulative(100)),
        snapshot(Some(TIME), cumulative(200)),
    ];
    fixture.write("codex/01.jsonl", &records);
    fixture.write("codex/02.jsonl", &records);
    let mut cache = FileCache::default();
    for days in [None, Some(7), Some(30)] {
        for root in [None, Some(PROJECT), Some("/absent")] {
            let query = UsageQuery {
                window_days: days,
                project_root: root.map(ToOwned::to_owned),
            };
            let reference = super::legacy::collect_at(&query, &fixture.roots, now()).unwrap();
            assert_eq!(
                semantic(&reference),
                semantic(&fixture.query(&mut cache, &query))
            );
        }
    }
}

#[test]
fn escaped_metadata_and_context_keys_keep_the_original_scan_prefilter_semantics() {
    let fixture = Fixture::new();
    let prefix = context("ignored")
        .to_string()
        .replace("turn_context", "\\u0074urn_context")
        + "\n"
        + &meta("shared")
            .to_string()
            .replace("session_meta", "\\u0073ession_meta")
        + "\n";
    let records = lines(&[context("fixture"), snapshot(Some(TIME), cumulative(100))]);
    fixture.write_text("codex/01.jsonl", &(prefix.clone() + &records));
    fixture.write_text("codex/02.jsonl", &(prefix + &records));
    let query = UsageQuery::default();
    let reference = super::legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let cached = fixture.query(&mut FileCache::default(), &query);
    assert_eq!(110, total(&cached));
    assert_eq!(semantic(&reference), semantic(&cached));
}

#[test]
fn identical_paths_in_different_agent_roots_do_not_share_the_wrong_parser() {
    let mut fixture = Fixture::new();
    fixture.roots.codex = fixture.roots.claude.clone();
    fixture.write(
        "claude/one.jsonl",
        &[
            meta("one"),
            context("fixture"),
            claude("one", 40),
            snapshot(Some(TIME), cumulative(100)),
        ],
    );
    let query = UsageQuery::default();
    let reference = super::legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let mut cache = FileCache::default();
    let cold = fixture.query(&mut cache, &query);
    assert_eq!(210, total(&cold));
    assert_eq!(semantic(&reference), semantic(&cold));
    let hot = fixture.query(&mut cache, &query);
    assert_eq!(2, hot.diagnostics.cache_hits);
    assert_eq!(0, hot.diagnostics.read_bytes);
    assert_eq!(semantic(&cold), semantic(&hot));
}
