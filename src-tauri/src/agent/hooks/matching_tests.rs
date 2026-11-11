use super::{input::from_payload, machine::Machine};
use crate::agent::contracts::{AgentKind, AgentLifecycleState as State};
use serde_json::{Value, json};

fn apply(machine: &mut Machine, event: &str, id: Option<&str>, tool: &str, args: Value, at: i64) {
    let payload = json!({
        "hook_event_name": event,
        "session_id": "native",
        "tool_use_id": id,
        "tool_name": tool,
        "tool_input": args,
    });
    machine.apply(from_payload(payload.to_string().as_bytes(), at).unwrap());
}

#[test]
fn claude_question_answer_clears_the_permission_event_that_omits_the_tool_id() {
    let mut machine = Machine::new(AgentKind::Claude);
    let args = json!({"questions": [{"question": "How should members connect?"}]});
    apply(
        &mut machine,
        "PreToolUse",
        Some("question-1"),
        "AskUserQuestion",
        args.clone(),
        1,
    );
    // Claude's PermissionRequest includes the same input, but no tool_use_id.
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "AskUserQuestion",
        args,
        2,
    );
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
    // The native tool can also add answers to its input before PostToolUse.
    apply(
        &mut machine,
        "PostToolUse",
        Some("question-1"),
        "AskUserQuestion",
        json!({"questions": [{"question": "How should members connect?"}], "answers": {"Transport": "Direct TLS"}}),
        3,
    );
    assert_eq!(State::Processing, machine.snapshot().state);
    let stop = json!({"hook_event_name": "Stop", "session_id": "native"});
    machine.apply(from_payload(stop.to_string().as_bytes(), 4).unwrap());
    assert_eq!(State::Completed, machine.snapshot().state);
}

#[test]
fn permission_without_a_pre_tool_event_can_match_the_result_input() {
    let mut machine = Machine::new(AgentKind::Claude);
    let args = json!({"command": "ls", "description": "Inspect files"});
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "Bash",
        args.clone(),
        1,
    );
    apply(&mut machine, "PostToolUse", Some("bash-1"), "Bash", args, 2);
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn unrelated_tool_completion_preserves_a_permission_without_a_tool_id() {
    let mut machine = Machine::new(AgentKind::Claude);
    let args = json!({"command": "ls"});
    apply(
        &mut machine,
        "PreToolUse",
        Some("waiting"),
        "Bash",
        args.clone(),
        1,
    );
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "Bash",
        args.clone(),
        2,
    );
    apply(
        &mut machine,
        "PreToolUse",
        Some("other"),
        "Bash",
        json!({"command": "pwd"}),
        3,
    );
    apply(
        &mut machine,
        "PostToolUse",
        Some("other"),
        "Bash",
        json!({"command": "pwd"}),
        4,
    );
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
    apply(
        &mut machine,
        "PostToolUseFailure",
        Some("waiting"),
        "Bash",
        args,
        5,
    );
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn identical_parallel_tool_inputs_remain_waiting_until_all_candidates_finish() {
    let mut machine = Machine::new(AgentKind::Claude);
    let args = json!({"command": "ls"});
    apply(
        &mut machine,
        "PreToolUse",
        Some("one"),
        "Bash",
        args.clone(),
        1,
    );
    apply(
        &mut machine,
        "PreToolUse",
        Some("two"),
        "Bash",
        args.clone(),
        2,
    );
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "Bash",
        args.clone(),
        3,
    );
    apply(
        &mut machine,
        "PostToolUse",
        Some("one"),
        "Bash",
        args.clone(),
        4,
    );
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
    apply(&mut machine, "PostToolUse", Some("two"), "Bash", args, 5);
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn answering_one_question_preserves_another_pending_permission() {
    let mut machine = Machine::new(AgentKind::Claude);
    let question = json!({"questions": [{"question": "Continue?"}]});
    let command = json!({"command": "ls"});
    apply(
        &mut machine,
        "PreToolUse",
        Some("question"),
        "AskUserQuestion",
        question.clone(),
        1,
    );
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "AskUserQuestion",
        question.clone(),
        2,
    );
    apply(
        &mut machine,
        "PreToolUse",
        Some("command"),
        "Bash",
        command.clone(),
        3,
    );
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "Bash",
        command.clone(),
        4,
    );
    apply(
        &mut machine,
        "PostToolUse",
        Some("question"),
        "AskUserQuestion",
        question,
        5,
    );
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
    apply(
        &mut machine,
        "PostToolUse",
        Some("command"),
        "Bash",
        command,
        6,
    );
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn input_rewritten_after_pre_tool_use_matches_the_permission_and_result() {
    let mut machine = Machine::new(AgentKind::Claude);
    apply(
        &mut machine,
        "PreToolUse",
        Some("command"),
        "Bash",
        json!({"command": "ls"}),
        1,
    );
    let rewritten = json!({"command": "ls -l"});
    apply(
        &mut machine,
        "PermissionRequest",
        None,
        "Bash",
        rewritten.clone(),
        2,
    );
    apply(
        &mut machine,
        "PostToolUse",
        Some("command"),
        "Bash",
        rewritten,
        3,
    );
    assert_eq!(State::Processing, machine.snapshot().state);
}

#[test]
fn a_new_turn_or_lifecycle_reset_drops_previous_tool_candidates() {
    for reset in [
        "UserPromptSubmit",
        "SessionStart",
        "Stop",
        "StopFailure",
        "Interrupt",
        "SessionEnd",
    ] {
        let mut machine = Machine::new(AgentKind::Claude);
        let args = json!({"command": "ls"});
        apply(
            &mut machine,
            "PreToolUse",
            Some("previous"),
            "Bash",
            args.clone(),
            1,
        );
        let payload = json!({"hook_event_name": reset, "session_id": "native"});
        machine.apply(from_payload(payload.to_string().as_bytes(), 2).unwrap());
        apply(
            &mut machine,
            "PreToolUse",
            Some("current"),
            "Bash",
            args.clone(),
            3,
        );
        apply(
            &mut machine,
            "PermissionRequest",
            None,
            "Bash",
            args.clone(),
            4,
        );
        apply(
            &mut machine,
            "PostToolUse",
            Some("current"),
            "Bash",
            args,
            5,
        );
        assert_eq!(State::Processing, machine.snapshot().state, "{reset}");
    }
}
