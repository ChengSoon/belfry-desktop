use super::{cache::FileCache, contracts::AnalyticsReport, fixtures::*, legacy};
use crate::usage::contracts::UsageQuery;
use serde_json::json;
use std::time::Instant;

const FILES: usize = 247;
const NOISE_LINES: usize = 128;
const NOISE_BYTES: usize = 2048;
const USAGE_INTERVAL: usize = 16;

fn corpus(fixture: &Fixture) -> u64 {
    let noise = json!({"type":"fixture_noise","text":"x".repeat(NOISE_BYTES)}).to_string() + "\n";
    let mut bytes = 0;
    for index in 0..FILES {
        let codex = index % 2 == 0;
        let agent = if codex { "codex" } else { "claude" };
        let mut text = if codex {
            lines(&[meta(&format!("session-{index}")), context("fixture-codex")])
        } else {
            String::new()
        };
        for line in 0..NOISE_LINES {
            text.push_str(&noise);
            if line % USAGE_INTERVAL == 0 {
                let usage = if codex {
                    snapshot(Some(TIME), cumulative((line + 1) as u64 * 100))
                } else {
                    claude(&format!("message-{index}-{line}"), 40)
                };
                text.push_str(&lines(&[usage]));
            }
        }
        bytes += text.len() as u64;
        fixture.write_text(&format!("{agent}/{index:04}.jsonl"), &text);
    }
    bytes
}

#[test]
#[ignore = "可复现性能验证：247 个临时日志，同一 test 构建模式，输出汇总指标"]
fn incremental_cache_benchmark() {
    let fixture = Fixture::new();
    let source_bytes = corpus(&fixture);
    let query = UsageQuery {
        window_days: Some(30),
        project_root: None,
    };
    let mut cache = FileCache::default();
    let start = Instant::now();
    let reference = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let reference_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let cold = fixture.query(&mut cache, &query);
    let cold_ms = start.elapsed().as_secs_f64() * 1000.0;
    let start = Instant::now();
    let hot = fixture.query(&mut cache, &query);
    let hot_ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(semantic(&reference), semantic(&cold));
    assert_eq!(semantic(&cold), semantic(&hot));
    assert_eq!(source_bytes, cold.diagnostics.read_bytes);
    assert_eq!(
        (0, 0, 0),
        (
            hot.diagnostics.read_bytes,
            hot.diagnostics.validation_bytes,
            hot.diagnostics.parsed_lines
        )
    );
    let added = lines(&[snapshot(Some(TIME), cumulative(15_000))]);
    append(&fixture.path.join("codex/0000.jsonl"), &added);
    let start = Instant::now();
    let appended = fixture.query(&mut cache, &query);
    let append_ms = start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(added.len() as u64, appended.diagnostics.read_bytes);
    assert_eq!(
        semantic(&legacy::collect_at(&query, &fixture.roots, now()).unwrap()),
        semantic(&appended)
    );
    println!(
        "{}",
        json!({
            "mode":if cfg!(debug_assertions) { "debug/test" } else { "release/test" },
            "files":FILES,"sourceBytes":source_bytes,"referenceMs":reference_ms,"coldMs":cold_ms,"hotMs":hot_ms,"appendMs":append_ms,
            "cold":cold.diagnostics,"hot":hot.diagnostics,"append":appended.diagnostics,
            "cacheBytes":cache.bytes,"cacheEntries":cache.len(),"semanticComparison":"equal",
            "note":"合成临时日志；冷指解析缓存未建立，操作系统页缓存已暖；未读取用户日志正文"
        })
    );
}

#[test]
#[ignore = "大日志兼容性基准：单文件超过旧索引/累计重放上限，重复消息只保留一个去重键"]
fn oversized_duplicate_log_benchmark() {
    const ID_BYTES: usize = 32 * 1024;
    const COPIES: usize = 1024;
    let fixture = Fixture::new();
    let id = "x".repeat(ID_BYTES);
    let line = lines(&[claude(&id, 40)]);
    let source_bytes = line.len() * COPIES;
    let path = fixture.write_text("claude/one.jsonl", &line.repeat(COPIES));
    let query = UsageQuery::default();
    let start = Instant::now();
    let reference = legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let reference_ms = start.elapsed().as_secs_f64() * 1000.0;
    let mut cache = FileCache::default();
    let (cold, cold_ms) = measured(&fixture, &mut cache, &query);
    let (hot, hot_ms) = measured(&fixture, &mut cache, &query);
    assert_eq!(semantic(&reference), semantic(&cold));
    assert_eq!(semantic(&cold), semantic(&hot));
    assert_eq!(0, cache.len());
    assert!(cold.diagnostics.read_bytes >= source_bytes as u64);
    assert!(hot.diagnostics.read_bytes >= source_bytes as u64);
    let added = lines(&[claude(&id, 60)]);
    append(&path, &added);
    let (appended, append_ms) = measured(&fixture, &mut cache, &query);
    assert_eq!(
        semantic(&legacy::collect_at(&query, &fixture.roots, now()).unwrap()),
        semantic(&appended)
    );
    assert_eq!(120, total(&appended));
    assert_eq!(0, cache.bytes);
    println!(
        "{}",
        json!({
            "mode":if cfg!(debug_assertions) { "debug/test" } else { "release/test" },
            "scenario":"oversized-duplicate-log", "files":1, "records":COPIES, "uniqueMessages":1,
            "sourceBytes":source_bytes, "appendBytes":added.len(), "referenceMs":reference_ms,
            "coldMs":cold_ms,"hotMs":hot_ms,"appendMs":append_ms,
            "cold":cold.diagnostics,"hot":hot.diagnostics,"append":appended.diagnostics,
            "cacheBytes":cache.bytes,"cacheEntries":cache.len(),"semanticComparison":"equal",
            "note":"默认预算；同一 debug/test 构建、合成重复日志、页缓存已暖；超预算文件不缓存，后续查询完整流式重读"
        })
    );
}

fn measured(
    fixture: &Fixture,
    cache: &mut FileCache,
    query: &UsageQuery,
) -> (AnalyticsReport, f64) {
    let start = Instant::now();
    let report = fixture.query(cache, query);
    (report, start.elapsed().as_secs_f64() * 1000.0)
}
