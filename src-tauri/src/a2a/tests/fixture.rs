use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use serde_json::{Value, json};

use super::super::{
    A2aRuntime,
    contracts::{ConnectionDraft, ConnectionInfo},
    errors::storage,
    requests::Owner,
    store::Store,
};
use crate::{
    provider::store::secrets::{KeyStore, MasterKey},
    terminal::AppError,
};

#[derive(Default)]
pub(super) struct MemoryKeys {
    pub value: Mutex<Option<MasterKey>>,
    pub denied: AtomicBool,
    pub creates: AtomicUsize,
    pub reads: AtomicUsize,
}
impl KeyStore for MemoryKeys {
    fn read(&self) -> Result<Option<MasterKey>, AppError> {
        self.reads.fetch_add(1, Ordering::AcqRel);
        if self.denied.load(Ordering::Acquire) {
            Err(storage())
        } else {
            Ok(self.value.lock().unwrap().clone())
        }
    }
    fn create(&self, key: &MasterKey) -> Result<(), AppError> {
        if self.denied.load(Ordering::Acquire) {
            return Err(storage());
        }
        let mut value = self.value.lock().unwrap();
        if value.is_some() {
            return Err(storage());
        }
        *value = Some(key.clone());
        self.creates.fetch_add(1, Ordering::AcqRel);
        Ok(())
    }
}

pub(super) struct TempRoot(pub PathBuf);
impl TempRoot {
    pub fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-a2a-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) struct Fixture {
    pub root: TempRoot,
    pub store: Store,
    pub keys: Arc<MemoryKeys>,
    pub runtime: Arc<A2aRuntime>,
    pub owner: Owner,
}
impl Fixture {
    pub fn new() -> Self {
        Self::with_timeout(Duration::from_secs(3))
    }
    pub fn with_timeout(timeout: Duration) -> Self {
        let root = TempRoot::new();
        let project = root.0.join("project-a");
        fs::create_dir_all(&project).unwrap();
        let keys = Arc::new(MemoryKeys::default());
        let store = Store::synthetic(root.0.join("a2a"), keys.clone());
        Self {
            owner: Owner::agent(
                crate::resource::canonicalize(&project)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .into(),
                "synthetic-ticket-a".into(),
            ),
            root,
            store,
            keys,
            runtime: Arc::new(A2aRuntime::with_timeout(timeout)),
        }
    }
    pub fn other_project(&self) -> Owner {
        let path = self.root.0.join("project-b");
        fs::create_dir_all(&path).unwrap();
        Owner::agent(
            crate::resource::canonicalize(&path)
                .unwrap()
                .to_str()
                .unwrap()
                .into(),
            "synthetic-ticket-b".into(),
        )
    }
    pub fn save(&self, draft: &ConnectionDraft) -> ConnectionInfo {
        self.runtime
            .save(&self.store, &self.owner.root, draft)
            .unwrap()
    }
}

pub(super) fn draft(base: &str, auth: &str, secret: Option<&str>) -> ConnectionDraft {
    serde_json::from_value(json!({"name":"Synthetic agent", "cardUrl":format!("{base}/card"),
        "auth":{"kind":auth, "headerName": if auth == "apiKey" { Some("X-API-Key") } else { None },
        "credential": secret.map(|secret| json!({"action":"replace", "value":secret})).unwrap_or_else(|| json!({"action":"clear"}))}})).unwrap()
}

pub(super) fn task(id: &str, state: &str) -> Value {
    json!({"id":id, "status":{"state":state}})
}
pub(super) fn card(base: &str) -> Value {
    json!({"name":"Synthetic A2A agent", "description":"Local protocol fixture", "version":"fixture-1",
        "supportedInterfaces":[
            {"url":format!("{base}/grpc"), "protocolBinding":"GRPC", "protocolVersion":"1.0"},
            {"url":format!("{base}/rpc"), "protocolBinding":"JSONRPC", "protocolVersion":"1.0", "tenant":"fixture-tenant"}
        ], "capabilities":{"streaming":false, "pushNotifications":false},
        "defaultInputModes":["text/plain"], "defaultOutputModes":["text/plain", "application/json"],
        "skills":[{"id":"work", "name":"Work", "description":"Synthetic work", "tags":["fixture"]}]})
}

#[derive(Clone)]
pub(super) struct Request {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
}
pub(super) struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub bytes: Vec<u8>,
    pub hang: bool,
}
impl Reply {
    pub fn json(body: Value) -> Self {
        Self {
            status: 200,
            headers: vec![("Content-Type".into(), "application/json".into())],
            bytes: serde_json::to_vec(&body).unwrap(),
            hang: false,
        }
    }
    pub fn rpc(request: &Request, value: Value) -> Self {
        Self::json(json!({"jsonrpc":"2.0", "id":request.body["id"], "result":value}))
    }
    pub fn failure(request: &Request, code: i64) -> Self {
        Self::json(
            json!({"jsonrpc":"2.0", "id":request.body["id"], "error":{"code":code, "message":"synthetic-error-body-secret"}}),
        )
    }
    pub fn status(status: u16) -> Self {
        let mut reply = Self::json(json!({"error":"synthetic-not-a-user-secret"}));
        reply.status = status;
        reply
    }
    pub fn hang() -> Self {
        let mut reply = Self::json(json!({}));
        reply.hang = true;
        reply
    }
}

pub(super) struct Server {
    pub base: String,
    pub requests: Arc<Mutex<Vec<Request>>>,
    pub disconnects: Arc<AtomicUsize>,
    stopped: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Server {
    pub fn new(handler: impl Fn(&str, &Request) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let stopped = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(Mutex::new(vec![]));
        let disconnects = Arc::new(AtomicUsize::new(0));
        let (origin, stop, seen, closed) = (
            base.clone(),
            stopped.clone(),
            requests.clone(),
            disconnects.clone(),
        );
        let handler = Arc::new(handler);
        let thread = thread::spawn(move || {
            let mut workers = vec![];
            while !stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let (handler, origin, seen, closed) = (
                            handler.clone(),
                            origin.clone(),
                            seen.clone(),
                            closed.clone(),
                        );
                        workers.push(thread::spawn(move || {
                            // BSD/macOS accepted sockets can inherit nonblocking mode.
                            // Preserve the existing bounded reads while accepting fragmented HTTP requests.
                            stream.set_nonblocking(false).unwrap();
                            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                            stream.set_write_timeout(Some(Duration::from_secs(3))).unwrap();
                            let Some(request) = read_request(&mut stream) else { return; };
                            seen.lock().unwrap().push(request.clone());
                            let reply = handler(&origin, &request);
                            let mut headers = format!("HTTP/1.1 {} Fixture\r\nConnection: close\r\nContent-Length: {}\r\n", reply.status, if reply.hang { 1024 } else { reply.bytes.len() });
                            for (name, value) in reply.headers { headers.push_str(&format!("{name}: {value}\r\n")); }
                            headers.push_str("\r\n");
                            if stream.write_all(headers.as_bytes()).is_err() { return; }
                            if reply.hang {
                                let _ = stream.write_all(b"{");
                                // HTTP clients may half-close the request side while
                                // still reading the response. Keep the incomplete body
                                // alive and observe a write failure after full cancellation.
                                for _ in 0..300 {
                                    thread::sleep(Duration::from_millis(10));
                                    if stream.write_all(b" ").is_err() {
                                        closed.fetch_add(1, Ordering::AcqRel);
                                        break;
                                    }
                                }
                            } else { let _ = stream.write_all(&reply.bytes); }
                        }));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(_) => break,
                }
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        Self {
            base,
            requests,
            disconnects,
            stopped,
            thread: Some(thread),
        }
    }
    pub fn standard() -> Self {
        Self::new(|base, request| {
            if request.method == "GET" {
                return Reply::json(card(base));
            }
            match request.body["method"].as_str() {
                Some("SendMessage") => {
                    let text = request.body["params"]["message"]["parts"][0]["text"]
                        .as_str()
                        .unwrap();
                    let value = match text {
                        "instant" => {
                            json!({"message":{"messageId":"instant-id", "role":"ROLE_AGENT", "parts":[{"text":"instant result"}]}})
                        }
                        "input" => {
                            json!({"task":{"id":"input-task", "contextId":"input-context", "status":{"state":"TASK_STATE_INPUT_REQUIRED"}}})
                        }
                        "follow-up" => {
                            json!({"task":{"id":"input-task", "contextId":"input-context", "status":{"state":"TASK_STATE_COMPLETED"}, "artifacts":[{"artifactId":"answer", "parts":[{"text":"answer"},{"data":null},{"url":"https://example.invalid/never-download","mediaType":"text/plain"}]}]}})
                        }
                        "uncancelable" => {
                            json!({"task":task("uncancelable", "TASK_STATE_WORKING")})
                        }
                        "slow" => return Reply::hang(),
                        "reject" => return Reply::failure(request, -32602),
                        other if other.starts_with("TASK_STATE_") => {
                            json!({"task":task("state-task", other)})
                        }
                        _ => json!({"task":task("same-remote-id", "TASK_STATE_WORKING")}),
                    };
                    Reply::rpc(request, value)
                }
                Some("GetTask") => Reply::rpc(
                    request,
                    json!({"id":request.body["params"]["id"], "status":{"state":"TASK_STATE_COMPLETED"}, "artifacts":[{"artifactId":"text", "parts":[{"text":"completed result"}]}]}),
                ),
                Some("CancelTask") if request.body["params"]["id"] == "uncancelable" => {
                    Reply::failure(request, -32002)
                }
                Some("CancelTask") => Reply::rpc(
                    request,
                    json!({"id":request.body["params"]["id"], "status":{"state":"TASK_STATE_CANCELED"}}),
                ),
                _ => Reply::failure(request, -32601),
            }
        })
    }
    pub fn wait_for(&self, method: &str) {
        for _ in 0..400 {
            if self
                .requests
                .lock()
                .unwrap()
                .iter()
                .any(|request| request.body["method"] == method)
            {
                return;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("fixture did not observe expected RPC");
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        self.thread.take().unwrap().join().unwrap();
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut bytes = vec![];
    let end = loop {
        let mut chunk = [0u8; 1024];
        let count = stream.read(&mut chunk).ok()?;
        if count == 0 || bytes.len() + count > 128 * 1024 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(end) = bytes.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let header = std::str::from_utf8(&bytes[..end]).ok()?;
    let mut lines = header.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_owned();
    let path = first.next()?.to_owned();
    let headers: BTreeMap<String, String> = lines
        .filter_map(|line| {
            line.split_once(':')
                .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_owned()))
        })
        .collect();
    let length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if length > 128 * 1024 {
        return None;
    }
    while bytes.len() < end + length {
        let mut chunk = [0u8; 4096];
        let count = stream.read(&mut chunk).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    let body = if length > 0 {
        serde_json::from_slice(&bytes[end..end + length]).ok()?
    } else {
        Value::Null
    };
    Some(Request {
        method,
        path,
        headers,
        body,
    })
}

pub(super) fn request_id() -> String {
    ulid::Ulid::generate().to_string()
}
pub(super) fn reply_value(reply: super::super::contracts::AgentReply) -> Value {
    serde_json::to_value(reply).unwrap()
}
pub(super) fn code(error: &AppError) -> &str {
    error.code.0.as_ref()
}
