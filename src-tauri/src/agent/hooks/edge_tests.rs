use super::{contracts::HookInput, machine::Machine};
use crate::agent::contracts::{AgentKind, AgentLifecycleState as State};

fn event(name: &str, time: i64) -> HookInput {
    HookInput {
        event: name.into(),
        session_id: "main".into(),
        occurred_at: time,
        ..Default::default()
    }
}

#[test]
fn interrupting_a_parallel_tool_does_not_release_another_permission_prompt() {
    let mut machine = Machine::new(AgentKind::Claude);
    machine.apply(event("UserPromptSubmit", 1));
    let mut permission = event("PermissionRequest", 2);
    permission.tool_key = Some("waiting".into());
    machine.apply(permission);
    let mut interrupted = event("PostToolUseFailure", 3);
    interrupted.tool_key = Some("other".into());
    interrupted.is_interrupt = true;
    machine.apply(interrupted);
    assert_eq!(State::AwaitingInput, machine.snapshot().state);
}

#[test]
fn changing_native_identity_drops_the_previous_transcript_path() {
    let mut machine = Machine::new(AgentKind::Codex);
    let mut start = event("SessionStart", 1);
    start.transcript_path = Some("/logs/old.jsonl".into());
    machine.apply(start);
    let mut clear = event("SessionStart", 2);
    clear.source = Some("clear".into());
    clear.session_id = "next".into();
    machine.apply(clear);
    assert!(machine.snapshot().transcript_path.is_none());
}

#[test]
fn unrelated_notification_does_not_bind_or_advance_the_main_session() {
    let mut machine = Machine::new(AgentKind::Claude);
    let mut notification = event("Notification", 100);
    notification.notification_type = Some("auth_success".into());
    assert!(machine.apply(notification).is_none());
    assert!(machine.snapshot().session.is_none());
    assert!(machine.apply(event("SessionStart", 1)).is_some());
}

#[test]
fn compaction_preserves_the_active_turn_guard() {
    let mut machine = Machine::new(AgentKind::Codex);
    let mut prompt = event("UserPromptSubmit", 1);
    prompt.turn_id = Some("current".into());
    machine.apply(prompt);
    let mut compact = event("SessionStart", 2);
    compact.source = Some("compact".into());
    machine.apply(compact);
    let mut stale = event("Stop", 3);
    stale.turn_id = Some("previous".into());
    assert!(machine.apply(stale).is_none());
    assert_eq!(State::Processing, machine.snapshot().state);
}
