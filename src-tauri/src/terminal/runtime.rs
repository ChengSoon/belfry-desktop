use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};

use tauri::ipc::Channel;

use super::backend::{PtyBackend, TerminalEventSink};
use super::contracts::{
    AppError, CreateTerminalRequest, TerminalEvent, TerminalPalette, TerminalSession, TerminalSize,
};
#[cfg(test)]
use super::native::NativePtyBackend;

pub struct TerminalRuntime {
    backend: Arc<dyn PtyBackend>,
    daemon: Option<Arc<super::daemon::DaemonClient>>,
    closing: AtomicBool,
    launch_epochs: Mutex<HashMap<String, u64>>,
    workspace_gate: Mutex<()>,
    sessions: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl TerminalRuntime {
    #[cfg(test)]
    pub fn with_platform_backend() -> Self {
        Self {
            backend: Arc::new(NativePtyBackend::default()),
            daemon: None,
            closing: AtomicBool::new(false),
            launch_epochs: Mutex::new(HashMap::new()),
            workspace_gate: Mutex::new(()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn with_daemon(root: PathBuf) -> Self {
        let daemon = Arc::new(super::daemon::DaemonClient::new(root));
        Self {
            backend: daemon.clone(),
            daemon: Some(daemon),
            closing: AtomicBool::new(false),
            launch_epochs: Mutex::new(HashMap::new()),
            workspace_gate: Mutex::new(()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create(
        &self,
        request: CreateTerminalRequest,
        channel: Channel<TerminalEvent>,
        bind: impl FnOnce(&TerminalSession),
    ) -> Result<TerminalSession, AppError> {
        let _guard = self.lock_workspace();
        self.validate_launch(&request)?;
        let cwd = super::launch::resolve_cwd(request.cwd.as_deref())?;
        let exited = Arc::new(AtomicBool::new(false));
        let hook = request.launch_overlay.hook.clone();
        let output_acknowledgements = request.launch_overlay.output_acknowledgements;
        let result = self.backend.spawn(
            request,
            Arc::new(TauriSink {
                channel,
                hook: hook.clone(),
                sessions: self.sessions.clone(),
                exited: exited.clone(),
                output_acknowledgements,
            }),
        );
        if let Ok(session) = &result {
            let mut sessions = self.sessions.lock().unwrap();
            if !exited.load(Ordering::Acquire) {
                sessions.insert(session.id.clone(), cwd);
            }
        }
        if let (Some(hook), Ok(session)) = (hook, &result) {
            hook.bind(&session.id);
        }
        if let Ok(session) = &result {
            bind(session);
        }
        result
    }

    fn validate_launch(&self, request: &CreateTerminalRequest) -> Result<(), AppError> {
        if self.closing.load(Ordering::Acquire) {
            return Err(AppError::io("正在退出，已停止创建新任务"));
        }
        if request
            .tab_id
            .as_ref()
            .is_some_and(|id| self.launch_epoch(id) != request.launch_overlay.launch_epoch)
        {
            return Err(AppError::io("会话已关闭，已取消迟到的创建请求"));
        }
        Ok(())
    }

    pub(crate) fn lock_workspace(&self) -> MutexGuard<'_, ()> {
        self.workspace_gate.lock().unwrap()
    }

    pub(crate) fn has_sessions_in(&self, root: &Path) -> bool {
        let canonical = crate::resource::canonicalize(root).unwrap_or_else(|_| root.to_owned());
        if let Some(daemon) = &self.daemon {
            return daemon
                .list()
                .map(|sessions| {
                    sessions.iter().any(|info| {
                        info.session.status == super::contracts::TerminalStatus::Running
                            && crate::resource::file_uri_to_path(&info.session.cwd).is_ok_and(
                                |path| {
                                    crate::resource::canonicalize(&path)
                                        .unwrap_or(path)
                                        .starts_with(&canonical)
                                },
                            )
                    })
                })
                .unwrap_or(true);
        }
        self.sessions
            .lock()
            .unwrap()
            .values()
            .any(|path| path.starts_with(&canonical))
    }

    pub fn prepare_attachment(&self, request: &mut CreateTerminalRequest) -> Result<(), AppError> {
        let Some(daemon) = &self.daemon else {
            return Ok(());
        };
        daemon.refresh()?;
        let info = if let Some(id) = &request.launch_overlay.attachment {
            Some(daemon.attachment(id)?)
        } else if let Some(tab) = &request.tab_id {
            daemon.lookup(tab)?
        } else {
            None
        };
        if let Some(info) = info {
            request.resume = info.native_session.map(|session| session.id);
            request.launch_overlay.attachment = Some(info.session.id);
        }
        Ok(())
    }

    pub fn close_tab(&self, tab_id: &str) -> Result<Vec<String>, AppError> {
        let _guard = self.lock_workspace();
        if self.closing.load(Ordering::Acquire) {
            return Ok(vec![]);
        }
        if let Some(daemon) = &self.daemon {
            daemon.refresh()?;
            let ids = daemon
                .list()?
                .into_iter()
                .filter(|info| info.tab_id.as_deref() == Some(tab_id))
                .map(|info| info.session.id)
                .collect();
            daemon.close_tab(tab_id)?;
            return Ok(ids);
        }
        Ok(vec![])
    }

    pub fn uses_daemon(&self) -> bool {
        self.daemon.is_some()
    }
    pub fn launch_epoch(&self, tab: &str) -> u64 {
        *self.launch_epochs.lock().unwrap().get(tab).unwrap_or(&0)
    }
    pub fn cancel_pending(&self, tab: &str) {
        let mut epochs = self.launch_epochs.lock().unwrap();
        *epochs.entry(tab.into()).or_default() += 1;
    }
    pub fn background_sessions(&self) -> Result<Vec<super::daemon::SessionInfo>, AppError> {
        self.daemon
            .as_ref()
            .map_or_else(|| Ok(vec![]), |daemon| daemon.list())
    }
    pub fn workspace_lease(&self) -> Result<Option<super::daemon::LeaseGuard>, AppError> {
        self.daemon
            .as_ref()
            .map(|daemon| daemon.workspace_lease())
            .transpose()
    }

    pub fn detach(&self, id: &str, connection: &str) {
        if let Some(daemon) = &self.daemon {
            daemon.detach(id, connection);
        }
    }

    pub fn acknowledge_output(&self, id: &str, connection: &str, delivery: u64) -> bool {
        self.daemon
            .as_ref()
            .is_some_and(|daemon| daemon.acknowledge(id, connection, delivery))
    }

    pub fn prepare_exit(&self, terminate: bool) -> Result<(), AppError> {
        let _guard = self.lock_workspace();
        self.closing.store(true, Ordering::Release);
        if let Some(daemon) = &self.daemon {
            if terminate {
                if let Err(error) = daemon.shutdown() {
                    self.closing.store(false, Ordering::Release);
                    return Err(error);
                }
            }
            daemon.detach_all();
        } else if terminate {
            self.backend.close_all();
        }
        Ok(())
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
        if self.closing.load(Ordering::Acquire) {
            return Ok(());
        }
        self.backend.close(session_id)
    }
}

struct TauriSink {
    channel: Channel<TerminalEvent>,
    hook: Option<Arc<crate::agent::hooks::HookConnection>>,
    sessions: Arc<Mutex<HashMap<String, PathBuf>>>,
    exited: Arc<AtomicBool>,
    output_acknowledgements: bool,
}

impl TerminalEventSink for TauriSink {
    fn uses_output_acknowledgements(&self) -> bool {
        self.output_acknowledgements
    }

    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        if let TerminalEvent::OutputBatch { events, .. } = &event {
            for event in events {
                self.observe_exit(event);
            }
        } else {
            self.observe_exit(&event);
        }
        self.channel
            .send(event)
            .map_err(|error| AppError::io(error.to_string()))
    }
}

impl TauriSink {
    fn observe_exit(&self, event: &TerminalEvent) {
        if let TerminalEvent::Exit { session_id, .. } = &event {
            let mut sessions = self.sessions.lock().unwrap();
            self.exited.store(true, Ordering::Release);
            sessions.remove(session_id);
        }
        if let (
            Some(hook),
            TerminalEvent::Exit {
                session_id,
                exit_code,
                reason,
            },
        ) = (&self.hook, &event)
        {
            hook.exited(
                session_id,
                *exit_code,
                *reason == super::contracts::TerminalExitReason::Terminated,
            );
        }
    }
}
