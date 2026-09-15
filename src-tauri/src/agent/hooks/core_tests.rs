use super::{contracts::HookInput, input::from_payload, machine::Machine};
use crate::agent::contracts::{AgentKind, AgentLifecycleState as State, AgentStateSource};
use serde_json::json;

fn event(name: &str, time: i64) -> HookInput {
    HookInput {
        event: name.into(),
        session_id: "native-a".into(),
        occurred_at: time,
        ..Default::default()
    }
}

fn started() -> Machine {
    let mut machine = Machine::new(AgentKind::Codex);
    machine.apply(event("SessionStart", 1));
    machine.apply(event("UserPromptSubmit", 2));
    machine
}

#[test]
fn primary_session_is_bound_without_claiming_the_first_response_finished() {
    let mut machine = Machine::new(AgentKind::Codex);
    let changed = machine.apply(event("SessionStart", 1));
    assert!(changed.is_some());
    let snapshot = machine.snapshot();
    assert_eq!(
        Some("native-a"),
        snapshot.session.as_ref().map(|session| session.id.as_str())
    );
    assert_eq!(AgentStateSource::Hook, snapshot.source);
    assert_eq!(State::Unknown, snapshot.state);
}

#[test]
fn another_native_session_or_subagent_cannot_change_the_primary_status() {
    let mut machine = started();
    let mut other = event("Stop", 3);
    other.session_id = "native-b".into();
    assert!(machine.apply(other).is_none());
    let mut child = event("Stop", 4);
    child.agent_id = Some("child".into());
    assert!(machine.apply(child).is_none());
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn another_tool_finishing_does_not_clear_pending_permission() {
    let mut machine = started();
    let mut waiting = event("PermissionRequest", 3);
    waiting.tool_key = Some("permission-tool".into());
    machine.apply(waiting);
    let mut done = event("PostToolUse", 4);
    done.tool_key = Some("other-tool".into());
    machine.apply(done.clone());
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
    machine.apply(event("Stop", 5));
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
    done.tool_key = Some("permission-tool".into());
    done.occurred_at = 6;
    machine.apply(done);
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn duplicate_stop_and_old_turn_events_do_not_repeat_completion() {
    let mut machine = started();
    let mut prompt = event("UserPromptSubmit", 3);
    prompt.turn_id = Some("turn-a".into());
    machine.apply(prompt.clone());
    let mut stop = event("Stop", 4);
    stop.turn_id = Some("turn-a".into());
    assert!(machine.apply(stop.clone()).is_some());
    assert_eq!(State::Completed, machine.snapshot().state);
    stop.occurred_at = 5;
    assert!(machine.apply(stop.clone()).is_none());
    prompt.turn_id = Some("turn-b".into());
    prompt.occurred_at = 6;
    machine.apply(prompt);
    stop.occurred_at = 7;
    assert!(machine.apply(stop).is_none());
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn tool_failure_is_recoverable_but_turn_failure_and_interrupt_are_not_completion() {
    let mut machine = started();
    machine.apply(event("PostToolUseFailure", 3));
    assert_eq!(State::Processing, machine.snapshot().state);
    machine.apply(event("StopFailure", 4));
    assert_eq!(State::Failed, machine.snapshot().state);
    machine.apply(event("UserPromptSubmit", 5));
    machine.apply(event("Interrupt", 6));
    assert_eq!(State::Interrupted, machine.snapshot().state);
}

#[test]
fn late_delivery_and_background_pause_cannot_announce_completion() {
    let mut machine = started();
    assert!(machine.apply(event("Stop", 1)).is_none());
    let mut stop = event("Stop", 3);
    stop.background_work = true;
    machine.apply(stop);
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn clear_can_bind_a_new_primary_session_and_old_session_cannot_return() {
    let mut machine = started();
    let mut clear = event("SessionStart", 3);
    clear.source = Some("clear".into());
    clear.session_id = "native-next".into();
    machine.apply(clear);
    assert_eq!(
        Some("native-next"),
        machine
            .snapshot()
            .session
            .as_ref()
            .map(|session| session.id.as_str())
    );
    assert!(machine.apply(event("Stop", 4)).is_none());
}

#[test]
fn payload_reduction_omits_private_prompt_arguments_output_and_error() {
    let raw = json!({"hook_event_name":"PermissionRequest", "session_id":"native-a",
        "prompt":"secret-prompt", "tool_name":"Bash", "tool_input":{"command":"secret-command"},
        "tool_response":"secret-output", "error":"secret-error", "turn_id":"turn-a"});
    let input = from_payload(raw.to_string().as_bytes(), 123);
    assert!(input.is_some());
    let input = input.unwrap();
    assert_eq!(Some("Bash"), input.tool_name.as_deref());
    assert!(input.tool_key.is_some());
    let reduced = serde_json::to_string(&input).unwrap();
    assert!(!reduced.contains("secret-"));
    assert_eq!(123, input.occurred_at);
}

#[test]
fn malformed_and_unsupported_payloads_are_ignored() {
    for value in [
        "not-json",
        "[]",
        r#"{"hook_event_name":"Stop","session_id":"../bad"}"#,
        r#"{"hook_event_name":"SubagentStop","session_id":"valid"}"#,
    ] {
        assert!(from_payload(value.as_bytes(), 1).is_none());
    }
}
