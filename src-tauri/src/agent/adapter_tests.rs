use super::*;
use crate::agent::contracts::{AgentLifecycleState, AgentStateSource};
use crate::agent::state::{RawAgentEvent, ScreenActivity};

#[test]
fn registry_is_complete_and_stable() {
    let kinds = AgentKind::ALL
        .into_iter()
        .map(|kind| adapter_for(kind).descriptor().kind)
        .collect::<Vec<_>>();
    assert_eq!(kinds, vec![AgentKind::Codex, AgentKind::Claude]);
    assert_eq!(descriptors()[0].id, "agent:codex");
}

#[test]
fn resume_plans_keep_cli_specific_arguments() {
    let codex = adapter_for(AgentKind::Codex)
        .plan_resume("session-1")
        .unwrap();
    assert_eq!(codex.arguments, ["resume", "session-1"]);
    let claude = adapter_for(AgentKind::Claude)
        .plan_resume("session-2")
        .unwrap();
    assert_eq!(
        claude.arguments,
        ["--dangerously-skip-permissions", "--resume", "session-2"]
    );
}

#[test]
fn invalid_resume_ids_are_rejected_before_cli_arguments_are_built() {
    let error = adapter_for(AgentKind::Codex)
        .plan_resume("../outside")
        .unwrap_err();
    assert_eq!(error.message, "agent session id is invalid");
}

#[test]
fn screen_idle_is_unknown_instead_of_completed_or_idle_success() {
    let snapshot = adapter_for(AgentKind::Codex).state_snapshot(&RawAgentEvent::ScreenActivity {
        activity: ScreenActivity::Idle,
    });
    assert_eq!(snapshot.lifecycle, AgentLifecycleState::Unknown);
    assert_eq!(snapshot.source, AgentStateSource::ScreenHeuristic);
}

#[test]
fn screen_choice_is_unknown_until_a_hook_confirms_awaiting_input() {
    let snapshot = adapter_for(AgentKind::Claude).state_snapshot(&RawAgentEvent::ScreenActivity {
        activity: ScreenActivity::AwaitingChoice,
    });
    assert_eq!(snapshot.lifecycle, AgentLifecycleState::Unknown);
    assert_eq!(snapshot.source, AgentStateSource::ScreenHeuristic);
}

#[test]
fn lifecycle_events_keep_process_and_hook_sources_distinct() {
    let adapter = adapter_for(AgentKind::Claude);
    let session = AgentSessionRef {
        agent: AgentKind::Claude,
        id: "session-1".to_string(),
    };
    let started = adapter
        .normalize(session.clone(), RawAgentEvent::ProcessStarted, 10)
        .unwrap();
    assert_eq!(started.state, AgentLifecycleState::Starting);
    assert_eq!(started.source, AgentStateSource::Process);

    let hook = adapter
        .normalize(
            session,
            RawAgentEvent::HookState {
                state: AgentLifecycleState::AwaitingInput,
                reason: Some("permission prompt".to_string()),
            },
            11,
        )
        .unwrap();
    assert_eq!(hook.state, AgentLifecycleState::AwaitingInput);
    assert_eq!(hook.source, AgentStateSource::Hook);
    assert_eq!(hook.reason.as_deref(), Some("permission prompt"));
}

#[test]
fn normalized_events_reject_a_session_owned_by_another_adapter() {
    let error = adapter_for(AgentKind::Codex)
        .normalize(
            AgentSessionRef {
                agent: AgentKind::Claude,
                id: "session-1".to_string(),
            },
            RawAgentEvent::ProcessStarted,
            10,
        )
        .unwrap_err();
    assert_eq!(
        error.message,
        "agent session reference does not match adapter"
    );
}

#[test]
fn normalized_events_reject_an_invalid_session_id() {
    let error = adapter_for(AgentKind::Codex)
        .normalize(
            AgentSessionRef {
                agent: AgentKind::Codex,
                id: "../session-1".to_string(),
            },
            RawAgentEvent::ProcessStarted,
            10,
        )
        .unwrap_err();
    assert_eq!(error.message, "agent session id is invalid");
}

#[test]
fn state_normalization_covers_process_exit_and_screen_signals() {
    let adapter = adapter_for(AgentKind::Codex);
    let session = AgentSessionRef {
        agent: AgentKind::Codex,
        id: "session-2".to_string(),
    };
    let failed = adapter
        .normalize(
            session.clone(),
            RawAgentEvent::ProcessExited { exit_code: 7 },
            12,
        )
        .unwrap();
    assert_eq!(failed.state, AgentLifecycleState::Failed);
    assert_eq!(failed.source, AgentStateSource::Process);

    for activity in [
        ScreenActivity::Talking,
        ScreenActivity::AwaitingChoice,
        ScreenActivity::Unknown,
    ] {
        let event = adapter
            .normalize(
                session.clone(),
                RawAgentEvent::ScreenActivity { activity },
                13,
            )
            .unwrap();
        assert_eq!(event.source, AgentStateSource::ScreenHeuristic);
    }
    let interrupted = adapter
        .normalize(
            session,
            RawAgentEvent::HookState {
                state: AgentLifecycleState::Interrupted,
                reason: None,
            },
            14,
        )
        .unwrap();
    assert_eq!(interrupted.state, AgentLifecycleState::Interrupted);
}
