use super::{aggregate::Accumulator, contracts::SessionTokens};
use crate::agent::{AgentKind, AgentSessionRef};
use serde_json::{Value, json};

fn accumulator(agent: AgentKind) -> Accumulator {
    Accumulator::new(AgentSessionRef {
        agent,
        id: "native".into(),
    })
}

fn codex_usage(input: u64, cached: u64, output: u64) -> Value {
    json!({"type":"event_msg", "payload":{"type":"token_count", "info":{"total_token_usage":{
        "input_tokens":input,"cached_input_tokens":cached,"output_tokens":output,"reasoning_output_tokens":3
    }}}})
}

fn claude_message(id: &str, output: u64) -> Value {
    json!({"type":"assistant", "sessionId":"native", "timestamp":"2026-09-11T10:00:00Z",
        "requestId":"request", "message":{"role":"assistant","id":id,"model":"claude-test",
        "usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":5,"output_tokens":output}}})
}

#[test]
fn codex_subtracts_cached_input_without_counting_reasoning_twice() {
    let mut stats = accumulator(AgentKind::Codex);
    stats.consume(&json!({"type":"turn_context","payload":{"model":"gpt-test"}}));
    stats.consume(&codex_usage(100, 40, 12));
    let result = stats.report();
    assert_eq!(
        SessionTokens {
            input: Some(60),
            cached_input: Some(40),
            cache_write: None,
            output: Some(12)
        },
        result.tokens
    );
    assert_eq!(Some("gpt-test"), result.current_model.as_deref());
}

#[test]
fn codex_only_counts_new_usage_and_keeps_both_sides_of_a_reset() {
    let mut stats = accumulator(AgentKind::Codex);
    stats.consume(&codex_usage(100, 40, 12));
    stats.consume(&codex_usage(100, 40, 12));
    stats.consume(&codex_usage(200, 80, 20));
    stats.consume(&codex_usage(50, 10, 5));
    assert_eq!(Some(160), stats.report().tokens.input);
    assert_eq!(Some(90), stats.report().tokens.cached_input);
    assert_eq!(Some(25), stats.report().tokens.output);
}

#[test]
fn codex_cache_ratio_change_is_not_a_cumulative_reset() {
    let mut stats = accumulator(AgentKind::Codex);
    stats.consume(&codex_usage(100, 0, 10));
    stats.consume(&codex_usage(120, 100, 20));
    assert_eq!(Some(20), stats.report().tokens.output);
    assert_eq!(Some(100), stats.report().tokens.cached_input);
}

#[test]
fn missing_fields_remain_unavailable_instead_of_zero() {
    let mut stats = accumulator(AgentKind::Codex);
    stats.consume(
        &json!({"type":"event_msg","payload":{"type":"token_count","info":{
        "total_token_usage":{"input_tokens":100,"output_tokens":4}}}}),
    );
    assert_eq!(None, stats.report().tokens.input);
    assert_eq!(None, stats.report().tokens.cached_input);
    assert_eq!(Some(4), stats.report().tokens.output);
}

#[test]
fn claude_streaming_usage_updates_one_message_instead_of_double_counting() {
    let mut stats = accumulator(AgentKind::Claude);
    stats.consume(&claude_message("message-a", 1));
    stats.consume(&claude_message("message-a", 9));
    stats.consume(&claude_message("message-a", 9));
    stats.consume(&claude_message("message-b", 2));
    assert_eq!(
        SessionTokens {
            input: Some(20),
            cached_input: Some(40),
            cache_write: Some(10),
            output: Some(11)
        },
        stats.report().tokens
    );
    assert!(stats.report().updated_at.is_some());
}

#[test]
fn claude_ignores_other_native_sessions_subagents_and_synthetic_errors() {
    let mut stats = accumulator(AgentKind::Claude);
    let mut other = claude_message("other", 80);
    other["sessionId"] = json!("foreign");
    let mut child = claude_message("child", 90);
    child["isSidechain"] = json!(true);
    let mut error = claude_message("error", 0);
    error["message"]["model"] = json!("<synthetic>");
    for record in [other, child, error] {
        stats.consume(&record);
    }
    assert_eq!(SessionTokens::default(), stats.report().tokens);
    assert!(stats.report().models.is_empty());
}

#[test]
fn tool_call_ids_deduplicate_streaming_and_result_records() {
    let mut stats = accumulator(AgentKind::Claude);
    let mut message = claude_message("message", 1);
    message["message"]["content"] = json!([
        {"type":"tool_use","id":"call-a","name":"Bash"},
        {"type":"tool_use","id":"call-b","name":"Bash"}]);
    stats.consume(&message);
    stats.consume(&message);
    stats.consume(
        &json!({"type":"user","sessionId":"native","message":{"content":[
        {"type":"tool_result","tool_use_id":"call-a"}]}}),
    );
    assert_eq!(Some(2), stats.report().tool_count);
    assert_eq!(2, stats.report().tools[0].calls);
}

#[test]
fn codex_custom_and_function_calls_count_once_each() {
    let mut stats = accumulator(AgentKind::Codex);
    for kind in ["function_call", "custom_tool_call"] {
        let record = json!({"type":"response_item","payload":{"type":kind,"call_id":kind,"name":"apply_patch"}});
        stats.consume(&record);
        stats.consume(&record);
    }
    assert_eq!(Some(2), stats.report().tool_count);
    assert_eq!(2, stats.report().tools[0].calls);
}

#[test]
fn missing_tool_identity_is_reported_as_partial() {
    let mut stats = accumulator(AgentKind::Codex);
    stats
        .consume(&json!({"type":"response_item","payload":{"type":"function_call","name":"Bash"}}));
    assert_eq!(None, stats.report().tool_count);
    assert!(stats.report().note.is_some());
}
