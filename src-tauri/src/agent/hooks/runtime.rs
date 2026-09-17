use super::{
    helper,
    install::Installer,
    registry::{Registry, SessionSpec},
    server::Server,
    settings,
};
use crate::{
    agent::AgentKind,
    terminal::{CreateTerminalRequest, TerminalEvent},
};
use std::sync::{Arc, Weak};
use tauri::ipc::Channel;

pub(crate) struct HookRuntime {
    registry: Arc<Registry>,
    server: Option<Server>,
    pub(super) installer: Installer,
}

impl Default for HookRuntime {
    fn default() -> Self {
        let registry = Arc::new(Registry::default());
        let server = Server::start(registry.clone());
        Self {
            registry,
            server,
            installer: Installer::default(),
        }
    }
}

impl HookRuntime {
    pub fn prepare(&self, request: &mut CreateTerminalRequest, channel: Channel<TerminalEvent>) {
        self.prepare_sink(
            request,
            Arc::new(move |session_id, snapshot| {
                let _ = channel.send(TerminalEvent::AgentState {
                    session_id,
                    snapshot,
                });
            }),
        );
    }

    pub fn prepare_sink(
        &self,
        request: &mut CreateTerminalRequest,
        sink: Arc<dyn Fn(String, super::HookSnapshot) + Send + Sync>,
    ) {
        let Some(tab_id) = request.tab_id.clone() else {
            return;
        };
        let agent = match request.profile_id.as_str() {
            "agent:codex" => AgentKind::Codex,
            "agent:claude" => AgentKind::Claude,
            "agent:pi" => AgentKind::Pi,
            _ => return,
        };
        let report = settings::report(agent);
        let port = self.server.as_ref().map(Server::port);
        let fallback = if port.is_none() {
            "Hook 本机端点不可用，当前使用屏幕推断".into()
        } else {
            report.note.clone()
        };
        let spec = SessionSpec {
            tab_id,
            agent,
            resume_id: request.resume.clone(),
            fallback,
        };
        let Ok(token) = self.registry.issue(spec, sink) else {
            return;
        };
        request
            .launch_overlay
            .unset
            .extend([helper::ENV_PORT.into(), helper::ENV_TOKEN.into()]);
        if let Some(port) = port.filter(|_| report.enabled()) {
            request
                .launch_overlay
                .environment
                .insert(helper::ENV_PORT.into(), port.to_string());
            request
                .launch_overlay
                .environment
                .insert(helper::ENV_TOKEN.into(), token.clone());
        }
        request.launch_overlay.hook = Some(Arc::new(HookConnection {
            registry: Arc::downgrade(&self.registry),
            token,
        }));
    }
}

pub(crate) struct HookConnection {
    registry: Weak<Registry>,
    token: String,
}

impl HookConnection {
    pub fn bind(&self, pty_id: &str) {
        if let Some(registry) = self.registry.upgrade() {
            registry.bind(&self.token, pty_id);
        }
    }

    pub fn exited(&self, pty_id: &str, code: i32, terminated: bool) {
        if let Some(registry) = self.registry.upgrade() {
            registry.bind(&self.token, pty_id);
            registry.exited(&self.token, code, terminated);
        }
    }
}

impl Drop for HookConnection {
    fn drop(&mut self) {
        if let Some(registry) = self.registry.upgrade() {
            registry.revoke(&self.token);
        }
    }
}
