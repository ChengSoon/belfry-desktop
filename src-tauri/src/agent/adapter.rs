//! Agent-specific behavior behind one small, versioned contract.
//!
//! PTY creation remains a terminal concern. Adapters only resolve the CLI,
//! build its arguments, describe supported capabilities, and normalize the
//! state signals that are available for that CLI.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::terminal::AppError;

use super::contracts::{
    AgentAvailability, AgentDescriptor, AgentKind, AgentLifecycleEvent, AgentResumePlan,
    AgentSessionRef, AgentStateSnapshot,
};
use super::detection::detect_agent;
use super::history_adapter::{AgentHistoryAdapter, ClaudeHistoryAdapter, CodexHistoryAdapter};
use super::state::{RawAgentEvent, normalize_event, state_snapshot};

pub(crate) struct AgentLaunchContext<'a> {
    pub cwd: &'a Path,
    pub env: &'a HashMap<String, String>,
    pub resume: Option<&'a str>,
    pub collaboration_mode: bool,
}

pub(crate) struct AgentLaunchSpec {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub display_name: String,
}

pub(crate) trait AgentAdapter: Send + Sync {
    fn descriptor(&self) -> AgentDescriptor;

    fn detect(&self) -> AgentAvailability {
        detect_agent(self.kind())
    }

    fn kind(&self) -> AgentKind;

    fn history(&self) -> &'static dyn AgentHistoryAdapter;

    fn launch(&self, context: AgentLaunchContext<'_>) -> Result<AgentLaunchSpec, AppError>;

    fn new_session_arguments(&self) -> Vec<String>;

    fn plan_resume(&self, session_id: &str) -> Result<AgentResumePlan, AppError>;

    #[allow(dead_code)]
    fn normalize(
        &self,
        session: AgentSessionRef,
        event: RawAgentEvent,
        occurred_at: i64,
    ) -> Result<AgentLifecycleEvent, AppError> {
        if session.agent != self.kind() {
            return Err(AppError::invalid_argument(
                "agent session reference does not match adapter",
            ));
        }
        session.validate().map_err(AppError::invalid_argument)?;
        Ok(normalize_event(self.kind(), session, event, occurred_at))
    }

    #[allow(dead_code)]
    fn state_snapshot(&self, event: &RawAgentEvent) -> AgentStateSnapshot {
        state_snapshot(event)
    }
}

struct CodexAdapter;
struct ClaudeAdapter;
static CODEX: CodexAdapter = CodexAdapter;
static CLAUDE: ClaudeAdapter = ClaudeAdapter;
static CODEX_HISTORY: CodexHistoryAdapter = CodexHistoryAdapter;
static CLAUDE_HISTORY: ClaudeHistoryAdapter = ClaudeHistoryAdapter;

pub(crate) fn adapter_for(kind: AgentKind) -> &'static dyn AgentAdapter {
    match kind {
        AgentKind::Codex => &CODEX,
        AgentKind::Claude => &CLAUDE,
    }
}

pub(crate) fn descriptors() -> Vec<AgentDescriptor> {
    AgentKind::ALL
        .into_iter()
        .map(|kind| adapter_for(kind).descriptor())
        .collect()
}

pub(crate) fn detect_all() -> Vec<AgentAvailability> {
    std::thread::scope(|scope| {
        AgentKind::ALL
            .into_iter()
            .map(|kind| (kind, scope.spawn(move || adapter_for(kind).detect())))
            .map(|(kind, handle)| {
                handle.join().unwrap_or_else(|_| AgentAvailability {
                    descriptor: AgentDescriptor::for_kind(kind),
                    kind,
                    available: false,
                    executable: None,
                    version: None,
                    reason: Some(format!("检测 {} 时后台任务异常退出", kind.command_name())),
                })
            })
            .collect()
    })
}

#[cfg(test)]
pub(crate) fn arguments_for(
    kind: AgentKind,
    resume: Option<&str>,
    collaboration_mode: bool,
) -> Result<Vec<String>, AppError> {
    let adapter = adapter_for(kind);
    launch_arguments(
        kind,
        resume,
        adapter.new_session_arguments(),
        collaboration_mode,
    )
}

fn validate_session_id(kind: AgentKind, session_id: &str) -> Result<AgentSessionRef, AppError> {
    let session = AgentSessionRef {
        agent: kind,
        id: session_id.to_string(),
    };
    session.validate().map_err(AppError::invalid_argument)?;
    Ok(session)
}

fn resolve_launch(
    kind: AgentKind,
    context: AgentLaunchContext<'_>,
    base_arguments: Vec<String>,
) -> Result<AgentLaunchSpec, AppError> {
    let executable = super::detection::resolve_agent(kind)?;
    let arguments = launch_arguments(
        kind,
        context.resume,
        base_arguments,
        context.collaboration_mode,
    )?;
    let _ = (context.cwd, context.env);
    Ok(AgentLaunchSpec {
        executable,
        arguments,
        display_name: kind.command_name().to_string(),
    })
}

fn launch_arguments(
    kind: AgentKind,
    resume: Option<&str>,
    base_arguments: Vec<String>,
    collaboration_mode: bool,
) -> Result<Vec<String>, AppError> {
    let mut arguments = match resume {
        Some(session_id) => adapter_for(kind).plan_resume(session_id)?.arguments,
        None => base_arguments,
    };
    if collaboration_mode {
        arguments.splice(0..0, collaboration_arguments(kind));
    }
    Ok(arguments)
}

fn collaboration_arguments(kind: AgentKind) -> impl Iterator<Item = String> {
    match kind {
        AgentKind::Codex => ["--disable", "multi_agent"].as_slice(),
        AgentKind::Claude => ["--disallowedTools", "Agent", "Task"].as_slice(),
    }
    .iter()
    .map(|value| (*value).to_string())
}

fn resume_plan(
    kind: AgentKind,
    session_id: &str,
    prefix: &[&str],
) -> Result<AgentResumePlan, AppError> {
    let session = validate_session_id(kind, session_id)?;
    let mut arguments = prefix
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    match kind {
        AgentKind::Codex => arguments.extend(["resume".to_string(), session.id.clone()]),
        AgentKind::Claude => arguments.extend(["--resume".to_string(), session.id.clone()]),
    }
    Ok(AgentResumePlan {
        schema_version: 1,
        session,
        supported: true,
        arguments,
    })
}

impl AgentAdapter for CodexAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
    }

    fn history(&self) -> &'static dyn AgentHistoryAdapter {
        &CODEX_HISTORY
    }

    fn descriptor(&self) -> AgentDescriptor {
        AgentDescriptor::for_kind(self.kind())
    }

    fn launch(&self, context: AgentLaunchContext<'_>) -> Result<AgentLaunchSpec, AppError> {
        resolve_launch(self.kind(), context, self.new_session_arguments())
    }

    fn new_session_arguments(&self) -> Vec<String> {
        Vec::new()
    }

    fn plan_resume(&self, session_id: &str) -> Result<AgentResumePlan, AppError> {
        resume_plan(self.kind(), session_id, &[])
    }
}

impl AgentAdapter for ClaudeAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Claude
    }

    fn history(&self) -> &'static dyn AgentHistoryAdapter {
        &CLAUDE_HISTORY
    }

    fn descriptor(&self) -> AgentDescriptor {
        AgentDescriptor::for_kind(self.kind())
    }

    fn launch(&self, context: AgentLaunchContext<'_>) -> Result<AgentLaunchSpec, AppError> {
        resolve_launch(self.kind(), context, self.new_session_arguments())
    }

    fn new_session_arguments(&self) -> Vec<String> {
        vec!["--dangerously-skip-permissions".to_string()]
    }

    fn plan_resume(&self, session_id: &str) -> Result<AgentResumePlan, AppError> {
        resume_plan(self.kind(), session_id, &["--dangerously-skip-permissions"])
    }
}

#[cfg(test)]
#[path = "adapter_tests.rs"]
mod tests;
