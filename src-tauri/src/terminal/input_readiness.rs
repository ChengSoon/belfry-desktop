//! A permission survives consecutive idle/done reports, never an intervening unsafe position.
use crate::agent::{AgentKind, hooks::HookSnapshot};

#[derive(Clone, Copy, Default)]
pub(super) struct InputReadiness {
    sequence: Option<u64>,
    agent: Option<AgentKind>,
    since: Option<u64>,
}

impl InputReadiness {
    pub fn observe(&mut self, snapshot: &HookSnapshot) {
        let Some(report) = snapshot.terminal_status_for(snapshot.agent) else { return; };
        if self.sequence.is_some_and(|old| snapshot.sequence <= old) { return; }
        let continuous = self.agent == Some(snapshot.agent)
            && self.sequence.and_then(|old| old.checked_add(1)) == Some(snapshot.sequence);
        self.since = if report.state.allows_input() {
            Some(if continuous { self.since.unwrap_or(snapshot.sequence) } else { snapshot.sequence })
        } else { None };
        self.sequence = Some(snapshot.sequence);
        self.agent = Some(snapshot.agent);
    }

    pub fn allows(&self, expected: u64) -> bool {
        self.since.is_some_and(|since| since <= expected)
            && self.sequence.is_some_and(|current| expected <= current)
    }

    pub fn interrupt(&mut self) { self.since = None; }
}
