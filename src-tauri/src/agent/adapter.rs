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
use super::history_adapter::{
    AgentHistoryAdapter, ClaudeHistoryAdapter, CodexHistoryAdapter, PiHistoryAdapter,
};
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
struct PiAdapter;
static CODEX: CodexAdapter = CodexAdapter;
static CLAUDE: ClaudeAdapter = ClaudeAdapter;
static PI: PiAdapter = PiAdapter;
static CODEX_HISTORY: CodexHistoryAdapter = CodexHistoryAdapter;
static CLAUDE_HISTORY: ClaudeHistoryAdapter = ClaudeHistoryAdapter;
static PI_HISTORY: PiHistoryAdapter = PiHistoryAdapter;

pub(crate) fn adapter_for(kind: AgentKind) -> &'static dyn AgentAdapter {
    match kind {
        AgentKind::Codex => &CODEX,
        AgentKind::Claude => &CLAUDE,
        AgentKind::Pi => &PI,
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
    let arguments = launch_arguments_in(kind, &context, base_arguments)?;
    let _ = context.cwd;
    Ok(AgentLaunchSpec {
        executable,
        arguments,
        display_name: kind.command_name().to_string(),
    })
}

fn launch_arguments_in(
    kind: AgentKind,
    context: &AgentLaunchContext<'_>,
    base_arguments: Vec<String>,
) -> Result<Vec<String>, AppError> {
    if kind == AgentKind::Codex && super::native_launch::enabled(context.env) {
        return context.resume.map_or_else(
            || Ok(Vec::new()),
            |id| resume_plan(kind, id, &[]).map(|plan| plan.arguments),
        );
    }
    let mut arguments = launch_arguments(
        kind,
        context.resume,
        base_arguments,
        context.collaboration_mode,
    )?;
    arguments.splice(
        0..0,
        crate::plugins::agent_connection::arguments(kind, context.env),
    );
    Ok(arguments)
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
        // Pi 没有子 agent / plan mode，协作模式不需要关掉任何能力。
        AgentKind::Pi => [].as_slice(),
    }
    .iter()
    .map(|value| (*value).to_string())
}

fn resume_plan(
    kind: AgentKind,
    session_id: &str,
    prefix: &[&str],
) -> Result<AgentResumePlan, AppError> {
    if session_id.starts_with('-') {
        return Err(AppError::invalid_argument("会话 ID 不能是 CLI 选项"));
    }
    let session = validate_session_id(kind, session_id)?;
    let mut arguments = prefix
        .iter()
        .map(|value| (*value).to_string())
        .collect::<Vec<_>>();
    match kind {
        AgentKind::Codex => arguments.extend(["resume".to_string(), session.id.clone()]),
        AgentKind::Claude => arguments.extend(["--resume".to_string(), session.id.clone()]),
        AgentKind::Pi => arguments.extend(["--session".to_string(), session.id.clone()]),
    }
    Ok(AgentResumePlan {
        schema_version: 1,
        session,
        supported: true,
        arguments,
    })
}

impl AgentAdapter for PiAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Pi
    }

    fn history(&self) -> &'static dyn AgentHistoryAdapter {
        &PI_HISTORY
    }

    fn descriptor(&self) -> AgentDescriptor {
        AgentDescriptor::for_kind(self.kind())
    }

    fn launch(&self, context: AgentLaunchContext<'_>) -> Result<AgentLaunchSpec, AppError> {
        resolve_launch(self.kind(), context, self.new_session_arguments())
    }

    // Pi 自身不做权限拦截（官方文档明说不内置权限系统），新会话不需要额外开关。
    fn new_session_arguments(&self) -> Vec<String> {
        Vec::new()
    }

    fn plan_resume(&self, session_id: &str) -> Result<AgentResumePlan, AppError> {
        resume_plan(self.kind(), session_id, &[])
    }
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
        vec!["--dangerously-bypass-approvals-and-sandbox".to_string()]
    }

    fn plan_resume(&self, session_id: &str) -> Result<AgentResumePlan, AppError> {
        resume_plan(
            self.kind(),
            session_id,
            &["--dangerously-bypass-approvals-and-sandbox"],
        )
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

#[cfg(test)]
mod native_tests {
    use super::*;

    #[test]
    fn native_codex_has_plain_arguments_even_with_collaboration_and_plugin_environment() {
        let env = HashMap::from([
            (super::super::native_launch::ENV.into(), "1".into()),
            ("BELFRY_PLUGIN_NODE".into(), "/node".into()),
            ("BELFRY_PLUGIN_MCP_BRIDGE".into(), "/bridge".into()),
            (
                "BELFRY_PLUGIN_MCP_URL".into(),
                "http://127.0.0.1/mcp".into(),
            ),
            ("BELFRY_PLUGIN_MCP_TOKEN".into(), "test-token".into()),
        ]);
        let mut context = AgentLaunchContext {
            cwd: Path::new("."),
            env: &env,
            resume: None,
            collaboration_mode: true,
        };
        assert!(
            launch_arguments_in(AgentKind::Codex, &context, CODEX.new_session_arguments())
                .unwrap()
                .is_empty()
        );
        context.resume = Some("11111111-2222-3333-4444-555555555555");
        assert_eq!(
            launch_arguments_in(AgentKind::Codex, &context, CODEX.new_session_arguments()).unwrap(),
            vec!["resume", "11111111-2222-3333-4444-555555555555"]
        );
        context.resume = Some("--last");
        assert!(
            launch_arguments_in(AgentKind::Codex, &context, CODEX.new_session_arguments()).is_err()
        );
        // The Codex-only switch must not remove Claude's ordinary permission arguments.
        context.resume = None;
        assert!(
            launch_arguments_in(AgentKind::Claude, &context, CLAUDE.new_session_arguments())
                .unwrap()
                .contains(&"--dangerously-skip-permissions".to_owned())
        );
    }

    #[test]
    fn native_and_managed_resume_reject_cli_option_ids() {
        for kind in AgentKind::ALL {
            for id in ["--last", "--all", "-h"] {
                assert!(adapter_for(kind).plan_resume(id).is_err());
            }
        }
    }

    #[test]
    fn native_switch_off_preserves_managed_codex_arguments() {
        let env = HashMap::from([(super::super::native_launch::ENV.into(), "0".into())]);
        let context = AgentLaunchContext {
            cwd: Path::new("."),
            env: &env,
            resume: None,
            collaboration_mode: true,
        };
        assert_eq!(
            launch_arguments_in(AgentKind::Codex, &context, CODEX.new_session_arguments()).unwrap(),
            vec![
                "--disable",
                "multi_agent",
                "--dangerously-bypass-approvals-and-sandbox"
            ]
        );
    }
}
