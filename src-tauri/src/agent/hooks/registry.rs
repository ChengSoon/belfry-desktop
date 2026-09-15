use super::contracts::{HookMessage, HookSnapshot};
use super::machine::Machine;
use crate::{agent::AgentKind, terminal::AppError};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub(super) type SnapshotSink = dyn Fn(String, HookSnapshot) + Send + Sync;

pub(super) struct SessionSpec {
    pub tab_id: String,
    pub agent: AgentKind,
    pub resume_id: Option<String>,
    pub fallback: String,
}

#[derive(Default)]
pub(super) struct Registry {
    slots: Mutex<HashMap<String, Slot>>,
}

struct Slot {
    tab_id: String,
    agent: AgentKind,
    machine: Machine,
    pty_id: Option<String>,
    sink: Arc<SnapshotSink>,
}

const MAX_SESSIONS: usize = 128;

impl Registry {
    pub fn issue(&self, spec: SessionSpec, sink: Arc<SnapshotSink>) -> Result<String, AppError> {
        crate::agent::validate_agent_session_id(&spec.tab_id)
            .map_err(AppError::invalid_argument)?;
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| AppError::io("Hook 身份表不可用"))?;
        slots.retain(|_, slot| slot.tab_id != spec.tab_id);
        if slots.len() >= MAX_SESSIONS {
            return Err(AppError::unsupported("Hook 会话数量已达上限"));
        }
        let token = ulid::Ulid::generate().to_string();
        let mut machine = Machine::new(spec.agent);
        machine.configure(spec.resume_id, spec.fallback);
        slots.insert(
            token.clone(),
            Slot {
                tab_id: spec.tab_id,
                agent: spec.agent,
                machine,
                pty_id: None,
                sink,
            },
        );
        Ok(token)
    }

    pub fn bind(&self, token: &str, pty_id: &str) {
        let update = self.slots.lock().ok().and_then(|mut slots| {
            let slot = slots.get_mut(token)?;
            if slot.pty_id.is_some() {
                return None;
            }
            slot.pty_id = Some(pty_id.into());
            Some((slot.sink.clone(), slot.machine.snapshot()))
        });
        if let Some((sink, snapshot)) = update {
            sink(pty_id.into(), snapshot);
        }
    }

    pub fn accept(&self, message: HookMessage) -> bool {
        if message.version != 1 {
            return false;
        }
        let Ok(mut slots) = self.slots.lock() else {
            return false;
        };
        let Some(slot) = slots.get_mut(&message.token) else {
            return false;
        };
        if slot.agent != message.agent || !slot.machine.accepts(&message.input) {
            return false;
        }
        let update = slot.machine.apply(message.input).and_then(|snapshot| {
            slot.pty_id
                .clone()
                .map(|id| (slot.sink.clone(), id, snapshot))
        });
        drop(slots);
        if let Some((sink, id, snapshot)) = update {
            sink(id, snapshot);
        }
        true
    }

    pub fn revoke(&self, token: &str) {
        if let Ok(mut slots) = self.slots.lock() {
            slots.remove(token);
        }
    }

    pub fn exited(&self, token: &str, code: i32, terminated: bool) {
        let slot = self
            .slots
            .lock()
            .ok()
            .and_then(|mut slots| slots.remove(token));
        if let Some(mut slot) = slot {
            let snapshot = slot.machine.exited(code, terminated);
            if let Some(id) = slot.pty_id {
                (slot.sink)(id, snapshot);
            }
        }
    }
}
