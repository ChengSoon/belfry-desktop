use super::super::{
    AppError, CreateTerminalRequest,
    backend::PtyBackend,
    contracts::{TerminalSession, TerminalSize, TerminalStatus},
    native::NativePtyBackend,
};
use super::{
    files,
    protocol::{Command, MAX_SESSIONS, Reply, SessionInfo, WireOverlay},
    slot::{CacheSink, Slot},
};
use crate::agent::hooks::HookRuntime;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

pub struct Service {
    pub running: AtomicBool,
    root: PathBuf,
    backend: Arc<dyn PtyBackend>,
    hooks: HookRuntime,
    slots: Mutex<HashMap<String, Arc<Slot>>>,
    operation: Mutex<()>,
    relay: Arc<super::relay::Relay>,
    leases: super::leases::Leases,
}

impl Service {
    pub fn new(root: PathBuf) -> Result<Arc<Self>, AppError> {
        Ok(Arc::new(Self {
            running: AtomicBool::new(true),
            root,
            backend: Arc::new(NativePtyBackend::default()),
            hooks: HookRuntime::default(),
            slots: Mutex::new(HashMap::new()),
            operation: Mutex::new(()),
            relay: super::relay::Relay::start()?,
            leases: Default::default(),
        }))
    }

    pub fn handle(&self, command: Command) -> Reply {
        match self.dispatch(command) {
            Ok(value) => Reply::ok(value),
            Err(error) => Reply::error(error.message),
        }
    }

    fn dispatch(&self, command: Command) -> Result<serde_json::Value, AppError> {
        let value = match command {
            Command::Ping => Ok(
                serde_json::json!({ "version": super::protocol::VERSION, "pid": std::process::id() }),
            ),
            Command::Create {
                launch,
                overlay,
                attachment,
            } => serde_json::to_value(self.create(launch, overlay, attachment)?),
            Command::Info { id } => serde_json::to_value(self.slot(&id)?.info()),
            Command::Lookup { tab_id } => serde_json::to_value(
                self.slots
                    .lock()
                    .unwrap()
                    .values()
                    .find(|slot| !slot.is_closed() && slot.tab_id.as_ref() == Some(&tab_id))
                    .map(|slot| slot.info()),
            ),
            Command::Poll { id, cursor } => {
                serde_json::to_value(self.slot(&id)?.poll(&id, cursor).map_err(AppError::io)?)
            }
            Command::List => serde_json::to_value(self.list()),
            other => return self.mutate(other),
        };
        value.map_err(|error| AppError::io(error.to_string()))
    }

    fn mutate(&self, command: Command) -> Result<serde_json::Value, AppError> {
        match command {
            Command::Write { id, bytes } => self.backend.write(&id, &bytes)?,
            Command::Resize { id, cols, rows } => {
                self.backend.resize(&id, TerminalSize { cols, rows })?
            }
            Command::Palette { id, palette } => self.backend.set_palette(&id, &palette)?,
            Command::Close { id } => self.close(&id)?,
            Command::CloseTab { tab_id } => self.close_tab(&tab_id)?,
            Command::Shutdown => self.shutdown(),
            other => return self.workspace_command(other),
        }
        Ok(serde_json::Value::Null)
    }

    fn workspace_command(&self, command: Command) -> Result<serde_json::Value, AppError> {
        match command {
            Command::AcquireWorkspace => {
                let _operation = self.operation.lock().unwrap();
                return Ok(serde_json::json!(self.leases.acquire()?));
            }
            Command::RenewWorkspace { token } => self.leases.renew(&token)?,
            Command::ReleaseWorkspace { token } => self.leases.release(&token),
            _ => return Err(AppError::invalid_argument("后台操作无效")),
        }
        Ok(serde_json::Value::Null)
    }

    pub fn create(
        &self,
        mut request: CreateTerminalRequest,
        overlay: WireOverlay,
        attachment: Option<String>,
    ) -> Result<TerminalSession, AppError> {
        let _operation = self.operation.lock().unwrap();
        if !self.running.load(Ordering::Acquire) {
            return Err(AppError::io("后台正在退出，请稍后重试"));
        }
        request.validate()?;
        if let Some(slot) = self.existing(&request, attachment.as_deref())? {
            return self.reconnect(&slot, &mut request);
        }
        self.spawn_new(request, overlay)
    }

    fn reconnect(
        &self,
        slot: &Slot,
        request: &mut CreateTerminalRequest,
    ) -> Result<TerminalSession, AppError> {
        let mut session = slot.info().session;
        session.reconnected = true;
        if session.status != TerminalStatus::Running {
            return Ok(session);
        }
        self.relay.bind(&slot.relay_key, request)?;
        if let Err(error) = self.backend.resize(
            &session.id,
            TerminalSize {
                cols: request.cols,
                rows: request.rows,
            },
        ) {
            let mut ended = slot.info().session;
            if ended.status == TerminalStatus::Exited {
                ended.reconnected = true;
                return Ok(ended);
            }
            return Err(error);
        }
        if let Some(palette) = &request.palette {
            self.backend.set_palette(&session.id, palette)?;
        }
        session.cols = request.cols;
        session.rows = request.rows;
        slot.announce_hook(&session.id);
        Ok(session)
    }

    fn spawn_new(
        &self,
        mut request: CreateTerminalRequest,
        overlay: WireOverlay,
    ) -> Result<TerminalSession, AppError> {
        self.make_room()?;
        self.leases.allow_spawn()?;
        request.launch_overlay = files::decode(overlay, &self.root)?;
        let slot = Slot::new(&request, Arc::downgrade(&self.relay));
        self.relay.bind(&slot.relay_key, &mut request)?;
        let weak = Arc::downgrade(&slot);
        self.hooks.prepare_sink(
            &mut request,
            Arc::new(move |session_id, snapshot| {
                if let Some(slot) = weak.upgrade() {
                    slot.push(super::super::TerminalEvent::AgentState {
                        session_id,
                        snapshot,
                    });
                }
            }),
        );
        let hook = request.launch_overlay.hook.clone();
        let sink = Arc::new(CacheSink {
            slot: slot.clone(),
            hook: hook.clone(),
        });
        let session = match self.backend.spawn(request, sink) {
            Ok(session) => slot.bind(session),
            Err(error) => {
                self.relay.remove(&slot.relay_key);
                return Err(error);
            }
        };
        if let Some(hook) = hook {
            hook.bind(&session.id);
        }
        self.slots.lock().unwrap().insert(session.id.clone(), slot);
        Ok(session)
    }

    fn existing(
        &self,
        request: &CreateTerminalRequest,
        attachment: Option<&str>,
    ) -> Result<Option<Arc<Slot>>, AppError> {
        let slots = self.slots.lock().unwrap();
        let found = match attachment {
            Some(id) => Some(slots.get(id).cloned().ok_or_else(missing)?),
            None => request.tab_id.as_ref().and_then(|id| {
                slots
                    .values()
                    .find(|slot| !slot.is_closed() && slot.tab_id.as_ref() == Some(id))
                    .cloned()
            }),
        };
        if found.as_ref().is_some_and(|slot| !slot.matches(request)) {
            return Err(AppError::invalid_argument(
                "后台任务的项目或类型已改变，请先结束原任务再重新启动",
            ));
        }
        Ok(found)
    }

    fn make_room(&self) -> Result<(), AppError> {
        let mut slots = self.slots.lock().unwrap();
        slots.retain(|_, slot| {
            !slot.is_closed() || slot.info().session.status == TerminalStatus::Running
        });
        if slots.len() >= MAX_SESSIONS {
            return Err(AppError::invalid_argument(
                "后台最多保留 64 条会话，请关闭已结束的会话后重试",
            ));
        }
        Ok(())
    }

    fn slot(&self, id: &str) -> Result<Arc<Slot>, AppError> {
        self.slots
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(missing)
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.slots
            .lock()
            .unwrap()
            .values()
            .filter(|slot| {
                !slot.is_closed() || slot.info().session.status == TerminalStatus::Running
            })
            .map(|slot| slot.info())
            .collect()
    }

    fn close(&self, id: &str) -> Result<(), AppError> {
        let _operation = self.operation.lock().unwrap();
        let slot = self.slot(id)?;
        if slot.info().session.status == TerminalStatus::Running {
            self.backend.close(id)?;
        }
        // 回收完成前仍计入目录占用；新建时才能清除已退出且显式关闭的身份。
        slot.closed.store(true, Ordering::Release);
        Ok(())
    }

    fn close_tab(&self, tab_id: &str) -> Result<(), AppError> {
        let ids: Vec<_> = self
            .slots
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, slot)| slot.tab_id.as_deref() == Some(tab_id))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            self.close(&id)?;
        }
        Ok(())
    }

    fn shutdown(&self) {
        let _operation = self.operation.lock().unwrap();
        self.backend.close_all();
        self.running.store(false, Ordering::Release);
    }
}

fn missing() -> AppError {
    AppError::not_found("原后台任务已不存在。请点击「重启」明确启动新进程")
}
