use serde_json::{Value, json};
use std::sync::Arc;

use super::{AgentRecord, Credential, Service, id, local_error, lock_error, token};
use crate::a2a::{
    connections::ConnectionSource,
    contracts::{AuthInfo, AuthKind, ConnectionInfo, LocalConnectionInfo},
    store::{Resolved, Store},
};
use crate::{plugins::agent_connection::AuthorizedAgent, terminal::AppError};

pub(in crate::a2a) struct ScopedConnections<'a> {
    pub store: &'a Store,
    pub service: Option<Arc<Service>>,
    pub owner: &'a AuthorizedAgent,
}
impl ConnectionSource for ScopedConnections<'_> {
    fn list(&self, root: &str) -> Result<Vec<ConnectionInfo>, AppError> {
        let mut connections = self.store.list(root)?;
        if let Some(service) = &self.service {
            connections.extend(service.connections(self.owner)?);
        }
        Ok(connections)
    }
    fn resolve(&self, root: &str, key: &str) -> Result<Resolved, AppError> {
        if key.starts_with("local:") {
            return self
                .service
                .as_ref()
                .ok_or_else(super::unavailable)?
                .resolve(self.owner, key);
        }
        self.store.resolve(root, key)
    }
}

impl Service {
    pub(super) fn ready(&self, owner: &AuthorizedAgent) -> Result<Value, AppError> {
        self.current(owner)?;
        if !matches!(
            owner.agent,
            crate::agent::AgentKind::Codex | crate::agent::AgentKind::Claude
        ) {
            return Ok(
                json!({"ready":false,"protocolVersion":"1.0","reason":"This CLI has no verified automatic MCP/PTY adapter."}),
            );
        }
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        if !state
            .agents
            .get(&owner.ticket)
            .is_some_and(|record| record.owner == *owner)
        {
            state.agents.insert(
                owner.ticket.clone(),
                AgentRecord {
                    id: id(),
                    owner: owner.clone(),
                },
            );
            state.clients.remove(&owner.ticket);
        }
        drop(state);
        // The handshake is the proof that this CLI instance saw the directory;
        // remember the daemon terminal so a host restart does not lose it.
        self.ready.mark(owner);
        Ok(json!({"ready":true,"adapter":"mcp-pty","protocolVersion":"1.0"}))
    }
    pub(super) fn connections(
        &self,
        owner: &AuthorizedAgent,
    ) -> Result<Vec<ConnectionInfo>, AppError> {
        self.current(owner)?;
        self.public_connections(&owner.root, Some(owner))
    }
    fn public_connections(
        &self,
        root: &str,
        viewer: Option<&AuthorizedAgent>,
    ) -> Result<Vec<ConnectionInfo>, AppError> {
        let current = self.access.snapshot()?;
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        self.restore_ready(&mut state, &current);
        if viewer.is_some_and(|owner| {
            !state
                .agents
                .get(&owner.ticket)
                .is_some_and(|record| &record.owner == owner)
        }) {
            return Ok(vec![]);
        }
        let mut connections = state
            .agents
            .values()
            .filter(|record| {
                crate::collab::inbox::normalize_root(&record.owner.root)
                    == crate::collab::inbox::normalize_root(root)
                    && current.iter().any(|owner| owner == &record.owner)
                    && self.registered(&record.owner)
                    && viewer.is_none_or(|viewer| viewer != &record.owner)
            })
            .map(|record| self.info(record))
            .collect::<Vec<_>>();
        connections.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        Ok(connections)
    }
    fn info(&self, record: &AgentRecord) -> ConnectionInfo {
        ConnectionInfo {
            id: format!("local:{}", record.id),
            name: self
                .registry
                .find(&record.owner.tab_id)
                .and_then(|s| s.name)
                .unwrap_or_else(|| record.owner.tab_id.clone()),
            root_path: record.owner.root.clone(),
            card_url: format!(
                "{}/agents/{}/.well-known/agent-card.json",
                self.origin, record.id
            ),
            interface_url: Some(format!("{}/agents/{}/rpc", self.origin, record.id)),
            interface_tenant: None,
            auth: AuthInfo {
                kind: AuthKind::Bearer,
                header_name: None,
                has_credential: true,
            },
            revision: record.id.clone(),
            local: Some(LocalConnectionInfo {
                tab_id: record.owner.tab_id.clone(),
                agent: record.owner.agent.id().into(),
                ready: true,
            }),
        }
    }
    pub(super) fn discovery(
        &self,
        root: &str,
        owner: Option<&AuthorizedAgent>,
    ) -> Result<Value, AppError> {
        let agents = self.public_connections(root, owner)?;
        let ready_tabs = agents
            .iter()
            .filter_map(|c| c.local.as_ref().map(|l| l.tab_id.as_str()))
            .collect::<Vec<_>>();
        let unsupported = self.registry.all().into_iter()
            .filter(|s| s.project_root.as_ref().is_some_and(|project| crate::collab::inbox::normalize_root(project)==crate::collab::inbox::normalize_root(root))
                && owner.is_none_or(|owner|owner.tab_id!=s.tab_id) && !ready_tabs.contains(&s.tab_id.as_str()))
            .map(|s|{let reason=if !matches!(s.agent.as_str(),"codex"|"claude"){"adapterUnsupported"}
                else if matches!(s.activity.as_str(),"offline"|"exited"){"instanceUnavailable"}else{"adapterNotReady"};
                json!({"tabId":s.tab_id,"name":s.name.unwrap_or(s.title),"agent":s.agent,"reason":reason})}).collect::<Vec<_>>();
        Ok(json!({"agents":agents,"unsupported":unsupported}))
    }
    pub(super) fn resolve(&self, owner: &AuthorizedAgent, key: &str) -> Result<Resolved, AppError> {
        self.current(owner)?;
        let current = self.access.snapshot()?;
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        self.restore_ready(&mut state, &current);
        if !state
            .agents
            .get(&owner.ticket)
            .is_some_and(|record| &record.owner == owner)
        {
            return Err(not_found());
        }
        let record = state
            .agents
            .values()
            .find(|record| {
                key == format!("local:{}", record.id)
                    && record.owner.root == owner.root
                    && record.owner != *owner
                    && current.contains(&record.owner)
                    && self.registered(&record.owner)
            })
            .cloned()
            .ok_or_else(not_found)?;
        let credential = match state.clients.get(&owner.ticket) {
            Some(credential) if &credential.owner == owner => credential.value.clone(),
            _ => {
                let value = token()?;
                state.clients.insert(
                    owner.ticket.clone(),
                    Credential {
                        owner: owner.clone(),
                        value: value.clone(),
                    },
                );
                value
            }
        };
        Ok(Resolved {
            info: self.info(&record),
            secret: Some(credential),
            credential_origin: self.origin.clone(),
        })
    }
    pub(super) fn authenticate(&self, bearer: &str) -> Result<AuthorizedAgent, AppError> {
        let owner = {
            let state = self.state.lock().map_err(|_| lock_error())?;
            state
                .clients
                .values()
                .find(|credential| equal(bearer, &credential.value))
                .map(|credential| credential.owner.clone())
                .ok_or_else(not_found)?
        };
        self.current(&owner)?;
        let state = self.state.lock().map_err(|_| lock_error())?;
        if !state
            .agents
            .get(&owner.ticket)
            .is_some_and(|record| record.owner == owner)
        {
            return Err(not_found());
        }
        Ok(owner)
    }
    pub(super) fn target(
        &self,
        owner: &AuthorizedAgent,
        target_id: &str,
    ) -> Result<AgentRecord, AppError> {
        self.current(owner)?;
        let current = self.access.snapshot()?;
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        self.restore_ready(&mut state, &current);
        state
            .agents
            .values()
            .find(|record| {
                record.id == target_id
                    && record.owner.root == owner.root
                    && record.owner != *owner
                    && current.contains(&record.owner)
                    && self.registered(&record.owner)
            })
            .cloned()
            .ok_or_else(not_found)
    }
    pub(super) fn record_for_tab(
        &self,
        owner: &AuthorizedAgent,
        tab: &str,
    ) -> Result<AgentRecord, AppError> {
        self.connections(owner)?
            .into_iter()
            .find(|c| c.local.as_ref().is_some_and(|l| l.tab_id == tab))
            .and_then(|c| c.id.strip_prefix("local:").map(str::to_owned))
            .ok_or_else(not_found)
            .and_then(|id| self.target(owner, &id))
    }
}
fn not_found() -> AppError {
    local_error(
        "A2A_LOCAL_AGENT_NOT_FOUND",
        "No available local agent connection in your current project scope.",
    )
}
fn equal(a: &str, b: &str) -> bool {
    if a.len() != 64 || b.len() != 64 {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0_u8, |difference, (x, y)| difference | (x ^ y))
        == 0
}
