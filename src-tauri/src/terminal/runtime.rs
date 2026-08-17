use std::sync::Arc;

use tauri::ipc::Channel;

use super::backend::{PtyBackend, TerminalEventSink};
use super::contracts::{
    AppError, CreateTerminalRequest, TerminalEvent, TerminalPalette, TerminalSession, TerminalSize,
};
use super::native::NativePtyBackend;

pub struct TerminalRuntime {
    backend: Arc<dyn PtyBackend>,
}

impl TerminalRuntime {
    pub fn with_platform_backend() -> Self {
        Self {
            backend: Arc::new(NativePtyBackend::default()),
        }
    }

    pub fn create(
        &self,
        request: CreateTerminalRequest,
        channel: Channel<TerminalEvent>,
    ) -> Result<TerminalSession, AppError> {
        self.backend.spawn(request, Arc::new(TauriSink(channel)))
    }

    pub fn write(&self, session_id: &str, bytes: &[u8]) -> Result<(), AppError> {
        self.backend.write(session_id, bytes)
    }

    pub fn resize(&self, session_id: &str, size: TerminalSize) -> Result<(), AppError> {
        self.backend.resize(session_id, size)
    }

    pub fn set_palette(&self, session_id: &str, palette: &TerminalPalette) -> Result<(), AppError> {
        self.backend.set_palette(session_id, palette)
    }

    pub fn close(&self, session_id: &str) -> Result<(), AppError> {
        self.backend.close(session_id)
    }

    pub fn close_all(&self) {
        self.backend.close_all();
    }
}

struct TauriSink(Channel<TerminalEvent>);

impl TerminalEventSink for TauriSink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        self.0
            .send(event)
            .map_err(|error| AppError::io(error.to_string()))
    }
}
