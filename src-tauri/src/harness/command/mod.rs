mod audit;
mod auth;
pub mod commands;
mod process;
mod types;
mod validation;
pub use types::*;

use crate::{harness::registry::SystemRegistry, project::resource_path};
use std::{
    collections::{HashMap, VecDeque},
    process::Child,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

const APPROVAL_LIMIT: usize = 100;
const TTL_MS: u64 = 10 * 60 * 1000;
const SESSION_LIMIT: usize = 2;
const GLOBAL_LIMIT: usize = 4;
pub(super) type AuditSink = Arc<dyn Fn(CommandAudit) + Send + Sync>;

struct Approval {
    request: ExecRequest,
    token: Option<String>,
    expires_at: u64,
}
struct Running {
    session_id: String,
    worker_id: String,
    cancelled: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}
#[derive(Default)]
struct State {
    approvals: HashMap<String, Approval>,
    order: VecDeque<String>,
    running: HashMap<String, Running>,
}

pub struct CommandBroker {
    state: Mutex<State>,
    audit: AuditSink,
}
impl CommandBroker {
    pub fn new(audit: impl Fn(CommandAudit) + Send + Sync + 'static) -> Self {
        Self {
            state: Mutex::new(State::default()),
            audit: Arc::new(audit),
        }
    }

    pub fn request(
        &self,
        registry: &SystemRegistry,
        request: ExecRequest,
    ) -> CommandResult<ApprovalRequired> {
        audit::emit(
            &self.audit,
            &request,
            "requested",
            0,
            "command requested",
            None,
            None,
        );
        let result = self.request_inner(registry, request.clone());
        match &result {
            Ok(_) => audit::emit(
                &self.audit,
                &request,
                "approval.required",
                0,
                "command approval required",
                None,
                None,
            ),
            Err(error) => audit::emit(
                &self.audit,
                &request,
                "failed",
                0,
                error.message,
                None,
                Some(error.code),
            ),
        }
        result
    }

    fn request_inner(
        &self,
        registry: &SystemRegistry,
        request: ExecRequest,
    ) -> CommandResult<ApprovalRequired> {
        let session = auth::authorize(registry, &request)?;
        let root = resource_path::canonical_root(session.project_root.as_ref())
            .map_err(|_| CommandError::new("INVALID_PARAMS", "invalid project root"))?;
        validation::validate(&request, &root)?;
        let now = now_ms();
        let id = ulid::Ulid::generate().to_string().to_lowercase();
        let expires_at = now + TTL_MS;
        let mut state = self.state.lock().unwrap();
        purge(&mut state, now);
        state.order.push_back(id.clone());
        state.approvals.insert(
            id.clone(),
            Approval {
                request,
                token: None,
                expires_at,
            },
        );
        while state.approvals.len() > APPROVAL_LIMIT {
            if let Some(old) = state.order.pop_front() {
                state.approvals.remove(&old);
            }
        }
        Ok(ApprovalRequired {
            approval_id: id,
            expires_at,
        })
    }

    pub fn approve(&self, approval_id: &str) -> CommandResult<String> {
        let mut state = self.state.lock().unwrap();
        purge(&mut state, now_ms());
        let approval = state.approvals.get_mut(approval_id).ok_or_else(expired)?;
        let token = ulid::Ulid::generate().to_string().to_lowercase();
        approval.token = Some(token.clone());
        Ok(token)
    }
    pub fn reject(&self, approval_id: &str) -> CommandResult<()> {
        self.state
            .lock()
            .unwrap()
            .approvals
            .remove(approval_id)
            .map(|_| ())
            .ok_or_else(expired)
    }

    pub fn execute(
        &self,
        registry: &SystemRegistry,
        approval_id: &str,
        token: &str,
    ) -> CommandResult<ExecResult> {
        let approval = self.consume(approval_id, token)?;
        let result = self.execute_inner(registry, &approval.request);
        audit::result(&self.audit, &approval.request, &result);
        result
    }

    fn execute_inner(
        &self,
        registry: &SystemRegistry,
        request: &ExecRequest,
    ) -> CommandResult<ExecResult> {
        let session = auth::authorize(registry, request)?;
        let root = resource_path::canonical_root(session.project_root.as_ref())
            .map_err(|_| CommandError::new("INVALID_PARAMS", "invalid project root"))?;
        let (executable, cwd, env, timeout) = validation::validate(request, &root)?;
        let (cancelled, child) = self.start_running(request)?;
        audit::emit(
            &self.audit,
            request,
            "started",
            0,
            "command started",
            None,
            None,
        );
        let result = process::run(
            &executable,
            &request.argv,
            &cwd,
            &env,
            timeout,
            cancelled,
            child,
        );
        self.finish_running(&request.request_id);
        result
    }

    fn consume(&self, id: &str, token: &str) -> CommandResult<Approval> {
        let mut state = self.state.lock().unwrap();
        purge(&mut state, now_ms());
        let approval = state.approvals.remove(id).ok_or_else(expired)?;
        if approval.token.as_deref() != Some(token) {
            return Err(CommandError::new(
                "APPROVAL_DENIED",
                "approval token is invalid",
            ));
        }
        Ok(approval)
    }

    fn start_running(
        &self,
        request: &ExecRequest,
    ) -> CommandResult<(Arc<AtomicBool>, Arc<Mutex<Option<Child>>>)> {
        let mut state = self.state.lock().unwrap();
        if state.running.len() >= GLOBAL_LIMIT
            || state
                .running
                .values()
                .filter(|run| run.session_id == request.session_id)
                .count()
                >= SESSION_LIMIT
        {
            return Err(CommandError::new("BUSY", "too many concurrent commands"));
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let child = Arc::new(Mutex::new(None));
        state.running.insert(
            request.request_id.clone(),
            Running {
                session_id: request.session_id.clone(),
                worker_id: request.worker_id.clone(),
                cancelled: cancelled.clone(),
                child: child.clone(),
            },
        );
        Ok((cancelled, child))
    }

    pub fn cancel_session(&self, session_id: &str) {
        self.cancel_matching(|run| run.session_id == session_id);
    }
    pub fn cancel_worker(&self, worker_id: &str) {
        self.cancel_matching(|run| run.worker_id == worker_id);
    }
    pub fn close_all(&self) {
        self.cancel_matching(|_| true);
    }
    fn cancel_matching(&self, matches: impl Fn(&Running) -> bool) {
        let state = self.state.lock().unwrap();
        for run in state.running.values().filter(|run| matches(run)) {
            run.cancelled.store(true, Ordering::SeqCst);
            process::terminate(&run.child);
        }
    }
    fn finish_running(&self, request_id: &str) {
        self.state.lock().unwrap().running.remove(request_id);
    }
}
fn expired() -> CommandError {
    CommandError::new("APPROVAL_EXPIRED", "approval is unavailable")
}
fn purge(state: &mut State, now: u64) {
    state.approvals.retain(|_, value| value.expires_at > now);
    state.order.retain(|id| state.approvals.contains_key(id));
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests;
