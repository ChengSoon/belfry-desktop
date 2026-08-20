#![allow(dead_code)]

use super::contracts::{
    AgentKind, AgentLifecycleEvent, AgentLifecycleState, AgentSessionRef, AgentStateSnapshot,
    AgentStateSource,
};

pub(crate) enum RawAgentEvent {
    ProcessStarted,
    ProcessExited {
        exit_code: i32,
    },
    ScreenActivity {
        activity: ScreenActivity,
    },
    HookState {
        state: AgentLifecycleState,
        reason: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ScreenActivity {
    Talking,
    AwaitingChoice,
    Idle,
    Unknown,
}

pub(crate) fn normalize_event(
    kind: AgentKind,
    session: AgentSessionRef,
    event: RawAgentEvent,
    occurred_at: i64,
) -> AgentLifecycleEvent {
    let snapshot = state_snapshot(&event);
    AgentLifecycleEvent {
        schema_version: 1,
        agent: kind,
        session,
        state: snapshot.lifecycle,
        source: snapshot.source,
        occurred_at,
        reason: snapshot.reason,
        metadata: None,
    }
}

pub(crate) fn state_snapshot(event: &RawAgentEvent) -> AgentStateSnapshot {
    match event {
        RawAgentEvent::ProcessStarted => snapshot(
            AgentLifecycleState::Starting,
            AgentStateSource::Process,
            1.0,
            None,
        ),
        RawAgentEvent::ProcessExited { exit_code } => snapshot(
            if *exit_code == 0 {
                AgentLifecycleState::Completed
            } else {
                AgentLifecycleState::Failed
            },
            AgentStateSource::Process,
            1.0,
            Some(format!("process exited with code {exit_code}")),
        ),
        RawAgentEvent::ScreenActivity { activity } => snapshot(
            match activity {
                ScreenActivity::Talking => AgentLifecycleState::Processing,
                // Screen text can suggest a prompt, but only a hook can prove
                // the authoritative awaiting-input lifecycle state.
                ScreenActivity::AwaitingChoice | ScreenActivity::Idle | ScreenActivity::Unknown => {
                    AgentLifecycleState::Unknown
                }
            },
            AgentStateSource::ScreenHeuristic,
            0.5,
            Some("state inferred from terminal screen activity".to_string()),
        ),
        RawAgentEvent::HookState { state, reason } => {
            snapshot(*state, AgentStateSource::Hook, 1.0, reason.clone())
        }
    }
}

fn snapshot(
    lifecycle: AgentLifecycleState,
    source: AgentStateSource,
    confidence: f32,
    reason: Option<String>,
) -> AgentStateSnapshot {
    AgentStateSnapshot {
        lifecycle,
        source,
        confidence: Some(confidence),
        reason,
    }
}
