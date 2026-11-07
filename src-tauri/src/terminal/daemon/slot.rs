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
        let mut candidate = target(request);
        // 名册客户端（房间独立窗口）只知道标签与类型，不知道启动目录：cwd 缺失时
        // 这一项不比对，其余的照旧——带着别条会话的接驳号或换了项目来，仍然拒绝。
        if request.cwd.is_none() {
            let mut stored = self.target.clone();
            if let (Some(left), Some(right)) = (candidate.as_object_mut(), stored.as_object_mut()) {
                left.remove("cwd");
                right.remove("cwd");
            }
            return candidate == stored;
        }
        self.target == candidate
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

    pub fn bind_native_session(&self, id: &str, session: AgentSessionRef) -> Result<(), AppError> {
        session.validate().map_err(AppError::invalid_argument)?;
        if self.is_closed() || self.profile_id != format!("agent:{}", session.agent.command_name())
        {
            return Err(AppError::invalid_argument(
                "原生会话身份与后台任务类型不匹配",
            ));
        }
        let mut data = self.data.lock().unwrap();
        if data
            .native_session
            .as_ref()
            .is_some_and(|known| known != &session)
        {
            return Err(AppError::invalid_argument("后台已记录更新的原生会话身份"));
        }
        data.native_session = Some(session.clone());
        data.replay.push(TerminalEvent::SessionIdentity {
            session_id: id.into(),
            session,
        });
        self.changed.notify_all();
        Ok(())
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
            TerminalEvent::SessionIdentity { session, .. } => {
                data.native_session = Some(session.clone());
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
        let mut data = self.data.lock().unwrap();
        // 回放声明不作为新观察写回身份；持锁快照，避免覆盖并发到达的 Hook/原生身份。
        if let Some(snapshot) = data.latest_hook.clone() {
            data.replay.push(TerminalEvent::AgentState {
                session_id: id.into(),
                snapshot,
            });
        }
        if let Some(session) = data.native_session.clone() {
            data.replay.push(TerminalEvent::SessionIdentity {
                session_id: id.into(),
                session,
            });
        }
        self.changed.notify_all();
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
