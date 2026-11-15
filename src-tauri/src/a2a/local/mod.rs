//! Local A2A 1.0 gateway. It adapts managed MCP/PTY agents to the existing
//! collaboration authorities; terminal idleness never settles a protocol task.
mod connections;
mod engine;
mod http;
mod protocol;
#[cfg(test)]
mod tests;
mod tools;
mod types;

use belfry_protocol::inbox::TaskRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use super::errors::error;
use crate::{
    collab::{SessionRegistry, TaskBoard, inbox::InboxService},
    plugins::agent_connection::{self, AuthorizedAgent},
    rooms::RoomStore,
    terminal::AppError,
};
use types::{AgentRecord, BusinessReplay, Link, Replay};

pub(super) trait AgentAccess: Send + Sync {
    fn snapshot(&self) -> Result<Vec<AuthorizedAgent>, AppError>;
}
struct HostAccess(AppHandle);
impl AgentAccess for HostAccess {
    fn snapshot(&self) -> Result<Vec<AuthorizedAgent>, AppError> {
        agent_connection::authorized_agents(&self.0)
    }
}

#[derive(Default)]
pub(crate) struct LocalGateway(OnceLock<Arc<Service>>);
impl LocalGateway {
    pub(crate) fn start(&self, app: &AppHandle) -> Result<(), AppError> {
        let ready = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("a2a").join("local-ready.json"));
        let links = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| dir.join("a2a").join("local-links.json"));
        let service = Service::start(
            Arc::new(HostAccess(app.clone())),
            app.state::<Arc<SessionRegistry>>().inner().clone(),
            app.state::<Arc<TaskBoard>>().inner().clone(),
            app.state::<Arc<RoomStore>>().inner().clone(),
            app.state::<Arc<InboxService>>().inner().clone(),
            ReadyMarks::load(ready),
            LinkPreviews::load(links),
        )?;
        if self.0.set(service.clone()).is_err() {
            service.stop();
        }
        Ok(())
    }
    pub(super) fn service(&self) -> Result<Arc<Service>, AppError> {
        self.0
            .get()
            .filter(|s| !s.stopped.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| {
                error(
                    "A2A_LOCAL_UNAVAILABLE",
                    "The local A2A gateway is unavailable.",
                )
            })
    }
    pub(crate) fn revoke(&self, ticket: &str) {
        if let Some(service) = self.0.get() {
            service.revoke(ticket);
        }
    }
    pub(crate) fn stop(&self) {
        if let Some(service) = self.0.get() {
            service.stop();
        }
    }
    pub(crate) fn diagnostic_status(&self) -> serde_json::Value {
        use serde_json::json;
        let Ok(service) = self.service() else {
            return json!({"available":false});
        };
        let Ok(current) = service.access.snapshot() else {
            return json!({"available":false});
        };
        let Ok(mut state) = service.state.lock() else {
            return json!({"available":false});
        };
        service.restore_ready(&mut state, &current);
        let adapters = crate::agent::AgentKind::ALL
            .into_iter()
            .map(|agent| {
                let count = state
                    .agents
                    .values()
                    .filter(|record| {
                        record.owner.agent == agent
                            && current.contains(&record.owner)
                            && service.registered(&record.owner)
                    })
                    .count();
                json!({"agent":agent.id(),"readyInstances":count})
            })
            .collect::<Vec<_>>();
        json!({"available":true,"origin":service.origin,"adapters":adapters})
    }
    pub(super) fn discovery(&self, root: &str) -> Result<serde_json::Value, AppError> {
        self.service()?.discovery(root, None)
    }
    pub(super) fn snapshot(&self, root: &str) -> Result<serde_json::Value, AppError> {
        self.service()?.snapshot(root)
    }
}

pub(super) struct Credential {
    owner: AuthorizedAgent,
    value: Zeroizing<String>,
}
#[derive(Default)]
pub(super) struct State {
    agents: HashMap<String, AgentRecord>,
    clients: HashMap<String, Credential>,
    tasks: HashMap<String, Link>,
    replay: HashMap<String, Replay>,
    business_replay: HashMap<String, BusinessReplay>,
    /// Active protocol waits per Agent ticket. A waiting client keeps one HTTP
    /// request and one gateway permit; without a per-owner bound a single client
    /// could consume the whole global permit pool.
    waits: HashMap<String, usize>,
}

const MAX_WAITS_PER_OWNER: usize = 4;

pub(super) struct WaitGuard<'a> {
    state: &'a Mutex<State>,
    ticket: String,
}
impl Drop for WaitGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(count) = state.waits.get_mut(&self.ticket) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    state.waits.remove(&self.ticket);
                }
            }
        }
    }
}

/// Marks a managed PTY whose CLI actually read the local A2A tool catalog.
///
/// The ticket lives in host memory and is replaced every time the UI reattaches
/// the PTY, but the daemon keeps the same terminal running. Without this record
/// a restarted host forgets that the live CLI has the tools, and a CLI that does
/// not refresh its directory on `tools/list_changed` never registers again.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyMark {
    tab_id: String,
    root: String,
    agent: String,
    /// Unix milliseconds. Old records are pruned so the file cannot grow forever.
    at: u64,
}

const READY_LIMIT: usize = 512;
const READY_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Default)]
pub(super) struct ReadyMarks {
    path: Option<PathBuf>,
    marks: Mutex<HashMap<String, ReadyMark>>,
}
impl ReadyMarks {
    pub(super) fn load(path: Option<PathBuf>) -> Self {
        let marks = path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            marks: Mutex::new(marks),
        }
    }
    pub(super) fn mark(&self, owner: &AuthorizedAgent) {
        let now = now();
        let Ok(mut marks) = self.marks.lock() else {
            return;
        };
        marks.insert(
            owner.terminal_id.clone(),
            ReadyMark {
                tab_id: owner.tab_id.clone(),
                root: crate::collab::inbox::normalize_root(&owner.root),
                agent: owner.agent.id().to_string(),
                at: now,
            },
        );
        marks.retain(|_, mark| now.saturating_sub(mark.at) < READY_TTL_MS);
        if marks.len() > READY_LIMIT {
            let mut recent: Vec<_> = marks
                .iter()
                .map(|(terminal, mark)| (terminal.clone(), mark.at))
                .collect();
            recent.sort_by_key(|(_, at)| std::cmp::Reverse(*at));
            let keep: std::collections::HashSet<_> = recent
                .into_iter()
                .take(READY_LIMIT)
                .map(|(terminal, _)| terminal)
                .collect();
            marks.retain(|terminal, _| keep.contains(terminal));
        }
        persist(self.path.as_deref(), &marks);
    }
    pub(super) fn matches(&self, owner: &AuthorizedAgent) -> bool {
        let Ok(marks) = self.marks.lock() else {
            return false;
        };
        marks.get(&owner.terminal_id).is_some_and(|mark| {
            mark.tab_id == owner.tab_id
                && mark.agent == owner.agent.id()
                && mark.root == crate::collab::inbox::normalize_root(&owner.root)
        })
    }
}
fn persist(path: Option<&std::path::Path>, marks: &HashMap<String, ReadyMark>) {
    let Some(path) = path else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(marks) else {
        return;
    };
    // Write-then-rename so a crash during save cannot leave a truncated file.
    let temporary = path.with_extension("tmp");
    let _ = std::fs::create_dir_all(parent);
    if std::fs::write(&temporary, bytes).is_ok() {
        let _ = std::fs::rename(&temporary, path);
    }
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

const LINK_PREVIEW_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const LINK_PREVIEW_LIMIT: usize = 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkPreview {
    root: String,
    reference: TaskRef,
    protocol_task_id: String,
    state: String,
    text: Option<String>,
    text_truncated: bool,
    artifacts: Vec<Value>,
    updated_at: u64,
}

/// Durable UI previews for the last protocol state. Handles, senders and
/// credentials stay in memory; after a host restart the task board remains the
/// business authority and these previews keep the protocol state visible.
#[derive(Default)]
pub(super) struct LinkPreviews {
    path: Option<PathBuf>,
    previews: Mutex<HashMap<String, LinkPreview>>,
}
impl LinkPreviews {
    pub(super) fn load(path: Option<PathBuf>) -> Self {
        let previews = path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            path,
            previews: Mutex::new(previews),
        }
    }
    fn save(&self, link: &Link) {
        let root = crate::collab::inbox::normalize_root(&link.recipient.root);
        let text = link.status_text.as_deref();
        let preview = LinkPreview {
            root: root.clone(),
            reference: link.reference.clone(),
            protocol_task_id: link.id.clone(),
            state: link.progress.wire().to_string(),
            text: text.map(|text| text.chars().take(4096).collect()),
            text_truncated: text.is_some_and(|text| text.chars().count() > 4096),
            artifacts: link
                .artifacts
                .iter()
                .map(|artifact| {
                    let original = artifact["parts"][0]["text"].as_str().unwrap_or("");
                    serde_json::json!({
                        "artifactId": artifact["artifactId"],
                        "name": artifact["name"],
                        "text": original.chars().take(512).collect::<String>(),
                        "truncated": original.chars().count() > 512,
                    })
                })
                .collect(),
            updated_at: now(),
        };
        let Ok(mut previews) = self.previews.lock() else {
            return;
        };
        previews.insert(preview_key(&root, &link.reference), preview);
        let now = now();
        previews.retain(|_, preview| now.saturating_sub(preview.updated_at) < LINK_PREVIEW_TTL_MS);
        if previews.len() > LINK_PREVIEW_LIMIT {
            let mut recent: Vec<_> = previews
                .iter()
                .map(|(key, preview)| (key.clone(), preview.updated_at))
                .collect();
            recent.sort_by_key(|(_, updated)| std::cmp::Reverse(*updated));
            let keep: std::collections::HashSet<_> = recent
                .into_iter()
                .take(LINK_PREVIEW_LIMIT)
                .map(|(key, _)| key)
                .collect();
            previews.retain(|key, _| keep.contains(key));
        }
        persist_links(self.path.as_deref(), &previews);
    }
    fn list(&self, root: &str) -> Vec<Value> {
        let root = crate::collab::inbox::normalize_root(root);
        let Ok(mut previews) = self.previews.lock() else {
            return vec![];
        };
        let now = now();
        previews.retain(|_, preview| now.saturating_sub(preview.updated_at) < LINK_PREVIEW_TTL_MS);
        previews
            .values()
            .filter(|preview| preview.root == root)
            .map(|preview| {
                serde_json::json!({
                    "taskRef": &preview.reference,
                    "protocolTaskId": preview.protocol_task_id,
                    "state": preview.state,
                    "text": preview.text,
                    "textTruncated": preview.text_truncated,
                    "artifacts": preview.artifacts,
                    "source": "localA2A",
                })
            })
            .collect()
    }
}
fn preview_key(root: &str, reference: &TaskRef) -> String {
    format!(
        "{root}|{}|{}|{}|{}",
        reference.kind,
        reference.room_id.as_deref().unwrap_or(""),
        reference.id,
        reference.generation
    )
}
fn persist_links(path: Option<&std::path::Path>, previews: &HashMap<String, LinkPreview>) {
    let Some(path) = path else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(previews) else {
        return;
    };
    let temporary = path.with_extension("tmp");
    let _ = std::fs::create_dir_all(parent);
    if std::fs::write(&temporary, bytes).is_ok() {
        let _ = std::fs::rename(&temporary, path);
    }
}
pub(super) struct Service {
    origin: String,
    access: Arc<dyn AgentAccess>,
    registry: Arc<SessionRegistry>,
    board: Arc<TaskBoard>,
    rooms: Arc<RoomStore>,
    inbox: Arc<InboxService>,
    ready: ReadyMarks,
    links: LinkPreviews,
    // Serializes protocol mutations and report/replay ownership. No HTTP I/O is
    // performed under this lock; waiting Send requests release it after acceptance.
    operations: Mutex<()>,
    state: Mutex<State>,
    stopped: AtomicBool,
}
impl Service {
    pub(super) fn start(
        access: Arc<dyn AgentAccess>,
        registry: Arc<SessionRegistry>,
        board: Arc<TaskBoard>,
        rooms: Arc<RoomStore>,
        inbox: Arc<InboxService>,
        ready: ReadyMarks,
        links: LinkPreviews,
    ) -> Result<Arc<Self>, AppError> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|_| unavailable())?;
        let origin = format!(
            "http://{}",
            listener.local_addr().map_err(|_| unavailable())?
        );
        let service = Arc::new(Self {
            origin,
            access,
            registry,
            board,
            rooms,
            inbox,
            ready,
            links,
            operations: Mutex::new(()),
            state: Mutex::new(State::default()),
            stopped: AtomicBool::new(false),
        });
        http::serve(listener, Arc::downgrade(&service))?;
        Ok(service)
    }
    fn current(&self, owner: &AuthorizedAgent) -> Result<(), AppError> {
        if self.stopped.load(Ordering::Acquire)
            || !self.access.snapshot()?.iter().any(|agent| agent == owner)
            || !self.registered(owner)
        {
            return Err(error(
                "A2A_AGENT_SESSION_INVALID",
                "The originating agent instance is no longer active in this project.",
            ));
        }
        // A live PTY whose CLI already read the directory keeps its A2A identity
        // across a host restart even if it never refreshes its tool list.
        if self.ready.matches(owner) {
            if let Ok(mut state) = self.state.lock() {
                if !state.agents.values().any(|record| &record.owner == owner) {
                    state.agents.insert(
                        owner.ticket.clone(),
                        AgentRecord {
                            id: id(),
                            owner: owner.clone(),
                        },
                    );
                }
            }
        }
        Ok(())
    }
    pub(super) fn begin_wait(&self, owner: &AuthorizedAgent) -> Result<WaitGuard<'_>, AppError> {
        let mut state = self.state.lock().map_err(|_| lock_error())?;
        let count = state.waits.entry(owner.ticket.clone()).or_insert(0);
        if *count >= MAX_WAITS_PER_OWNER {
            return Err(local_error(
                "A2A_REQUEST_LIMIT",
                "Too many concurrent task waits for this agent.",
            ));
        }
        *count += 1;
        Ok(WaitGuard {
            state: &self.state,
            ticket: owner.ticket.clone(),
        })
    }
    fn registered(&self, owner: &AuthorizedAgent) -> bool {
        self.registry.find(&owner.tab_id).is_some_and(|session| {
            session.agent == owner.agent.id()
                && session.project_root.is_some_and(|root| {
                    crate::collab::inbox::normalize_root(&root)
                        == crate::collab::inbox::normalize_root(&owner.root)
                })
        })
    }
    /// Rebuild the in-memory agent records for live PTYs whose CLI already read
    /// the local A2A directory in a previous host. The ticket changes with every
    /// UI reattachment; the daemon terminal and the CLI process do not.
    pub(super) fn restore_ready(&self, state: &mut State, current: &[AuthorizedAgent]) {
        for owner in current {
            if state.agents.values().any(|record| &record.owner == owner) {
                continue;
            }
            if self.ready.matches(owner) {
                state.agents.insert(
                    owner.ticket.clone(),
                    AgentRecord {
                        id: id(),
                        owner: owner.clone(),
                    },
                );
            }
        }
    }
    fn revoke(&self, ticket: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.agents.remove(ticket);
            state.clients.remove(ticket);
            state.waits.remove(ticket);
            state
                .business_replay
                .retain(|key, _| !key.starts_with(&format!("{ticket}:")));
            // Keep links as failed/unresolved history for the other party. The
            // authority remains open; an old instance can no longer report on it.
        }
    }
    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(mut state) = self.state.lock() {
            state.agents.clear();
            state.clients.clear();
            state.waits.clear();
        }
    }
}
fn unavailable() -> AppError {
    error(
        "A2A_LOCAL_UNAVAILABLE",
        "The local A2A gateway is unavailable.",
    )
}
fn local_error(code: &str, text: &str) -> AppError {
    error(code, text)
}
fn lock_error() -> AppError {
    unavailable()
}
fn token() -> Result<Zeroizing<String>, AppError> {
    use aes_gcm::aead::{OsRng, rand_core::RngCore};
    let mut bytes = Zeroizing::new([0_u8; 32]);
    OsRng
        .try_fill_bytes(bytes.as_mut())
        .map_err(|_| unavailable())?;
    Ok(Zeroizing::new(
        bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
    ))
}
fn id() -> String {
    ulid::Ulid::generate().to_string().to_lowercase()
}
pub(super) use connections::ScopedConnections;
pub(super) use tools::dispatch as dispatch_tools;
