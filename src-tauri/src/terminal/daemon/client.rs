use super::super::{
    AppError, CreateTerminalRequest,
    backend::{PtyBackend, TerminalEventSink},
    contracts::{TerminalEvent, TerminalPalette, TerminalSession, TerminalSize},
};
use super::{
    endpoint, files,
    protocol::{Command, Endpoint, FLAG, PollResult, SessionInfo},
    transport,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Command as Process, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

pub struct DaemonClient {
    root: PathBuf,
    endpoint: Mutex<Option<Endpoint>>,
    polls: Mutex<HashMap<String, (String, Arc<AtomicBool>)>>,
}

impl DaemonClient {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            endpoint: Mutex::new(None),
            polls: Mutex::new(HashMap::new()),
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
        transport::call(&self.endpoint()?, command).map_err(AppError::io)
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
        self.call(Command::List)
    }
    pub fn workspace_lease(&self) -> Result<super::LeaseGuard, AppError> {
        super::LeaseGuard::acquire(self.endpoint()?)
    }

    pub fn attachment(&self, id: &str) -> Result<SessionInfo, AppError> {
        self.call(Command::Info { id: id.into() })
    }
    pub fn lookup(&self, tab_id: &str) -> Result<Option<SessionInfo>, AppError> {
        self.call(Command::Lookup {
            tab_id: tab_id.into(),
        })
    }
    pub fn close_tab(&self, tab_id: &str) -> Result<(), AppError> {
        self.call(Command::CloseTab {
            tab_id: tab_id.into(),
        })
    }

    pub fn detach(&self, id: &str, connection: &str) {
        let mut polls = self.polls.lock().unwrap();
        if polls
            .get(id)
            .is_some_and(|(current, _)| current == connection)
        {
            if let Some((_, active)) = polls.remove(id) {
                active.store(false, Ordering::Release);
            }
        }
    }

    pub fn detach_all(&self) {
        for (_, (_, active)) in self.polls.lock().unwrap().drain() {
            active.store(false, Ordering::Release);
        }
    }

    pub fn shutdown(&self) -> Result<(), AppError> {
        self.call(Command::Shutdown)
    }

    fn subscribe(
        &self,
        session: &mut TerminalSession,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<(), AppError> {
        let endpoint = self.endpoint()?;
        let active = Arc::new(AtomicBool::new(true));
        let connection = ulid::Ulid::generate().to_string();
        session.connection_id = Some(connection.clone());
        if let Some((_, previous)) = self
            .polls
            .lock()
            .unwrap()
            .insert(session.id.clone(), (connection, active.clone()))
        {
            previous.store(false, Ordering::Release);
        }
        let id = session.id.clone();
        thread::spawn(move || poll(endpoint, id, sink, active));
        Ok(())
    }
}

impl PtyBackend for DaemonClient {
    fn spawn(
        &self,
        request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalSession, AppError> {
        let overlay = files::encode(&request.launch_overlay)?;
        let attachment = request.launch_overlay.attachment.clone();
        let mut session: TerminalSession = self.call(Command::Create {
            launch: request,
            overlay,
            attachment,
        })?;
        self.subscribe(&mut session, sink)?;
        Ok(session)
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
        self.call(Command::Close { id: id.into() })
    }
    fn close_all(&self) {
        let _ = self.shutdown();
    }
}

impl Drop for DaemonClient {
    fn drop(&mut self) {
        self.detach_all();
    }
}

fn poll(endpoint: Endpoint, id: String, sink: Arc<dyn TerminalEventSink>, active: Arc<AtomicBool>) {
    let mut cursor = 0;
    while active.load(Ordering::Acquire) {
        let page = transport::call::<PollResult>(
            &endpoint,
            Command::Poll {
                id: id.clone(),
                cursor,
            },
        );
        if !active.load(Ordering::Acquire) {
            break;
        }
        let page = match page {
            Ok(page) => page,
            Err(_) => {
                let _ = sink.send(TerminalEvent::Disconnected {
                    session_id: id.clone(),
                    message: "后台连接已中断。可重新连接；原任务不会被自动重启。".into(),
                });
                break;
            }
        };
        cursor = page.cursor;
        if page.gap.is_some_and(|gap| sink.send(gap).is_err()) {
            break;
        }
        if forward(page.frames, &sink) {
            break;
        }
    }
    active.store(false, Ordering::Release);
}

fn forward(frames: Vec<super::protocol::Frame>, sink: &Arc<dyn TerminalEventSink>) -> bool {
    for frame in frames {
        let ended = matches!(frame.event, TerminalEvent::Exit { .. });
        if sink.send(frame.event).is_err() || ended {
            return true;
        }
    }
    false
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
