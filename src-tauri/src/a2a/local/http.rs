use super::{
    Service,
    protocol::{RpcError, RpcOutcome},
};
use crate::terminal::AppError;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Weak,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const MAX_HEADERS: usize = 16 * 1024;
const MAX_BODY: usize = 1024 * 1024;
const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const WAIT_TIMEOUT: Duration = Duration::from_secs(60);
struct Permit(Arc<AtomicUsize>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    bearer: Zeroizing<String>,
    body: Vec<u8>,
}

pub(super) fn serve(listener: TcpListener, service: Weak<Service>) -> Result<(), AppError> {
    listener
        .set_nonblocking(true)
        .map_err(|_| super::unavailable())?;
    thread::Builder::new()
        .name("belfry-a2a-gateway".into())
        .spawn(move || {
            let budget = Arc::new(AtomicUsize::new(0));
            loop {
                let Some(current) = service
                    .upgrade()
                    .filter(|service| !service.stopped.load(Ordering::Acquire))
                else {
                    break;
                };
                match listener.accept() {
                    Ok((stream, peer)) => {
                        if !peer.ip().is_loopback() {
                            continue;
                        }
                        if budget
                            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                                (count < 64).then_some(count + 1)
                            })
                            .is_err()
                        {
                            let mut stream = stream;
                            let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
                            respond(
                                &mut stream,
                                429,
                                &json!({"error":"Local A2A request limit reached."}),
                                false,
                            );
                            continue;
                        }
                        let permit = Permit(budget.clone());
                        let _ = thread::Builder::new()
                            .name("belfry-a2a-request".into())
                            .spawn(move || {
                                let _permit = permit;
                                handle(stream, &current);
                            });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        drop(current);
                        thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => break,
                }
            }
        })
        .map_err(|_| super::unavailable())?;
    Ok(())
}

pub(super) fn handle(mut stream: TcpStream, service: &Service) {
    // BSD/macOS accept can inherit the listener's nonblocking flag. Header/body
    // fragments need bounded blocking reads, rather than an immediate WouldBlock/400.
    if stream.set_nonblocking(false).is_err()
        || stream.set_read_timeout(Some(IO_TIMEOUT)).is_err()
        || stream.set_write_timeout(Some(IO_TIMEOUT)).is_err()
    {
        return;
    }
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(status) => {
            respond(
                &mut stream,
                status,
                &json!({"error":"Invalid local A2A HTTP request."}),
                false,
            );
            return;
        }
    };
    let expected = service.origin.strip_prefix("http://").unwrap_or("");
    if request.headers.get("host").map(String::as_str) != Some(expected)
        || request
            .headers
            .get("origin")
            .is_some_and(|origin| origin != &service.origin)
    {
        respond(
            &mut stream,
            403,
            &json!({"error":"Invalid local origin."}),
            false,
        );
        return;
    }
    if request.path == "/health" {
        if request.method != "GET" {
            respond(
                &mut stream,
                405,
                &json!({"error":"Method not allowed."}),
                false,
            );
            return;
        }
        respond(
            &mut stream,
            200,
            &json!({"ready":!service.stopped.load(Ordering::Acquire),"protocolVersion":"1.0","protocolBinding":"JSONRPC"}),
            false,
        );
        return;
    }
    let owner = match service.authenticate(&request.bearer) {
        Ok(owner) => owner,
        Err(_) => {
            respond(
                &mut stream,
                401,
                &json!({"error":"An active project-scoped bearer credential is required."}),
                true,
            );
            return;
        }
    };
    let Some((target, route)) = route(&request.path) else {
        respond(&mut stream, 404, &json!({"error":"Not found."}), false);
        return;
    };
    if request.method == "GET" && route == "card" {
        match service.card(&owner, target) {
            Ok(card) => respond(&mut stream, 200, &card, false),
            Err(_) => respond(
                &mut stream,
                404,
                &json!({"error":"No accessible local agent card."}),
                false,
            ),
        }
        return;
    }
    if request.method != "POST" || route != "rpc" {
        respond(
            &mut stream,
            405,
            &json!({"error":"Method not allowed."}),
            false,
        );
        return;
    }
    if !request
        .headers
        .get("content-type")
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
    {
        respond(
            &mut stream,
            415,
            &json!({"error":"Expected application/json."}),
            false,
        );
        return;
    }
    let value: Value = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(_) => {
            respond(
                &mut stream,
                200,
                &RpcError::new(-32700, "Invalid JSON payload.").reply(&Value::Null),
                false,
            );
            return;
        }
    };
    let id = value.get("id").cloned().unwrap_or(Value::Null);
    if !value.is_object()
        || value["jsonrpc"] != "2.0"
        || value.get("method").and_then(Value::as_str).is_none()
        || value.get("id").is_none()
        || !matches!(id, Value::String(_) | Value::Number(_) | Value::Null)
    {
        respond(
            &mut stream,
            200,
            &RpcError::new(-32600, "Invalid JSON-RPC request.").reply(&Value::Null),
            false,
        );
        return;
    }
    if request.headers.get("a2a-version").map(String::as_str) != Some("1.0") {
        respond(
            &mut stream,
            200,
            &RpcError::new(-32009, "A2A-Version 1.0 is required.").reply(&id),
            false,
        );
        return;
    }
    // Reserve the wait slot before accepting the message. Otherwise one Agent
    // could consume every global permit with long polls, and a rejected wait
    // would already have created a task the caller cannot address.
    let waiting = value["method"] == "SendMessage"
        && value["params"]["configuration"]["returnImmediately"].as_bool() != Some(true);
    let _wait_guard = if waiting {
        match service.begin_wait(&owner) {
            Ok(guard) => Some(guard),
            Err(error) => {
                respond(&mut stream, 200, &RpcError::from(error).reply(&id), false);
                return;
            }
        }
    } else {
        None
    };
    match service.rpc(&owner, target, &value) {
        Ok(RpcOutcome::Value(result)) => respond(
            &mut stream,
            200,
            &json!({"jsonrpc":"2.0","id":id,"result":result}),
            false,
        ),
        Ok(RpcOutcome::Wait {
            link,
            history_length,
        }) => {
            // Whitespace chunks are ordinary HTTP framing, not A2A streaming.
            // They keep an unfinished JSON response open and detect full client
            // cancellation by write failure without confusing a request-side
            // half-close with loss of the response reader.
            let headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nA2A-Version: 1.0\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
            if stream.write_all(headers.as_bytes()).is_err() {
                return;
            }
            let started = Instant::now();
            loop {
                let result = service
                    .owned_link(&owner, target, &link.id)
                    .and_then(|link| service.task_value(&link, history_length));
                let reply=match result{
                    Ok(task)if matches!(task["status"]["state"].as_str(),Some("TASK_STATE_COMPLETED"|"TASK_STATE_FAILED"|"TASK_STATE_CANCELED"|"TASK_STATE_REJECTED"|"TASK_STATE_INPUT_REQUIRED"|"TASK_STATE_AUTH_REQUIRED"))=>Some(json!({"jsonrpc":"2.0","id":id,"result":{"task":task}})),
                    Err(error)=>Some(RpcError::from(error).reply(&id)),
                    _ if started.elapsed()>=WAIT_TIMEOUT=>Some(RpcError::new(-32603,"The task is still unresolved. Use GetTask; do not blindly resend the message.").reply(&id)),
                    _=>None,
                };
                if let Some(reply) = reply {
                    let bytes = bounded_json(&reply);
                    if chunk(&mut stream, &bytes).is_ok() {
                        let _ = stream.write_all(b"0\r\n\r\n");
                    }
                    break;
                }
                if chunk(&mut stream, b"\n").is_err() {
                    break;
                }
                // Authorization snapshots and business-state reads are real IPC;
                // 500 ms is still responsive for a protocol wait and avoids
                // hammering the daemon ten times a second per waiting client.
                thread::sleep(Duration::from_millis(500));
            }
        }
        Err(error) => respond(&mut stream, 200, &error.reply(&id), false),
    }
}
fn route(path: &str) -> Option<(&str, &str)> {
    let remaining = path.strip_prefix("/agents/")?;
    let (id, suffix) = remaining.split_once('/')?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return None;
    }
    Some((
        id,
        match suffix {
            ".well-known/agent-card.json" => "card",
            "rpc" => "rpc",
            _ => return None,
        },
    ))
}
fn chunk(stream: &mut TcpStream, bytes: &[u8]) -> std::io::Result<()> {
    write!(stream, "{:x}\r\n", bytes.len())?;
    stream.write_all(bytes)?;
    stream.write_all(b"\r\n")?;
    stream.flush()
}
fn read_request(stream: &mut TcpStream) -> Result<Request, u16> {
    let mut reader = BufReader::new(stream);
    let deadline = Instant::now() + IO_TIMEOUT;
    let mut head = Zeroizing::new(Vec::new());
    while !head.ends_with(b"\r\n\r\n") {
        reader
            .get_ref()
            .set_read_timeout(Some(
                deadline
                    .checked_duration_since(Instant::now())
                    .filter(|duration| !duration.is_zero())
                    .ok_or(400_u16)?,
            ))
            .map_err(|_| 400_u16)?;
        let mut byte = [0_u8];
        reader.read_exact(&mut byte).map_err(|_| 400_u16)?;
        head.push(byte[0]);
        if head.len() > MAX_HEADERS {
            return Err(413);
        }
    }
    let head = std::str::from_utf8(&head).map_err(|_| 400_u16)?;
    let mut lines = head.split("\r\n");
    let first = lines
        .next()
        .ok_or(400_u16)?
        .split_whitespace()
        .collect::<Vec<_>>();
    if first.len() != 3
        || first[2] != "HTTP/1.1"
        || !first[1].starts_with('/')
        || first[1].len() > 4096
    {
        return Err(400);
    }
    let mut headers = HashMap::new();
    let mut bearer = Zeroizing::new(String::new());
    let mut has_auth = false;
    for line in lines.filter(|line| !line.is_empty()) {
        let (key, value) = line.split_once(':').ok_or(400_u16)?;
        if key.is_empty()
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || value.bytes().any(|byte| byte < 32 && byte != b'\t')
        {
            return Err(400);
        }
        let key = key.to_ascii_lowercase();
        if key == "authorization" {
            if has_auth {
                return Err(400);
            }
            has_auth = true;
            *bearer = value
                .trim()
                .split_once(' ')
                .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
                .map(|(_, credential)| credential.trim())
                .unwrap_or("")
                .into();
            continue;
        }
        if headers
            .insert(key.clone(), value.trim().to_string())
            .is_some()
        {
            return Err(400);
        }
    }
    if headers.contains_key("transfer-encoding") {
        return Err(400);
    }
    let length = match headers.get("content-length") {
        Some(value) if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) => {
            value.parse::<usize>().map_err(|_| 413_u16)?
        }
        None => 0,
        _ => return Err(400),
    };
    if length > MAX_BODY || first[0] == "GET" && length != 0 {
        return Err(413);
    }
    if bearer.len() > 128 {
        return Err(401);
    }
    let mut body = vec![0_u8; length];
    let mut received = 0;
    while received < length {
        reader
            .get_ref()
            .set_read_timeout(Some(
                deadline
                    .checked_duration_since(Instant::now())
                    .filter(|duration| !duration.is_zero())
                    .ok_or(400_u16)?,
            ))
            .map_err(|_| 400_u16)?;
        let count = reader.read(&mut body[received..]).map_err(|_| 400_u16)?;
        if count == 0 {
            return Err(400);
        }
        received += count;
    }
    Ok(Request {
        method: first[0].into(),
        path: first[1].into(),
        headers,
        bearer,
        body,
    })
}
fn bounded_json(value: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(value).unwrap_or_default();
    if body.len() <= MAX_RESPONSE {
        body
    } else {
        serde_json::to_vec(
            &RpcError::new(
                -32603,
                "The local response exceeds its size limit. Reduce the requested history.",
            )
            .reply(&value["id"]),
        )
        .unwrap_or_default()
    }
}
fn respond(stream: &mut TcpStream, status: u16, value: &Value, challenge: bool) {
    let bytes = bounded_json(value);
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        429 => "Too Many Requests",
        _ => "Bad Request",
    };
    let challenge = if challenge {
        "WWW-Authenticate: Bearer realm=\"belfry-local-a2a\"\r\n"
    } else {
        ""
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nA2A-Version: 1.0\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\n{challenge}Connection: close\r\n\r\n",
        bytes.len()
    );
    if stream.write_all(header.as_bytes()).is_ok() {
        let _ = stream.write_all(&bytes);
    }
}
