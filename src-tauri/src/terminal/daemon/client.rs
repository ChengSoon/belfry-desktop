use super::super::{
    AppError, CreateTerminalRequest,
    backend::{PtyBackend, TerminalEventSink},
    contracts::{TerminalPalette, TerminalSession, TerminalSize},
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
}

impl DaemonClient {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            endpoint: Mutex::new(None),
            polls: Subscriptions::default(),
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
        self.polls.detach(id, connection);
    }

    pub fn detach_all(&self) {
        self.polls.detach_all();
    }

    pub fn acknowledge(&self, id: &str, connection: &str, delivery: u64) -> bool {
        self.polls.acknowledge(id, connection, delivery)
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
        self.polls.start(session, endpoint, sink);
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
