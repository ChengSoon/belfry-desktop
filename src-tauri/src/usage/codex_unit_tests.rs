use super::*;

fn usage(input: u64, cached: u64, output: u64) -> Value {
    serde_json::json!({
        "input_tokens": input,
        "cached_input_tokens": cached,
        "cache_write_input_tokens": 0,
        "output_tokens": output,
        "reasoning_output_tokens": output / 2,
        "total_tokens": input + output
    })
}

#[test]
fn strips_cached_tokens_out_of_codex_input_to_match_shared_shape() {
    // 真实样本：input 含 cached，total_tokens = input + output
    let tokens = read_cumulative(&usage(117906, 90112, 1000));
    assert_eq!(tokens.input, 27794);
    assert_eq!(tokens.cached_input, 90112);
    assert_eq!(tokens.output, 1000);
    // 归一后总量必须等于日志自报的 total_tokens
    assert_eq!(tokens.total(), 118906);
}

#[test]
fn reasoning_tokens_are_not_double_counted() {
    let tokens = read_cumulative(&usage(100, 0, 40));
    assert_eq!(tokens.output, 40);
    assert_eq!(tokens.total(), 140);
}

#[test]
fn consecutive_snapshots_yield_only_the_increment() {
    let first = read_cumulative(&usage(1000, 400, 100));
    let second = read_cumulative(&usage(2500, 900, 250));
    let delta = diff(first, second);
    // 剥离缓存后 600 → 1600
    assert_eq!(delta.input, 1000);
    assert_eq!(delta.cached_input, 500);
    assert_eq!(delta.output, 150);
    // 增量之和与两次 total_tokens 之差一致
    assert_eq!(delta.total(), second.total() - first.total());
}

#[test]
fn treats_a_dropping_total_as_a_session_reset() {
    let before = read_cumulative(&usage(9000, 5000, 800));
    let after = read_cumulative(&usage(1200, 600, 90));
    // compact 后累计归零重算，整条当增量而不是负数回绕
    assert_eq!(diff(before, after), after);
}

#[test]
fn first_snapshot_counts_in_full() {
    let first = read_cumulative(&usage(500, 100, 50));
    assert_eq!(diff(TokenTotals::default(), first), first);
}

#[test]
fn reads_quota_window_and_tolerates_null_fields() {
    let limits = serde_json::json!({
        "used_percent": 63.0, "window_minutes": 10080, "resets_at": 1786880097
    });
    let window = read_window(&limits).unwrap();
    assert_eq!(window.used_percent, 63.0);
    assert_eq!(window.window_minutes, Some(10080));
    assert_eq!(window.resets_at, Some(1786880097));

    // secondary 实测恒为 null
    assert!(read_window(&Value::Null).is_none());
    // 只有 used_percent 时其余字段可缺
    let partial = read_window(&serde_json::json!({ "used_percent": 5.5 })).unwrap();
    assert_eq!(partial.window_minutes, None);
}

#[test]
fn attributes_increments_to_the_model_active_at_that_time() {
    let mut accumulator = UsageAccumulator::default();
    let mut scan = FileScan::new(None);
    let lines = [
        r#"{"timestamp":"2026-08-09T10:00:00Z","type":"turn_context","payload":{"model":"gpt-5.6-sol","cwd":"/work/belfry"}}"#,
        r#"{"timestamp":"2026-08-09T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":100}}}}"#,
        // 中途换模型：后续增量必须记给新模型
        r#"{"timestamp":"2026-08-09T10:02:00Z","type":"turn_context","payload":{"model":"gpt-5.6-mini","cwd":"/work/belfry"}}"#,
        r#"{"timestamp":"2026-08-09T10:03:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":0,"output_tokens":160}}}}"#,
    ];
    for line in lines {
        scan.consume(line, &mut accumulator, None);
    }

    scan.flush(&mut accumulator, None);
    let models = accumulator.models();
    assert_eq!(models.len(), 2);
    let sol = models.iter().find(|m| m.model == "gpt-5.6-sol").unwrap();
    let mini = models.iter().find(|m| m.model == "gpt-5.6-mini").unwrap();
    assert_eq!(sol.tokens.output, 100);
    // 只记增量 60，不是累计 160
    assert_eq!(mini.tokens.output, 60);
    assert_eq!(mini.tokens.input, 500);
}

#[test]
fn skips_usage_recorded_before_any_turn_context() {
    let mut accumulator = UsageAccumulator::default();
    let mut scan = FileScan::new(None);
    scan.consume(
        r#"{"timestamp":"2026-08-09T10:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5}}}}"#,
        &mut accumulator,
        None,
    );
    scan.flush(&mut accumulator, None);
    assert!(accumulator.models().is_empty());
}

#[test]
fn window_filter_keeps_the_delta_baseline_moving() {
    let mut accumulator = UsageAccumulator::default();
    let mut scan = FileScan::new(None);
    let cutoff = parse_rfc3339("2026-08-09T10:02:00Z");
    let lines = [
        r#"{"timestamp":"2026-08-09T10:00:00Z","type":"turn_context","payload":{"model":"m","cwd":"/work/belfry"}}"#,
        // 窗口外：不计入，但必须推进基线
        r#"{"timestamp":"2026-08-09T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":8000,"cached_input_tokens":0,"output_tokens":900}}}}"#,
        r#"{"timestamp":"2026-08-09T10:03:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":8100,"cached_input_tokens":0,"output_tokens":950}}}}"#,
    ];
    for line in lines {
        scan.consume(line, &mut accumulator, cutoff);
    }

    scan.flush(&mut accumulator, cutoff);
    let models = accumulator.models();
    assert_eq!(models.len(), 1);
    // 只算窗口内的 50/100，不把窗口前的 900/8000 带进来
    assert_eq!(models[0].tokens.output, 50);
    assert_eq!(models[0].tokens.input, 100);
}

#[test]
fn project_filter_excludes_sessions_from_other_directories() {
    let mut accumulator = UsageAccumulator::default();
    let mut scan = FileScan::new(Some("/work/other"));
    let lines = [
        r#"{"timestamp":"2026-08-09T10:00:00Z","type":"turn_context","payload":{"model":"m","cwd":"/work/belfry"}}"#,
        r#"{"timestamp":"2026-08-09T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":5}}}}"#,
    ];
    for line in lines {
        scan.consume(line, &mut accumulator, None);
    }
    scan.flush(&mut accumulator, None);
    assert!(accumulator.models().is_empty());
}
