use crate::agent::{AgentKind, AgentSessionRef};
use std::collections::HashMap;

/// 原生身份只接受已由宿主创建的连接票据；创建响应之前到达的身份等 PTY 绑定后再发布。
#[derive(Default)]
pub(super) struct AgentIdentities(HashMap<String, Entry>);

struct Entry {
    agent: AgentKind,
    terminal: Option<String>,
    session: Option<AgentSessionRef>,
}

impl AgentIdentities {
    pub fn register(&mut self, ticket: &str, agent: AgentKind) {
        self.0.insert(
            ticket.into(),
            Entry {
                agent,
                terminal: None,
                session: None,
            },
        );
    }

    pub fn bind(&mut self, ticket: &str, terminal: &str) -> Option<AgentSessionRef> {
        let entry = self.0.get_mut(ticket)?;
        entry.terminal = Some(terminal.into());
        entry.session.clone()
    }

    pub fn learn(&mut self, ticket: &str, session: AgentSessionRef) -> Option<String> {
        let entry = self.0.get_mut(ticket)?;
        if session.agent != entry.agent
            || session.validate().is_err()
            || entry
                .session
                .as_ref()
                .is_some_and(|known| known != &session)
        {
            return None;
        }
        if entry.session.as_ref() == Some(&session) {
            return None;
        }
        entry.session = Some(session);
        entry.terminal.clone()
    }

    pub fn is_current(&self, ticket: &str, terminal: &str, session: &AgentSessionRef) -> bool {
        self.0.get(ticket).is_some_and(|entry| {
            entry.terminal.as_deref() == Some(terminal) && entry.session.as_ref() == Some(session)
        })
    }

    pub fn remove(&mut self, ticket: &str) {
        self.0.remove(ticket);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str) -> AgentSessionRef {
        AgentSessionRef {
            agent: AgentKind::Codex,
            id: id.into(),
        }
    }

    #[test]
    fn an_identity_received_before_spawn_is_delivered_when_the_pty_binds() {
        let mut identities = AgentIdentities::default();
        identities.register("ticket", AgentKind::Codex);
        assert_eq!(None, identities.learn("ticket", session("native")));
        assert_eq!(Some(session("native")), identities.bind("ticket", "pty"));
        assert!(identities.is_current("ticket", "pty", &session("native")));
        assert_eq!(None, identities.learn("ticket", session("native")));
    }

    #[test]
    fn parallel_connections_cannot_bind_each_others_identity_or_reuse_a_revoked_ticket() {
        let mut identities = AgentIdentities::default();
        identities.register("a", AgentKind::Codex);
        identities.register("b", AgentKind::Codex);
        identities.bind("a", "pty-a");
        identities.bind("b", "pty-b");
        assert_eq!(
            Some("pty-a".into()),
            identities.learn("a", session("native-a"))
        );
        assert_eq!(
            Some("pty-b".into()),
            identities.learn("b", session("native-b"))
        );
        assert_eq!(None, identities.learn("a", session("native-b")));
        assert!(!identities.is_current("a", "pty-b", &session("native-a")));
        identities.remove("a");
        assert_eq!(None, identities.learn("a", session("native-a")));
        assert!(!identities.is_current("a", "pty-a", &session("native-a")));
        assert!(identities.is_current("b", "pty-b", &session("native-b")));
    }

    #[test]
    fn wrong_agent_invalid_and_unregistered_identities_are_ignored() {
        let mut identities = AgentIdentities::default();
        identities.register("ticket", AgentKind::Claude);
        assert_eq!(None, identities.learn("ticket", session("native")));
        assert_eq!(None, identities.learn("unknown", session("native")));
        assert_eq!(None, identities.bind("ticket", "pty"));
        identities.register("codex", AgentKind::Codex);
        identities.bind("codex", "codex-pty");
        assert_eq!(None, identities.learn("codex", session("../other")));
        assert_eq!(
            Some("codex-pty".into()),
            identities.learn("codex", session("native"))
        );
    }
}
