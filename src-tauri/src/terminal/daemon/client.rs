use super::super::{
    AppError, CreateTerminalRequest,
    backend::{PtyBackend, TerminalEventSink},
    contracts::{AppErrorCode, TerminalPalette, TerminalSession, TerminalSize, TerminalStatus},
};
use super::{
    endpoint, files,
    protocol::{Command, Endpoint, FLAG, SessionInfo},
    subscriptions::Subscriptions,
    transport,
};
use std::{
    path::{Path, PathBuf},
    process::{Command as Process, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub struct DaemonClient {
    root: PathBuf,
    endpoint: Mutex<Option<Endpoint>>,
    polls: Subscriptions,
    capabilities: Mutex<Option<(String, Vec<String>)>>,
    identities: Arc<super::identity::NativeIdentities>,
}

impl DaemonClient {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            endpoint: Mutex::new(None),
            polls: Subscriptions::default(),
            capabilities: Mutex::new(None),
            identities: Arc::new(super::identity::NativeIdentities::default()),
        }
    }

    fn endpoint(&self) -> Result<Endpoint, AppError> {
        let mut endpoint = self.endpoint.lock().unwrap();
        if endpoint.is_none() {
            *endpoint = Some(connect_or_start(&self.root).map_err(AppError::io)?);
        }
        Ok(endpoint.as_ref().unwrap().clone())
    }

    pub fn call<T: serde::de::DeserializeOwned>(&self, command: Command) -> Result<T, AppError> {
        transport::call_app(&self.endpoint()?, command)
    }

    pub fn refresh(&self) -> Result<(), AppError> {
        let mut current = self.endpoint.lock().unwrap();
        let online = current.as_ref().is_some_and(|endpoint| {
            transport::call::<serde_json::Value>(endpoint, Command::Ping).is_ok()
        });
        if !online {
            *current = Some(connect_or_start(&self.root).map_err(AppError::io)?);
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
        let sessions: Vec<SessionInfo> = self.call(Command::List)?;
        Ok(sessions
            .into_iter()
            .map(|info| self.with_native_session(info))
            .collect())
    }
    pub fn workspace_lease(&self) -> Result<super::LeaseGuard, AppError> {
        super::LeaseGuard::acquire(self.endpoint()?)
    }

    pub fn attachment(&self, id: &str) -> Result<SessionInfo, AppError> {
        let info = self.call(Command::Info { id: id.into() })?;
        Ok(self.with_native_session(info))
    }
    pub fn lookup(&self, tab_id: &str) -> Result<Option<SessionInfo>, AppError> {
        let info: Option<SessionInfo> = self.call(Command::Lookup {
            tab_id: tab_id.into(),
        })?;
        Ok(info.map(|info| self.with_native_session(info)))
    }
    pub fn close_tab(&self, tab_id: &str) -> Result<(), AppError> {
        self.call(Command::CloseTab {
            tab_id: tab_id.into(),
        })
    }

    pub fn detach(&self, id: &str, connection: &str) {
        self.polls.detach(id, connection);
        self.identities.detach(id, connection);
    }

    pub fn detach_all(&self) {
        self.polls.detach_all();
        self.identities.detach_all();
    }

    pub fn acknowledge(&self, id: &str, connection: &str, delivery: u64) -> bool {
        self.polls.acknowledge(id, connection, delivery)
    }

    pub fn shutdown(&self) -> Result<(), AppError> {
        self.call(Command::Shutdown)
    }

    fn supports(&self, capability: &str) -> Result<bool, AppError> {
        let endpoint = self.endpoint()?;
        let mut cached = self.capabilities.lock().unwrap();
        if cached
            .as_ref()
            .is_none_or(|(instance, _)| instance != &endpoint.instance)
        {
            let reply: serde_json::Value = transport::call_app(&endpoint, Command::Ping)?;
            let capabilities = reply["capabilities"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(String::from))
                .collect();
            *cached = Some((endpoint.instance, capabilities));
        }
        Ok(cached
            .as_ref()
            .unwrap()
            .1
            .iter()
            .any(|value| value == capability))
    }

    fn with_native_session(&self, info: SessionInfo) -> SessionInfo {
        self.identities.enrich(info)
    }

    pub fn bind_native_session(
        &self,
        id: &str,
        session: crate::agent::AgentSessionRef,
    ) -> Result<(), AppError> {
        session.validate().map_err(AppError::invalid_argument)?;
        let info: SessionInfo = self.call(Command::Info { id: id.into() })?;
        if info.profile_id != format!("agent:{}", session.agent.command_name()) {
            return Err(AppError::invalid_argument(
                "原生会话身份与后台任务类型不匹配",
            ));
        }
        // 旧 daemon 不认识新命令：保留宿主缓存并通知 UI，不能为了升级停止用户任务。
        if self.supports("session_identity")? {
            self.call::<()>(Command::BindIdentity {
                id: id.into(),
                session: self
                    .identities
                    .resolve(id, &session, info.native_session.as_ref()),
            })?;
        }
        self.identities
            .publish(id, &session, info.native_session.as_ref());
        Ok(())
    }

    fn create_session(
        &self,
        request: &CreateTerminalRequest,
        recover_exited: bool,
    ) -> Result<TerminalSession, AppError> {
        self.call(Command::Create {
            launch: request.clone(),
            overlay: files::encode(&request.launch_overlay)?,
            attachment: request.launch_overlay.attachment.clone(),
            recover_exited,
        })
    }

    pub fn spawn_prepared(
        &self,
        mut request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
        prepare_new: impl FnOnce(&mut CreateTerminalRequest) -> Result<(), AppError>,
    ) -> Result<TerminalSession, AppError> {
        let recover_exited = request.launch_overlay.recover_exited;
        let mut prepare_new = Some(prepare_new);
        if request.launch_overlay.attachment.is_none() {
            prepare_new.take().unwrap()(&mut request)?;
        }
        // 先让 daemon 校验目标。未订阅旧输出前区分回放和恢复，避免旧 Exit 关闭新输入。
        let mut session = self.create_session(&request, false)?;
        if recover_exited && session.reconnected && session.status == TerminalStatus::Exited {
            let info = self.attachment(&session.id)?;
            request.merge_native_session(info.native_session.as_ref());
            request.launch_overlay.attachment = Some(session.id.clone());
            let original_cwd = request.cwd.clone();
            request.cwd.get_or_insert(session.cwd.clone());
            if let Some(prepare) = prepare_new.take() {
                prepare(&mut request)?;
            }
            request.cwd = original_cwd;
            if self.supports("recover_exited")? {
                session = self.create_session(&request, true)?;
            } else {
                // Create 已验证标签/项目/类型，而且该 ID 明确已退出。只关闭这一条，
                // 不用 CloseTab（其他客户端可能已为同一标签建立新 PTY）。
                match self.call::<()>(Command::Close {
                    id: session.id.clone(),
                }) {
                    Ok(()) => {}
                    Err(error) if error.code == AppErrorCode::SessionMissing => {}
                    Err(error) => return Err(error),
                }
                self.identities.forget(&session.id);
                request.launch_overlay.attachment = None;
                request.cwd.get_or_insert(session.cwd);
                session = self.create_session(&request, false)?;
            }
            // 新进程立即退出也只返回结果，不再恢复；一次调用最多创建一个新进程。
        }
        let initial_identity = request.resume.as_ref().and_then(|id| {
            let agent = match request.profile_id.as_str() {
                "agent:codex" => crate::agent::AgentKind::Codex,
                "agent:claude" => crate::agent::AgentKind::Claude,
                _ => return None,
            };
            Some(crate::agent::AgentSessionRef {
                agent,
                id: id.clone(),
            })
        });
        self.subscribe(
            &mut session,
            sink,
            initial_identity.as_ref(),
            request.profile_id.starts_with("agent:"),
        )?;
        Ok(session)
    }

    fn subscribe(
        &self,
        session: &mut TerminalSession,
        sink: Arc<dyn TerminalEventSink>,
        initial_identity: Option<&crate::agent::AgentSessionRef>,
        watch_identity: bool,
    ) -> Result<(), AppError> {
        let endpoint = self.endpoint()?;
        let stream = if watch_identity {
            self.identities.observe(sink.clone())
        } else {
            sink.clone()
        };
        self.polls.start(session, endpoint, stream, |session| {
            if watch_identity {
                // 初始身份在回放开始前发送；后来的 Hook 能更新身份，旧 resume 不会压过它。
                self.identities.listen(session, sink, initial_identity);
            }
        });
        Ok(())
    }
}

impl PtyBackend for DaemonClient {
    fn spawn(
        &self,
        request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalSession, AppError> {
        self.spawn_prepared(request, sink, |_| Ok(()))
    }
    fn write(&self, id: &str, bytes: &[u8]) -> Result<(), AppError> {
        self.call(Command::Write {
            id: id.into(),
            bytes: bytes.into(),
        })
    }
    fn resize(&self, id: &str, size: TerminalSize) -> Result<(), AppError> {
        self.call(Command::Resize {
            id: id.into(),
            cols: size.cols,
            rows: size.rows,
        })
    }
    fn set_palette(&self, id: &str, palette: &TerminalPalette) -> Result<(), AppError> {
        self.call(Command::Palette {
            id: id.into(),
            palette: palette.clone(),
        })
    }
    fn close(&self, id: &str) -> Result<(), AppError> {
        self.call::<()>(Command::Close { id: id.into() })?;
        self.identities.forget(id);
        Ok(())
    }
    fn close_all(&self) {
        let _ = self.shutdown();
        self.detach_all();
    }
}

impl Drop for DaemonClient {
    fn drop(&mut self) {
        self.detach_all();
    }
}

fn connect_or_start(root: &Path) -> Result<Endpoint, String> {
    if let Ok(endpoint) = endpoint::read(root) {
        if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_ok() {
            return Ok(endpoint);
        }
    }
    endpoint::private_directory(root)?;
    let mut command = Process::new(std::env::current_exe().map_err(|error| error.to_string())?);
    command
        .arg(FLAG)
        .arg(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动终端后台：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Ok(endpoint) = endpoint::read(root) {
            if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_ok() {
                thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(endpoint);
            }
        }
        if Instant::now() >= deadline {
            break;
        }
        let _ = child.try_wait();
        thread::sleep(Duration::from_millis(40));
    }
    Err("终端后台未就绪，可能有不兼容的旧后台仍在运行。原任务已保留。".into())
}

fn detach_process(command: &mut Process) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe extern "C" {
            fn setsid() -> i32;
        }
        unsafe {
            command.pre_exec(|| {
                if setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | NEW_PROCESS_GROUP);
    }
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
