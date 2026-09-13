use super::*;
use crate::usage::analytics::{aggregate::AnalyticsAccumulator, range::UsagePeriod};
use crate::usage::contracts::UsageQuery;

#[test]
fn copied_messages_keep_four_categories_and_original_bytes() {
    let root = std::env::temp_dir().join(format!("belfry-cm10-claude-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let message = serde_json::json!({
        "timestamp": "2026-09-12T08:00:00+08:00", "cwd": "/__belfry_insights__/中文 项目",
        "requestId": "request-1", "message": {
            "id": "msg-1", "role": "assistant", "model": "sample-claude",
            "usage": { "input_tokens": 10, "cache_read_input_tokens": 20,
                "cache_creation_input_tokens": 30, "output_tokens": 40 }
        }
    })
    .to_string();
    let initial = root.join("one.jsonl");
    let copied = root.join("two.jsonl");
    std::fs::write(&initial, &message).unwrap();
    std::fs::write(&copied, &message).unwrap();
    let now = parse_rfc3339("2026-09-12T12:00:00Z").unwrap();
    let mut acc = UsageAccumulator::with_analytics(AnalyticsAccumulator::new(
        UsagePeriod::new(&UsageQuery::default(), now).unwrap(),
    ));
    let mut seen = HashMap::new();
    for path in [&initial, &copied] {
        assert!(scan_file(path, &mut acc, None, None, &mut seen));
        assert_eq!(message, std::fs::read_to_string(path).unwrap());
    }
    let result = acc.finish_analytics().unwrap();
    assert_eq!(1, result.rows.len());
    assert_eq!(100, result.rows[0].tokens.total());
    assert_eq!(
        Some(parse_rfc3339("2026-09-12T00:00:00Z").unwrap()),
        result.rows[0].day
    );
    assert_eq!(1, result.rows[0].requests);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn streamed_usage_updates_count_only_the_increase() {
    let root =
        std::env::temp_dir().join(format!("belfry-cm10-claude-stream-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("stream.jsonl");
    let lines: Vec<_> = [1, 9, 1].into_iter().map(|output| serde_json::json!({
        "timestamp": "2026-09-12T00:00:00Z", "cwd": "/fixture",
        "requestId": "request", "message": { "role": "assistant", "id": "message", "model": "sample",
            "usage": { "input_tokens": 10, "cache_read_input_tokens": 20,
                "cache_creation_input_tokens": 30, "output_tokens": output } }
    }).to_string()).collect();
    std::fs::write(&path, lines.join("\n")).unwrap();
    let now = parse_rfc3339("2026-09-12T12:00:00Z").unwrap();
    let mut acc = UsageAccumulator::with_analytics(AnalyticsAccumulator::new(
        UsagePeriod::new(&UsageQuery::default(), now).unwrap(),
    ));
    assert!(scan_file(&path, &mut acc, None, None, &mut HashMap::new()));
    let rows = acc.finish_analytics().unwrap().rows;
    assert_eq!(69, rows[0].tokens.total());
    assert_eq!(9, rows[0].tokens.output);
    std::fs::remove_dir_all(root).unwrap();
}
