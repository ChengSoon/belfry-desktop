use std::sync::Arc;

#[cfg(test)]
use std::{collections::HashSet, sync::Mutex};

use super::contracts::{
    AppError, CreateTerminalRequest, TerminalEvent, TerminalSession, TerminalSize,
};

#[cfg(test)]
use super::contracts::TerminalStatus;

pub trait TerminalEventSink: Send + Sync {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError>;
}

pub trait PtyBackend: Send + Sync {
    fn spawn(
        &self,
        request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalSession, AppError>;
    fn write(&self, session_id: &str, bytes: &[u8]) -> Result<(), AppError>;
    fn resize(&self, session_id: &str, size: TerminalSize) -> Result<(), AppError>;
    fn close(&self, session_id: &str) -> Result<(), AppError>;
    fn close_all(&self);
}

#[cfg(test)]
#[derive(Default)]
pub struct StubBackend {
    sessions: Mutex<HashSet<String>>,
}

#[cfg(test)]
impl PtyBackend for StubBackend {
    fn spawn(
        &self,
        request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalSession, AppError> {
        request.validate()?;
        let id = ulid::Ulid::generate().to_string().to_lowercase();
        self.sessions.lock().unwrap().insert(id.clone());
        sink.send(TerminalEvent::Output {
            session_id: id.clone(),
            sequence: 0,
            bytes: b"OTTY terminal contract ready.\r\n".to_vec(),
            eof: false,
        })?;
        Ok(TerminalSession {
            id,
            platform: request.platform,
            shell: "stub-shell".to_string(),
            cwd: request.cwd.unwrap_or_default(),
            cols: request.cols,
            rows: request.rows,
            status: TerminalStatus::Running,
            exit_code: None,
        })
    }

    fn write(&self, session_id: &str, _bytes: &[u8]) -> Result<(), AppError> {
        self.require_session(session_id)
    }

    fn resize(&self, session_id: &str, size: TerminalSize) -> Result<(), AppError> {
        size.validate()?;
        self.require_session(session_id)
    }

    fn close(&self, session_id: &str) -> Result<(), AppError> {
        if self.sessions.lock().unwrap().remove(session_id) {
            Ok(())
        } else {
            Err(AppError::process_exited())
        }
    }

    fn close_all(&self) {
        self.sessions.lock().unwrap().clear();
    }
}

#[cfg(test)]
impl StubBackend {
    fn require_session(&self, session_id: &str) -> Result<(), AppError> {
        if self.sessions.lock().unwrap().contains(session_id) {
            Ok(())
        } else {
            Err(AppError::process_exited())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::contracts::{Elevation, Platform, TerminalEvent};
    use std::collections::HashMap;

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<TerminalEvent>>);

    impl TerminalEventSink for RecordingSink {
        fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
            self.0.lock().unwrap().push(event);
            Ok(())
        }
    }

    fn request() -> CreateTerminalRequest {
        CreateTerminalRequest {
            platform: Platform::Macos,
            profile_id: "system-default".to_string(),
            cwd: Some("file:///tmp".to_string()),
            command: None,
            env: HashMap::new(),
            cols: 120,
            rows: 36,
            elevation: Elevation::Normal,
        }
    }

    #[test]
    fn backend_contract_covers_lifecycle_and_errors() {
        let backend = StubBackend::default();
        let sink = Arc::new(RecordingSink::default());
        let session = backend.spawn(request(), sink.clone()).unwrap();
        assert_eq!(sink.0.lock().unwrap().len(), 1);
        backend.write(&session.id, b"echo ok\r").unwrap();
        backend
            .resize(&session.id, TerminalSize { cols: 90, rows: 28 })
            .unwrap();
        backend.close(&session.id).unwrap();
        assert!(backend.write(&session.id, b"x").is_err());
        assert!(
            backend
                .resize(&session.id, TerminalSize { cols: 0, rows: 28 })
                .is_err()
        );
    }
}
