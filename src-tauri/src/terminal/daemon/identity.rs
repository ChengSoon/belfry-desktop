use super::protocol::SessionInfo;
use crate::{
    agent::AgentSessionRef,
    terminal::{AppError, TerminalEvent, backend::TerminalEventSink, contracts::TerminalSession},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub(super) struct NativeIdentities(Mutex<Data>);

#[derive(Default)]
struct Data {
    native: HashMap<String, AgentSessionRef>,
    hooks: HashMap<String, (u64, AgentSessionRef)>,
    sinks: HashMap<String, (String, Arc<dyn TerminalEventSink>)>,
}

impl NativeIdentities {
    pub fn enrich(&self, mut info: SessionInfo) -> SessionInfo {
        let mut data = self.0.lock().unwrap();
        let id = &info.session.id;
        // daemon 的非空身份是本次查询的事实；本地缓存只补缺失，不能盖掉新 Hook。
        if let Some(session) = &info.native_session {
            data.native.insert(id.clone(), session.clone());
        } else {
            info.native_session = data
                .hooks
                .get(id)
                .map(|(_, session)| session)
                .or_else(|| data.native.get(id))
                .cloned();
        }
        info
    }

    pub fn resolve(
        &self,
        id: &str,
        proposed: &AgentSessionRef,
        remote: Option<&AgentSessionRef>,
    ) -> AgentSessionRef {
        resolve(&self.0.lock().unwrap(), id, proposed, remote)
    }

    pub fn publish(&self, id: &str, proposed: &AgentSessionRef, remote: Option<&AgentSessionRef>) {
        let mut data = self.0.lock().unwrap();
        let session = resolve(&data, id, proposed, remote);
        data.native.insert(id.into(), session.clone());
        for (terminal, sink) in data.sinks.values() {
            if terminal == id {
                let _ = sink.send(TerminalEvent::SessionIdentity {
                    session_id: id.into(),
                    session: session.clone(),
                });
            }
        }
    }

    pub fn listen(
        &self,
        session: &TerminalSession,
        sink: Arc<dyn TerminalEventSink>,
        initial: Option<&AgentSessionRef>,
    ) {
        let mut data = self.0.lock().unwrap();
        data.sinks.insert(
            session
                .connection_id
                .clone()
                .expect("subscription is registered"),
            (session.id.clone(), sink.clone()),
        );
        if let Some(identity) = data
            .hooks
            .get(&session.id)
            .map(|(_, session)| session)
            .or_else(|| data.native.get(&session.id))
            .or(initial)
        {
            let _ = sink.send(TerminalEvent::SessionIdentity {
                session_id: session.id.clone(),
                session: identity.clone(),
            });
        }
    }

    pub fn observe(
        self: &Arc<Self>,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Arc<dyn TerminalEventSink> {
        Arc::new(ObservedSink {
            identities: self.clone(),
            sink,
        })
    }

    pub fn detach(&self, id: &str, connection: &str) {
        let mut data = self.0.lock().unwrap();
        if data
            .sinks
            .get(connection)
            .is_some_and(|(session, _)| session == id)
        {
            data.sinks.remove(connection);
        }
    }
    pub fn detach_all(&self) {
        self.0.lock().unwrap().sinks.clear();
    }
    pub fn forget(&self, id: &str) {
        let mut data = self.0.lock().unwrap();
        data.native.remove(id);
        data.hooks.remove(id);
    }
}

fn resolve(
    data: &Data,
    id: &str,
    proposed: &AgentSessionRef,
    remote: Option<&AgentSessionRef>,
) -> AgentSessionRef {
    // MCP 只补身份；已观察到的 Hook 身份不能被迟到的 MCP 或旧查询快照回退。
    data.hooks
        .get(id)
        .map(|(_, session)| session)
        .or(remote)
        .or_else(|| data.native.get(id))
        .unwrap_or(proposed)
        .clone()
}

struct ObservedSink {
    identities: Arc<NativeIdentities>,
    sink: Arc<dyn TerminalEventSink>,
}
impl TerminalEventSink for ObservedSink {
    fn uses_output_acknowledgements(&self) -> bool {
        self.sink.uses_output_acknowledgements()
    }
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        // 记录与发送共用锁：外部身份只能排在 Hook 之前，或看到 Hook 后发送它的新身份。
        let mut data = self.identities.0.lock().unwrap();
        observe(&mut data, &event);
        self.sink.send(event)
    }
}

fn observe(data: &mut Data, event: &TerminalEvent) {
    match event {
        TerminalEvent::OutputBatch { events, .. } => {
            for event in events {
                observe(data, event);
            }
        }
        TerminalEvent::AgentState {
            session_id,
            snapshot,
        } => {
            if let Some(session) = &snapshot.session {
                if session.agent == snapshot.agent
                    && session.validate().is_ok()
                    && data
                        .hooks
                        .get(session_id)
                        .is_none_or(|(sequence, _)| snapshot.sequence >= *sequence)
                {
                    data.hooks
                        .insert(session_id.clone(), (snapshot.sequence, session.clone()));
                    data.native.insert(session_id.clone(), session.clone());
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
#[path = "identity_tests.rs"]
mod tests;
