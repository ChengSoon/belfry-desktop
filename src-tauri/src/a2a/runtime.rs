use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use super::{
    card,
    client::{self, HttpClient, SendResult, Task},
    connections::ConnectionSource,
    contracts::{AgentInterface, AgentReply, ConnectionDraft, ConnectionInfo, Discovery},
    errors::{error, invalid_handle, invalid_response, storage},
    redaction,
    requests::{Lease, Owner, Requests},
    store::{Resolved, Store},
    validation,
};
use crate::terminal::AppError;

const HANDLE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const CARD_TTL: Duration = Duration::from_secs(10);
const RESOLVED_TTL: Duration = Duration::from_secs(5);
const CACHE_LIMIT: usize = 64;

#[derive(Clone)]
struct Mapping {
    owner: Owner,
    connection_id: String,
    revision: String,
    interface: AgentInterface,
    remote_id: String,
    context_id: Option<String>,
    terminal: bool,
    used: Instant,
}

pub struct A2aRuntime {
    // Serializes snapshot+registration, connection mutation and result publication,
    // never holds a lock across HTTP. Cancellation remains independent of disk I/O.
    operations: Mutex<()>,
    requests: Requests,
    tasks: Mutex<HashMap<String, Mapping>>,
    timeout: Duration,
    // Reuse one connection pool for every A2A call; rebuilding a Client per
    // request forced a fresh TCP/TLS handshake on every poll and send.
    http: OnceLock<HttpClient>,
    // Short-lived public caches keyed by connection revision. Send/GetTask
    // polling no longer re-fetches the Card or re-decrypts a credential on
    // every call; saves and removals invalidate both.
    cards: Mutex<HashMap<(String, String, String), (Instant, Value)>>,
    resolved: Mutex<HashMap<String, (Instant, Resolved)>>,
}
impl Default for A2aRuntime {
    fn default() -> Self {
        Self {
            operations: Mutex::new(()),
            requests: Requests::default(),
            tasks: Mutex::new(HashMap::new()),
            timeout: Duration::from_secs(30),
            http: OnceLock::new(),
            cards: Mutex::new(HashMap::new()),
            resolved: Mutex::new(HashMap::new()),
        }
    }
}

impl A2aRuntime {
    #[cfg(test)]
    pub(super) fn with_timeout(timeout: Duration) -> Self {
        Self {
            timeout,
            ..Self::default()
        }
    }

    fn http(&self) -> Result<&HttpClient, AppError> {
        if let Some(client) = self.http.get() {
            return Ok(client);
        }
        let client = HttpClient::with_timeout(self.timeout)?;
        let _ = self.http.set(client);
        self.http.get().ok_or_else(|| {
            error(
                "A2A_HTTP_UNAVAILABLE",
                "The A2A HTTP client could not be initialized.",
            )
        })
    }

    async fn card_for(
        &self,
        client: &HttpClient,
        connection: &Resolved,
        fresh: bool,
    ) -> Result<Value, AppError> {
        let key = (
            connection.info.root_path.clone(),
            connection.info.id.clone(),
            connection.info.revision.clone(),
        );
        if !fresh
            && let Ok(cards) = self.cards.lock()
            && let Some((at, value)) = cards.get(&key)
            && at.elapsed() < CARD_TTL
        {
            return Ok(value.clone());
        }
        let value = client.card(connection).await?;
        if let Ok(mut cards) = self.cards.lock() {
            if cards.len() >= CACHE_LIMIT {
                cards.clear();
            }
            cards.insert(key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }

    fn resolve_cached(
        &self,
        store: &dyn ConnectionSource,
        root: &str,
        id: &str,
    ) -> Result<Resolved, AppError> {
        // Local connections issue host-managed tokens and are cheap to resolve;
        // caching them could retain a token after its instance is rotated.
        if id.starts_with("local:") {
            return store.resolve(root, id);
        }
        let key = format!("{root}\u{0}{id}");
        if let Ok(resolved) = self.resolved.lock()
            && let Some((at, value)) = resolved.get(&key)
            && at.elapsed() < RESOLVED_TTL
        {
            return Ok(value.clone());
        }
        let value = store.resolve(root, id)?;
        if let Ok(mut resolved) = self.resolved.lock() {
            if resolved.len() >= CACHE_LIMIT {
                resolved.clear();
            }
            resolved.insert(key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }

    pub(super) fn list(
        &self,
        store: &dyn ConnectionSource,
        root: &str,
    ) -> Result<Vec<ConnectionInfo>, AppError> {
        store.list(root)
    }

    pub(super) fn save(
        &self,
        store: &Store,
        root: &str,
        draft: &ConnectionDraft,
    ) -> Result<ConnectionInfo, AppError> {
        let _operation = self.operations.lock().map_err(|_| storage())?;
        let info = store.save(root, draft)?;
        self.invalidate_connection(root, &info.id);
        Ok(info)
    }

    pub(super) fn remove(&self, store: &Store, root: &str, id: &str) -> Result<(), AppError> {
        let _operation = self.operations.lock().map_err(|_| storage())?;
        store.remove(root, id)?;
        self.invalidate_connection(root, id);
        Ok(())
    }

    pub(super) fn cancel_request(&self, owner: &Owner, id: &str) -> Result<bool, AppError> {
        self.requests.cancel(owner, id)
    }

    pub(super) async fn probe(
        &self,
        store: &Store,
        owner: &Owner,
        draft: &ConnectionDraft,
        request_id: &str,
    ) -> Result<Discovery, AppError> {
        let lease = self.requests.begin(owner, request_id)?;
        let connection = {
            let _operation = self.operations.lock().map_err(|_| storage())?;
            let connection = store.preview(&owner.root, draft)?;
            if draft.id.is_some() {
                lease.bind(&owner.root, &connection.info.id)?;
            }
            connection
        };
        let client = self.http()?;
        // A probe edits an unsaved draft; never reuse a cached Card here.
        let value = lease
            .signal
            .run(self.card_for(client, &connection, true))
            .await??;
        let result = card::discover(value, &connection)?;
        lease.signal.check()?;
        Ok(redaction::discovery(result, &connection))
    }

    pub(super) async fn agent_card(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        id: &str,
        request_id: &str,
    ) -> Result<Discovery, AppError> {
        require_agent(owner)?;
        let lease = self.requests.begin(owner, request_id)?;
        let connection = self.connection(store, owner, id, &lease)?;
        let client = self.http()?;
        let value = lease
            .signal
            .run(self.card_for(client, &connection, false))
            .await??;
        let result = card::discover(value, &connection)?;
        self.current(store, owner, &connection, &lease)?;
        Ok(redaction::discovery(result, &connection))
    }

    pub(super) async fn send_message(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        id: &str,
        request_id: &str,
        text: &str,
        handle: Option<&str>,
    ) -> Result<AgentReply, AppError> {
        self.send_message_context(store, owner, id, request_id, text, handle, None)
            .await
    }

    /// Room business context can only be constructed by the authenticated host
    /// adapter. The public Send tool accepts no arbitrary metadata or owner.
    pub(super) async fn send_message_context(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        id: &str,
        request_id: &str,
        text: &str,
        handle: Option<&str>,
        context: Option<Value>,
    ) -> Result<AgentReply, AppError> {
        require_agent(owner)?;
        validation::text(text)?;
        let lease = self.requests.begin(owner, request_id)?;
        let (connection, previous) = {
            let _operation = self.operations.lock().map_err(|_| storage())?;
            let connection = self.resolve_cached(store, &owner.root, id)?;
            lease.bind(&owner.root, id)?;
            let previous = handle
                .map(|handle| self.mapping(owner, handle))
                .transpose()?;
            if let Some(previous) = &previous {
                if previous.connection_id != id
                    || previous.revision != connection.info.revision
                    || previous.terminal
                {
                    return Err(invalid_handle());
                }
            } else {
                self.capacity(owner)?;
            }
            (connection, previous)
        };
        let client = self.http()?;
        let raw_card = lease
            .signal
            .run(self.card_for(client, &connection, false))
            .await??;
        let discovery = card::discover(raw_card, &connection)?;
        if let Some(problem) = discovery.issue {
            return Err(error(&problem.code, &problem.message));
        }
        let interface = discovery.selected_interface.ok_or_else(invalid_response)?;
        if previous
            .as_ref()
            .is_some_and(|previous| previous.interface != interface)
        {
            return Err(error(
                "A2A_INTERFACE_CHANGED",
                "The Agent Card changed the task's interface. The existing task has not been sent to another endpoint.",
            ));
        }
        let message_id = if context.is_some() {
            request_id.to_owned()
        } else {
            ulid::Ulid::generate().to_string()
        };
        let mut message =
            json!({"messageId":message_id, "role":"ROLE_USER", "parts":[{"text":text}]});
        if let Some(context) = context {
            message["metadata"] = json!({"belfryRoom":context});
        }
        if let Some(previous) = &previous {
            message["taskId"] = json!(previous.remote_id);
            if let Some(context) = &previous.context_id {
                message["contextId"] = json!(context);
            }
        }
        let params = json!({"message":message, "configuration":{"returnImmediately":true, "acceptedOutputModes":card::output_modes(&discovery.card), "historyLength":0}});
        let value = lease
            .signal
            .run(client.rpc(&connection, &interface, "SendMessage", params))
            .await
            .map_err(unknown_send)??;
        let result = client::send_result(value).map_err(unknown_send)?;
        let _operation = self.operations.lock().map_err(|_| storage())?;
        self.current_unlocked(store, owner, &connection, &lease)
            .map_err(unknown_send)?;
        match result {
            SendResult::Task(task) => self
                .publish(owner, &connection, &interface, handle, task, &lease)
                .map_err(unknown_send),
            SendResult::Message(message) => {
                if let Some(previous) = &previous {
                    if message
                        .get("taskId")
                        .and_then(Value::as_str)
                        .is_some_and(|id| id != previous.remote_id)
                        || previous.context_id.as_deref().is_some_and(|id| {
                            message
                                .get("contextId")
                                .and_then(Value::as_str)
                                .is_some_and(|new| new != id)
                        })
                    {
                        return Err(unknown_send(invalid_response()));
                    }
                }
                Ok(AgentReply::Message {
                    connection_id: id.into(),
                    message: redaction::value(message, &connection),
                })
            }
        }
    }

    pub(super) async fn task(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        handle: &str,
        request_id: &str,
        cancel: bool,
        history_length: u32,
    ) -> Result<AgentReply, AppError> {
        require_agent(owner)?;
        if history_length > 20 {
            return Err(error(
                "A2A_HISTORY_LIMIT",
                "A2A task historyLength must be between 0 and 20.",
            ));
        }
        let lease = self.requests.begin(owner, request_id)?;
        let (connection, mapping) = {
            let _operation = self.operations.lock().map_err(|_| storage())?;
            let mapping = self.mapping(owner, handle)?;
            let connection = self
                .resolve_cached(store, &owner.root, &mapping.connection_id)
                .map_err(|_| invalid_handle())?;
            if connection.info.revision != mapping.revision {
                return Err(invalid_handle());
            }
            lease.bind(&owner.root, &mapping.connection_id)?;
            (connection, mapping)
        };
        let client = self.http()?;
        let params = if cancel {
            json!({"id":mapping.remote_id})
        } else {
            json!({"id":mapping.remote_id, "historyLength":history_length})
        };
        let method = if cancel { "CancelTask" } else { "GetTask" };
        let value = lease
            .signal
            .run(client.rpc(&connection, &mapping.interface, method, params))
            .await??;
        let task = client::task_result(value)?;
        let _operation = self.operations.lock().map_err(|_| storage())?;
        self.current_unlocked(store, owner, &connection, &lease)?;
        self.publish(
            owner,
            &connection,
            &mapping.interface,
            Some(handle),
            task,
            &lease,
        )
    }

    fn connection(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        id: &str,
        lease: &Lease,
    ) -> Result<Resolved, AppError> {
        let _operation = self.operations.lock().map_err(|_| storage())?;
        let result = self.resolve_cached(store, &owner.root, id)?;
        lease.bind(&owner.root, id)?;
        Ok(result)
    }

    fn current(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        connection: &Resolved,
        lease: &Lease,
    ) -> Result<(), AppError> {
        let _operation = self.operations.lock().map_err(|_| storage())?;
        self.current_unlocked(store, owner, connection, lease)
    }
    fn current_unlocked(
        &self,
        store: &dyn ConnectionSource,
        owner: &Owner,
        connection: &Resolved,
        lease: &Lease,
    ) -> Result<(), AppError> {
        lease.signal.check()?;
        if !store
            .list(&owner.root)?
            .iter()
            .any(|info| info.id == connection.info.id && info.revision == connection.info.revision)
        {
            return Err(error(
                "A2A_CONNECTION_CHANGED",
                "The A2A connection changed while the request was running. Its old result was discarded.",
            ));
        }
        lease.signal.check()
    }

    fn mapping(&self, owner: &Owner, handle: &str) -> Result<Mapping, AppError> {
        let mut tasks = self.tasks.lock().map_err(|_| invalid_handle())?;
        tasks.retain(|_, task| task.used.elapsed() < HANDLE_TTL);
        let mapping = tasks
            .get_mut(handle)
            .filter(|mapping| &mapping.owner == owner)
            .ok_or_else(invalid_handle)?;
        mapping.used = Instant::now();
        Ok(mapping.clone())
    }

    fn capacity(&self, owner: &Owner) -> Result<(), AppError> {
        let mut tasks = self.tasks.lock().map_err(|_| invalid_handle())?;
        tasks.retain(|_, task| task.used.elapsed() < HANDLE_TTL);
        // Leave room for every possible in-flight send (64 total, 8 per owner).
        if tasks.len() >= 1024 - 64
            || tasks.values().filter(|task| &task.owner == owner).count() >= 128 - 8
        {
            return Err(error(
                "A2A_TASK_LIMIT",
                "The local A2A task-handle limit has been reached. No new message was sent.",
            ));
        }
        Ok(())
    }

    fn publish(
        &self,
        owner: &Owner,
        connection: &Resolved,
        interface: &AgentInterface,
        handle: Option<&str>,
        task: Task,
        lease: &Lease,
    ) -> Result<AgentReply, AppError> {
        let mut tasks = self.tasks.lock().map_err(|_| invalid_handle())?;
        lease.signal.check()?;
        let previous = handle
            .map(|handle| {
                tasks
                    .get(handle)
                    .filter(|mapping| &mapping.owner == owner)
                    .ok_or_else(invalid_handle)
            })
            .transpose()?;
        if let Some(previous) = previous {
            if previous.connection_id != connection.info.id
                || previous.revision != connection.info.revision
                || previous.interface != *interface
                || previous.remote_id != task.id
                || (previous.terminal && !task.terminal)
                || previous
                    .context_id
                    .as_deref()
                    .is_some_and(|id| task.context_id.as_deref().is_some_and(|new| new != id))
            {
                return Err(invalid_response());
            }
        }
        let context_id = task
            .context_id
            .clone()
            .or_else(|| previous.and_then(|mapping| mapping.context_id.clone()));
        let handle = handle
            .map(str::to_owned)
            .unwrap_or_else(|| ulid::Ulid::generate().to_string());
        tasks.insert(
            handle.clone(),
            Mapping {
                owner: owner.clone(),
                connection_id: connection.info.id.clone(),
                revision: connection.info.revision.clone(),
                interface: interface.clone(),
                remote_id: task.id,
                context_id,
                terminal: task.terminal,
                used: Instant::now(),
            },
        );
        Ok(AgentReply::Task {
            connection_id: connection.info.id.clone(),
            task_handle: handle,
            task: bound_task_history(redaction::value(task.raw, connection)),
            terminal: task.terminal,
        })
    }

    fn invalidate_connection(&self, root: &str, id: &str) {
        self.requests.invalidate_connection(root, id);
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.retain(|_, mapping| mapping.owner.root != root || mapping.connection_id != id);
        }
        if let Ok(mut cards) = self.cards.lock() {
            cards.retain(|(card_root, card_id, _), _| card_root != root || card_id != id);
        }
        if let Ok(mut resolved) = self.resolved.lock() {
            resolved.remove(&format!("{root}\u{0}{id}"));
        }
    }
    pub(crate) fn invalidate_session(&self, ticket: &str) {
        self.requests.invalidate_session(ticket);
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.retain(|_, mapping| mapping.owner.ticket.as_deref() != Some(ticket));
        }
        if let Ok(mut cards) = self.cards.lock() {
            cards.clear();
        }
        if let Ok(mut resolved) = self.resolved.lock() {
            resolved.clear();
        }
    }
    pub(crate) fn stop(&self) {
        self.requests.stop();
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.clear();
        }
        if let Ok(mut cards) = self.cards.lock() {
            cards.clear();
        }
        if let Ok(mut resolved) = self.resolved.lock() {
            resolved.clear();
        }
    }
}

fn require_agent(owner: &Owner) -> Result<(), AppError> {
    if owner.ticket.as_deref().is_none_or(str::is_empty) {
        Err(error(
            "A2A_AGENT_SESSION_REQUIRED",
            "An active Belfry agent connection is required for this A2A operation.",
        ))
    } else {
        Ok(())
    }
}

/// Keep a public task below the Agent bridge budget by dropping the oldest
/// history entries first. Artifacts and status stay intact; if the task is
/// still too large, the platform envelope returns an explicit size error.
pub(super) const MAX_PUBLIC_TASK: usize = 700 * 1024;

pub(super) fn bound_task_history(mut task: Value) -> Value {
    let size = |value: &Value| {
        serde_json::to_vec(value)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX)
    };
    if size(&task) <= MAX_PUBLIC_TASK {
        return task;
    }
    if task.get("history").and_then(Value::as_array).is_none() {
        return task;
    }
    let mut truncated = false;
    loop {
        let remaining = task
            .get("history")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if remaining == 0 || size(&task) <= MAX_PUBLIC_TASK {
            break;
        }
        if let Some(history) = task.get_mut("history").and_then(Value::as_array_mut) {
            history.remove(0);
            truncated = true;
        }
    }
    if truncated {
        if !task.get("metadata").is_some_and(Value::is_object) {
            task["metadata"] = json!({});
        }
        task["metadata"]["belfryTruncated"] = json!({"history": true});
    }
    task
}

fn unknown_send(mut value: AppError) -> AppError {
    value.retryable = false;
    let mut details = value
        .details
        .take()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    // The client marks definite rejections (HTTP 4xx/401/403 and parsed
    // JSON-RPC errors) with outcomeUnknown=false. Only escalate genuinely
    // ambiguous failures (transport, timeout, cancellation, malformed replies).
    if !details.get("outcomeUnknown").is_some_and(Value::is_boolean) {
        details["outcomeUnknown"] = json!(true);
    }
    value.details = Some(details);
    value
}
