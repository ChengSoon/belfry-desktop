use super::super::{
    AppError, CreateTerminalRequest,
    backend::{PtyBackend, TerminalEventSink},
    contracts::{AppErrorCode, TerminalPalette, TerminalSession, TerminalSize, TerminalStatus},
};
use super::{
    files, generations,
    protocol::{Command, Endpoint, SessionInfo},
    subscriptions::Subscriptions,
    transport,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub struct DaemonClient {
    root: PathBuf,
    endpoint: Mutex<Option<Endpoint>>,
    previous: Mutex<Vec<Endpoint>>,
    routes: Mutex<HashMap<String, Endpoint>>,
    polls: Subscriptions,
    capabilities: Mutex<HashMap<String, Vec<String>>>,
    identities: Arc<super::identity::NativeIdentities>,
}

impl DaemonClient {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            endpoint: Mutex::new(None),
            previous: Mutex::new(Vec::new()),
            routes: Mutex::new(HashMap::new()),
            polls: Subscriptions::default(),
            capabilities: Mutex::new(HashMap::new()),
            identities: Arc::new(super::identity::NativeIdentities::default()),
        }
    }

    fn endpoint(&self) -> Result<Endpoint, AppError> {
        let mut endpoint = self.endpoint.lock().unwrap();
        if endpoint.is_none() {
            let current = generations::connect_or_start(&self.root).map_err(AppError::io)?;
            self.discover_previous(&current);
            *endpoint = Some(current);
        }
        Ok(endpoint.as_ref().unwrap().clone())
    }

    pub fn call<T: serde::de::DeserializeOwned>(&self, command: Command) -> Result<T, AppError> {
        let endpoint = match &command {
            Command::Info { id }
            | Command::Poll { id, .. }
            | Command::Write { id, .. }
            | Command::WriteChecked { id, .. }
            | Command::Resize { id, .. }
            | Command::Palette { id, .. }
            | Command::Close { id }
            | Command::BindIdentity { id, .. } => self.session_endpoint(id)?,
            _ => self.endpoint()?,
        };
        transport::call_app(&endpoint, command)
    }

    pub fn refresh(&self) -> Result<(), AppError> {
        let mut current = self.endpoint.lock().unwrap();
        let online = current.as_ref().is_some_and(|endpoint| {
            transport::call::<serde_json::Value>(endpoint, Command::Ping)
                .is_ok_and(|reply| generations::compatible(&reply, env!("CARGO_PKG_VERSION")))
        });
        if !online {
            let endpoint = generations::connect_or_start(&self.root).map_err(AppError::io)?;
            self.discover_previous(&endpoint);
            *current = Some(endpoint);
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<SessionInfo>, AppError> {
        let current = self.endpoint()?;
        let mut sessions: Vec<SessionInfo> = transport::call_app(&current, Command::List)?;
        self.remember(&current, &sessions);
        for endpoint in self.previous.lock().unwrap().clone() {
            match transport::call_app::<Vec<SessionInfo>>(&endpoint, Command::List) {
                Ok(previous) => {
                    self.remember(&endpoint, &previous);
                    sessions.extend(previous);
                }
                Err(_)
                    if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_err() => {}
                Err(error) => return Err(error),
            }
        }
        Ok(sessions
            .into_iter()
            .map(|info| self.with_native_session(info))
            .collect())
    }
    pub fn workspace_lease(&self) -> Result<super::LeaseGuard, AppError> {
        let mut endpoints = vec![self.endpoint()?];
        for endpoint in self.previous.lock().unwrap().clone() {
            if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_ok() {
                endpoints.push(endpoint);
            }
        }
        super::LeaseGuard::acquire_all(endpoints)
    }

    pub fn attachment(&self, id: &str) -> Result<SessionInfo, AppError> {
        match self.call(Command::Info { id: id.into() }) {
            Ok(info) => Ok(self.with_native_session(info)),
            Err(error) if error.code == AppErrorCode::SessionMissing => {
                for endpoint in self.previous.lock().unwrap().clone() {
                    if let Ok(info) = transport::call_app::<SessionInfo>(
                        &endpoint,
                        Command::Info { id: id.into() },
                    ) {
                        self.remember(&endpoint, std::slice::from_ref(&info));
                        return Ok(self.with_native_session(info));
                    }
                }
                Err(error)
            }
            Err(error) => Err(error),
        }
    }
    pub fn lookup(&self, tab_id: &str) -> Result<Option<SessionInfo>, AppError> {
        let info: Option<SessionInfo> = self.call(Command::Lookup {
            tab_id: tab_id.into(),
        })?;
        if info.is_some() {
            return Ok(info.map(|info| self.with_native_session(info)));
        }
        for endpoint in self.previous.lock().unwrap().clone() {
            if let Ok(Some(info)) = transport::call_app::<Option<SessionInfo>>(
                &endpoint,
                Command::Lookup {
                    tab_id: tab_id.into(),
                },
            ) {
                self.remember(&endpoint, std::slice::from_ref(&info));
                return Ok(Some(self.with_native_session(info)));
            }
        }
        Ok(None)
    }
    pub fn close_tab(&self, tab_id: &str) -> Result<(), AppError> {
        self.call::<()>(Command::CloseTab {
            tab_id: tab_id.into(),
        })?;
        for endpoint in self.previous.lock().unwrap().clone() {
            let sessions = match transport::call_app::<Vec<SessionInfo>>(&endpoint, Command::List) {
                Ok(sessions) => sessions,
                Err(_)
                    if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_err() =>
                {
                    continue;
                }
                Err(error) => return Err(error),
            };
            if !sessions
                .iter()
                .any(|info| info.tab_id.as_deref() == Some(tab_id))
            {
                continue;
            }
            // Closed generations can already have retired; do not revive them.
            if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_ok() {
                transport::call_app::<()>(
                    &endpoint,
                    Command::CloseTab {
                        tab_id: tab_id.into(),
                    },
                )?;
            }
        }
        Ok(())
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
        for endpoint in self.previous.lock().unwrap().clone() {
            if transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_ok() {
                transport::call_app::<()>(&endpoint, Command::Shutdown)?;
            }
        }
        self.call(Command::Shutdown)
    }

    fn supports_on(&self, endpoint: &Endpoint, capability: &str) -> Result<bool, AppError> {
        let mut cached = self.capabilities.lock().unwrap();
        if !cached.contains_key(&endpoint.instance) {
            let reply: serde_json::Value = transport::call_app(&endpoint, Command::Ping)?;
            let capabilities = reply["capabilities"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(String::from))
                .collect();
            cached.insert(endpoint.instance.clone(), capabilities);
        }
        Ok(cached[&endpoint.instance]
            .iter()
            .any(|value| value == capability))
    }

    fn session_endpoint(&self, id: &str) -> Result<Endpoint, AppError> {
        let current = self.endpoint()?;
        Ok(self
            .routes
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .unwrap_or(current))
    }

    fn remember(&self, endpoint: &Endpoint, sessions: &[SessionInfo]) {
        let mut routes = self.routes.lock().unwrap();
        for info in sessions {
            routes.insert(info.session.id.clone(), endpoint.clone());
        }
    }

    fn discover_previous(&self, current: &Endpoint) {
        let mut previous = Vec::new();
        for (endpoint, reply) in generations::online(&self.root) {
            if endpoint.instance == current.instance {
                continue;
            }
            // New generations can atomically stop accepting new sessions, without killing PTYs.
            if generations::supersedes(&reply, env!("CARGO_PKG_VERSION"))
                && reply["capabilities"]
                    .as_array()
                    .is_some_and(|items| items.iter().any(|item| item == "rolling_upgrade_v1"))
            {
                let _ = transport::call_app::<()>(&endpoint, Command::Retire);
            }
            if let Ok(sessions) = transport::call_app::<Vec<SessionInfo>>(&endpoint, Command::List)
            {
                self.remember(&endpoint, &sessions);
                previous.push(endpoint);
            }
        }
        *self.previous.lock().unwrap() = previous;
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
        if info.profile_id != format!("agent:{}", session.agent.id()) {
            return Err(AppError::invalid_argument(
                "原生会话身份与后台任务类型不匹配",
            ));
        }
        // 旧 daemon 不认识新命令：保留宿主缓存并通知 UI，不能为了升级停止用户任务。
        if self.supports_on(&self.session_endpoint(id)?, "session_identity")? {
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
        let endpoint = match request.launch_overlay.attachment.as_deref() {
            Some(id) => self.session_endpoint(id)?,
            None => self.endpoint()?,
        };
        let session: TerminalSession = transport::call_app(
            &endpoint,
            Command::Create {
                launch: request.clone(),
                overlay: files::encode(&request.launch_overlay)?,
                attachment: request.launch_overlay.attachment.clone(),
                recover_exited,
            },
        )?;
        self.routes
            .lock()
            .unwrap()
            .insert(session.id.clone(), endpoint);
        Ok(session)
    }

    pub fn spawn_prepared(
        &self,
        mut request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
        prepare_new: impl FnOnce(&mut CreateTerminalRequest) -> Result<(), AppError>,
    ) -> Result<TerminalSession, AppError> {
        self.endpoint()?;
        if let Some(id) = request.launch_overlay.attachment.as_deref() {
            if !self.routes.lock().unwrap().contains_key(id)
                && !self.previous.lock().unwrap().is_empty()
            {
                self.attachment(id)?;
            }
        }
        // A saved ID, or a tab opened in another window, can belong to a retained generation.
        if request.launch_overlay.attachment.is_none() && !self.previous.lock().unwrap().is_empty()
        {
            if let Some(tab) = request.tab_id.as_deref() {
                if let Some(info) = self.lookup(tab)? {
                    request.launch_overlay.attachment = Some(info.session.id);
                }
            }
        }
        let recover_exited = request.launch_overlay.recover_exited;
        let mut prepare_new = Some(prepare_new);
        if request.launch_overlay.attachment.is_none() {
            prepare_new.take().unwrap()(&mut request)?;
        }
        // 先让 daemon 校验目标。未订阅旧输出前区分回放和恢复，避免旧 Exit 关闭新输入。
        let mut session = match self.create_session(&request, false) {
            Ok(session) => session,
            Err(error)
                if error.code == AppErrorCode::SessionMissing
                    && !self.previous.lock().unwrap().is_empty() =>
            {
                // Another view can have moved this tab to the new daemon while this view still
                // holds the old terminal ID. Resolve only the same tab; Create validates its target.
                let info = request
                    .tab_id
                    .as_deref()
                    .map(|tab| self.lookup(tab))
                    .transpose()?
                    .flatten()
                    .ok_or(error)?;
                request.merge_native_session(info.native_session.as_ref());
                request.launch_overlay.attachment = Some(info.session.id);
                self.create_session(&request, false)?
            }
            Err(error) => return Err(error),
        };
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
            let owner = self.session_endpoint(&session.id)?;
            if owner.instance != self.endpoint()?.instance {
                // Prepare and start the resumed process before retiring the old record. A failed
                // upgrade must leave its history available, and must never replay the last prompt.
                request.launch_overlay.attachment = None;
                request.cwd.get_or_insert(session.cwd.clone());
                let fresh = self.create_session(&request, false)?;
                if let Err(error) = transport::call_app::<()>(
                    &owner,
                    Command::Close {
                        id: session.id.clone(),
                    },
                ) {
                    log::warn!(
                        "Could not retire an exited terminal after upgrade: {}",
                        error.message
                    );
                }
                self.identities.forget(&session.id);
                session = fresh;
            } else if self.supports_on(&owner, "recover_exited")? {
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
            let agent = crate::agent::AgentKind::from_profile_id(&request.profile_id)?;
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
        let endpoint = self.session_endpoint(&session.id)?;
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
    fn write_checked(
        &self,
        id: &str,
        bytes: &[u8],
        expected_program_sequence: Option<u64>,
    ) -> Result<(), AppError> {
        let Some(expected_program_sequence) = expected_program_sequence else {
            return self.write(id, bytes);
        };
        if !self.supports_on(&self.session_endpoint(id)?, "terminal_program_status_v1")? {
            return Err(AppError::conflict(
                "Waiting for a terminal daemon that supports native program status",
            ));
        }
        self.call(Command::WriteChecked {
            id: id.into(),
            bytes: bytes.into(),
            expected_program_sequence,
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

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
