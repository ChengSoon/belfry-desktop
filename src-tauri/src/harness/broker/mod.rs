pub mod commands;
mod operations;
mod types;

use crate::project::resource_path;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};
pub use types::{AuditEvent, BrokerError, BrokerResult, SessionRegistration, ToolRequest};

const CONCURRENCY_LIMIT: usize = 8;
type AuditSink = Arc<dyn Fn(AuditEvent) + Send + Sync>;

struct Session {
    worker_id: String,
    root: PathBuf,
    _harness: (String, String),
    declared: HashSet<String>,
    granted: HashSet<String>,
    cancelled: bool,
    inflight: usize,
}

pub(crate) struct WriteContext {
    pub root: PathBuf,
}

pub struct ReadBroker {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    audit: AuditSink,
    finished: Arc<Mutex<HashSet<(String, String, String, String, String)>>>,
}

impl ReadBroker {
    pub fn new(audit: impl Fn(AuditEvent) + Send + Sync + 'static) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            audit: Arc::new(audit),
            finished: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn register(&self, registration: SessionRegistration) -> Result<(), BrokerError> {
        let root =
            resource_path::canonical_root(PathBuf::from(&registration.project_root).as_path())
                .map_err(|_| BrokerError::new("INVALID_PARAMS", "invalid project root"))?;
        let session = Session {
            worker_id: registration.worker_id,
            root,
            _harness: (registration.harness_id, registration.harness_version),
            declared: registration.declared_tools.into_iter().collect(),
            granted: registration.granted_capabilities.into_iter().collect(),
            cancelled: false,
            inflight: 0,
        };
        let mut sessions = self.sessions.lock().unwrap();
        if sessions.contains_key(&registration.session_id) {
            return Err(BrokerError::new(
                "INVALID_PARAMS",
                "session is already registered",
            ));
        }
        sessions.insert(registration.session_id, session);
        Ok(())
    }

    pub fn update_grants(&self, session_id: &str, grants: Vec<String>) -> Result<(), BrokerError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| BrokerError::new("SESSION_NOT_FOUND", "session not found"))?;
        session.granted = grants.into_iter().collect();
        Ok(())
    }

    pub fn cancel(&self, session_id: &str) -> Result<(), BrokerError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| BrokerError::new("SESSION_NOT_FOUND", "session not found"))?;
        session.cancelled = true;
        Ok(())
    }

    pub fn handle(&self, worker_id: &str, request: ToolRequest) -> BrokerResult {
        self.handle_with_hook(worker_id, request, || {})
    }

    pub(crate) fn write_context(
        &self,
        worker_id: &str,
        session_id: &str,
        tool: &str,
    ) -> Result<WriteContext, BrokerError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| BrokerError::new("SESSION_NOT_FOUND", "session not found"))?;
        if session.worker_id != worker_id {
            return Err(BrokerError::new(
                "WORKER_MISMATCH",
                "worker does not own session",
            ));
        }
        if !session.declared.contains(tool) {
            return Err(BrokerError::new("TOOL_UNDECLARED", "tool is not declared"));
        }
        if !session.granted.contains("project.write") {
            return Err(BrokerError::new(
                "CAPABILITY_DENIED",
                "project write is not authorized",
            ));
        }
        if session.cancelled {
            return Err(BrokerError::new(
                "SESSION_CANCELLED",
                "session is cancelled",
            ));
        }
        Ok(WriteContext {
            root: session.root.clone(),
        })
    }

    fn handle_with_hook<F: FnOnce()>(
        &self,
        worker_id: &str,
        request: ToolRequest,
        before_execute: F,
    ) -> BrokerResult {
        let key = (
            request.session_id.clone(),
            request.request_id.clone(),
            request.tool_id.clone(),
            request.tool.clone(),
            request.params.to_string(),
        );
        if self.finished.lock().unwrap().contains(&key) {
            return Err(BrokerError::new(
                "INVALID_PARAMS",
                "request already completed",
            ));
        }
        let started = Instant::now();
        self.emit(&request, "requested", 0, "tool requested", None);
        let result = self.run(worker_id, &request, before_execute);
        let duration = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
        match &result {
            Ok(_) => {
                self.finished.lock().unwrap().insert(key);
                self.emit(&request, "completed", duration, "read tool completed", None)
            }
            Err(error) => self.emit(
                &request,
                "failed",
                duration,
                error.message,
                Some(error.code),
            ),
        }
        result
    }

    fn run<F: FnOnce()>(
        &self,
        worker_id: &str,
        request: &ToolRequest,
        before_execute: F,
    ) -> BrokerResult {
        let permit = self.authorize(worker_id, request)?;
        before_execute();
        self.recheck(&request.session_id)?;
        operations::execute(&permit.root, &request.tool, &request.params)
    }

    fn authorize(&self, worker_id: &str, request: &ToolRequest) -> Result<Permit, BrokerError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| BrokerError::new("SESSION_NOT_FOUND", "session not found"))?;
        if session.worker_id != worker_id {
            return Err(BrokerError::new(
                "WORKER_MISMATCH",
                "worker does not own session",
            ));
        }
        if !session.declared.contains(&request.tool) {
            return Err(BrokerError::new("TOOL_UNDECLARED", "tool is not declared"));
        }
        if !session.granted.contains("project.read") {
            return Err(BrokerError::new(
                "CAPABILITY_DENIED",
                "project read is not authorized",
            ));
        }
        operations::validate_params(&request.tool, &request.params)?;
        if session.cancelled {
            return Err(BrokerError::new(
                "SESSION_CANCELLED",
                "session is cancelled",
            ));
        }
        if session.inflight >= CONCURRENCY_LIMIT {
            return Err(BrokerError::new("BUSY", "too many concurrent read calls"));
        }
        session.inflight += 1;
        Ok(Permit {
            session_id: request.session_id.clone(),
            root: session.root.clone(),
            sessions: self.sessions.clone(),
        })
    }

    fn recheck(&self, session_id: &str) -> Result<(), BrokerError> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| BrokerError::new("SESSION_NOT_FOUND", "session not found"))?;
        if session.cancelled {
            return Err(BrokerError::new(
                "SESSION_CANCELLED",
                "session is cancelled",
            ));
        }
        if !session.granted.contains("project.read") {
            return Err(BrokerError::new(
                "CAPABILITY_DENIED",
                "project read is not authorized",
            ));
        }
        Ok(())
    }

    fn emit(
        &self,
        request: &ToolRequest,
        phase: &'static str,
        duration_ms: u64,
        summary: &str,
        error_code: Option<&'static str>,
    ) {
        (self.audit)(AuditEvent {
            phase,
            session_id: request.session_id.clone(),
            request_id: request.request_id.clone(),
            tool_id: request.tool_id.clone(),
            tool: request.tool.clone(),
            duration_ms,
            summary: summary.chars().take(120).collect(),
            error_code,
        });
    }

    #[cfg(test)]
    fn set_inflight_for_test(&self, session_id: &str, inflight: usize) {
        self.sessions
            .lock()
            .unwrap()
            .get_mut(session_id)
            .unwrap()
            .inflight = inflight;
    }
}

struct Permit {
    session_id: String,
    root: PathBuf,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
}
impl Drop for Permit {
    fn drop(&mut self) {
        if let Some(session) = self.sessions.lock().unwrap().get_mut(&self.session_id) {
            session.inflight = session.inflight.saturating_sub(1);
        }
    }
}

#[cfg(test)]
mod tests;
