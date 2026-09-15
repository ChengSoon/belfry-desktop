use super::fixtures::*;
use crate::usage::contracts::UsageQuery;
use serde_json::json;

#[test]
fn streamed_logs_match_legacy_filters_resume_quota_corrections_and_tail_repair() {
    let fixture = Fixture::new();
    let claude_path = fixture.write("claude/01.jsonl", &[claude("one", 40)]);
    fixture.write("claude/02.jsonl", &[claude("one", 40)]);
    let mut quota = snapshot(None, cumulative(300));
    quota["payload"]["rate_limits"] =
        json!({"plan_type":"fixture-plan","primary":{"used_percent":42}});
    let records = [
        context("fixture"),
        snapshot(Some("2026-09-01T10:00:00Z"), cumulative(100)),
        meta("shared"),
        snapshot(Some(TIME), cumulative(200)),
        quota,
    ];
    fixture.write("codex/01.jsonl", &records);
    let text = lines(&records);
    let codex_path = fixture.write_text("codex/02.jsonl", text.trim_end());
    let mut cache = uncached();
    for round in 0..3 {
        for days in [None, Some(7), Some(30)] {
            for root in [None, Some(PROJECT), Some("/absent")] {
                assert_streamed_matches_legacy(
                    &fixture,
                    &mut cache,
                    UsageQuery {
                        window_days: days,
                        project_root: root.map(ToOwned::to_owned),
                    },
                );
            }
        }
        if round == 1 {
            let mut correction = cumulative(300);
            correction.cached_input = 100;
            correction.output = 50;
            append(
                &codex_path,
                &("\n".to_string() + &snapshot(Some(TIME), correction).to_string()),
            );
            append(
                &claude_path,
                &lines(&[claude("one", 60), claude("two", 20)]),
            );
        }
    }
    let partial = claude("three", 70).to_string();
    append(&claude_path, &partial[..partial.len() / 2]);
    assert_streamed_matches_legacy(&fixture, &mut cache, UsageQuery::default());
    append(&claude_path, &partial[partial.len() / 2..]);
    assert_streamed_matches_legacy(&fixture, &mut cache, UsageQuery::default());
}

#[test]
fn streaming_keeps_metadata_line_limits_and_escaped_prefilter_semantics() {
    for prefix_lines in [0, 7, 8] {
        let fixture = Fixture::new();
        let escaped = meta("shared")
            .to_string()
            .replace("session_meta", "\\u0073ession_meta");
        let text = "{}\n".repeat(prefix_lines)
            + &escaped
            + "\n"
            + &lines(&[context("fixture"), snapshot(Some(TIME), cumulative(100))]);
        fixture.write_text("codex/01.jsonl", &text);
        fixture.write_text("codex/02.jsonl", &text);
        assert_streamed_matches_legacy(&fixture, &mut uncached(), UsageQuery::default());
    }
}
