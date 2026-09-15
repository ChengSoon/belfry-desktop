use super::super::{
    AppError, CreateTerminalRequest, TerminalEvent,
    backend::TerminalEventSink,
    contracts::{TerminalExitReason, TerminalSession, TerminalStatus},
};
use super::{
    protocol::{PollResult, SessionInfo},
    replay::Replay,
};
use crate::agent::{
    AgentKind, AgentSessionRef,
    hooks::{HookConnection, HookSnapshot},
};
use std::sync::{
    Arc, Condvar, Mutex, Weak,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

pub struct Slot {
    pub closed: AtomicBool,
    pub relay_key: String,
    relay: Weak<super::relay::Relay>,
    pub tab_id: Option<String>,
    pub profile_id: String,
    target: serde_json::Value,
    data: Mutex<Data>,
    changed: Condvar,
}

struct Data {
    session: Option<TerminalSession>,
    replay: Replay,
    exit_code: Option<i32>,
    native_session: Option<AgentSessionRef>,
    latest_hook: Option<HookSnapshot>,
}

impl Slot {
    pub fn new(request: &CreateTerminalRequest, relay: Weak<super::relay::Relay>) -> Arc<Self> {
        let native_session = match request.profile_id.as_str() {
            "agent:codex" => request.resume.clone().map(|id| AgentSessionRef {
                agent: AgentKind::Codex,
                id,
            }),
            "agent:claude" => request
                .resume
                .clone()
                .or_else(|| request.env.get("BELFRY_PLUGIN_CLAUDE_SESSION_ID").cloned())
                .map(|id| AgentSessionRef {
                    agent: AgentKind::Claude,
                    id,
                }),
            _ => None,
        };
        Arc::new(Self {
            closed: AtomicBool::new(false),
            relay_key: ulid::Ulid::generate().to_string(),
            relay,
            tab_id: request.tab_id.clone(),
            profile_id: request.profile_id.clone(),
            target: target(request),
            data: Mutex::new(Data {
                session: None,
                replay: Replay::default(),
                exit_code: None,
                native_session,
                latest_hook: None,
            }),
            changed: Condvar::new(),
        })
    }

    pub fn matches(&self, request: &CreateTerminalRequest) -> bool {
        self.target == target(request)
    }

    pub fn bind(&self, session: TerminalSession) -> TerminalSession {
        let mut data = self.data.lock().unwrap();
        let mut session = session;
        if let Some(code) = data.exit_code {
            session.status = TerminalStatus::Exited;
            session.exit_code = Some(code);
        }
        data.session = Some(session.clone());
        session
    }

    pub fn info(&self) -> SessionInfo {
        let data = self.data.lock().unwrap();
        SessionInfo {
            session: data
                .session
                .clone()
                .expect("slot is bound before publication"),
            tab_id: self.tab_id.clone(),
            profile_id: self.profile_id.clone(),
            native_session: data.native_session.clone(),
        }
    }

    pub fn push(&self, event: TerminalEvent) {
        let mut data = self.data.lock().unwrap();
        match &event {
            TerminalEvent::Exit { exit_code, .. } => {
                if let Some(relay) = self.relay.upgrade() {
                    relay.remove(&self.relay_key);
                }
                data.exit_code = Some(*exit_code);
                if let Some(session) = &mut data.session {
                    session.status = TerminalStatus::Exited;
                    session.exit_code = Some(*exit_code);
                }
            }
            TerminalEvent::AgentState { snapshot, .. } => {
                if snapshot.session.is_some() {
                    data.native_session = snapshot.session.clone();
                }
                data.latest_hook = Some(snapshot.clone());
            }
            _ => {}
        }
        data.replay.push(event);
        self.changed.notify_all();
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub fn poll(&self, id: &str, cursor: u64) -> Result<PollResult, String> {
        let mut data = self.data.lock().unwrap();
        let page = data.replay.read(id, cursor)?;
        if !page.frames.is_empty() || page.gap.is_some() || data.exit_code.is_some() {
            return Ok(page);
        }
        data = self
            .changed
            .wait_timeout(data, Duration::from_millis(500))
            .unwrap()
            .0;
        data.replay.read(id, cursor)
    }

    pub fn announce_hook(&self, id: &str) {
        let snapshot = self.data.lock().unwrap().latest_hook.clone();
        if let Some(snapshot) = snapshot {
            self.push(TerminalEvent::AgentState {
                session_id: id.into(),
                snapshot,
            });
        }
    }
}

fn target(request: &CreateTerminalRequest) -> serde_json::Value {
    serde_json::json!({ "tab": request.tab_id, "profile": request.profile_id, "cwd": request.cwd,
        "collaboration": request.collaboration_mode, "ssh": request.ssh.as_ref().map(|target| serde_json::json!({
            "host": target.host, "user": target.user, "port": target.port, "remotePath": target.remote_path })) })
}

pub struct CacheSink {
    pub slot: Arc<Slot>,
    pub hook: Option<Arc<HookConnection>>,
}
impl TerminalEventSink for CacheSink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
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
                *reason == TerminalExitReason::Terminated,
            );
        }
        // 写入内存缓存永不因 UI 断线失败，PTY 的 reader 因而不会误杀后台任务。
        self.slot.push(event);
        Ok(())
    }
}
