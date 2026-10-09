//! Observation-only hook transport shared by the desktop compatibility entry and the small CLI.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const ENV_PORT: &str = "BELFRY_HOOK_PORT";
pub const ENV_TOKEN: &str = "BELFRY_HOOK_TOKEN";
pub const MAX_MESSAGE_BYTES: u64 = 64 * 1024;
pub const IO_TIMEOUT: Duration = Duration::from_millis(400);
const MAX_PAYLOAD_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FIELD_BYTES: usize = 4096;

pub const EVENTS: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Stop",
    "StopFailure",
    "Interrupt",
    "Notification",
    "PreCompact",
    "PostCompact",
];

#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInput {
    pub event: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub source: Option<String>,
    pub agent_id: Option<String>,
    pub tool_key: Option<String>,
    pub tool_name: Option<String>,
    pub transcript_path: Option<String>,
    pub notification_type: Option<String>,
    pub is_interrupt: bool,
    pub background_work: bool,
    pub occurred_at: i64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookMessage<A> {
    pub version: u16,
    pub token: String,
    pub agent: A,
    pub input: HookInput,
}

pub fn run_if_requested() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--belfry-hook") {
        return false;
    }
    if let Some(agent @ ("codex" | "claude" | "pi")) = args.get(1).map(String::as_str) {
        forward_stdin(agent);
    }
    // A stale endpoint, malformed payload or closed output pipe must never fail the user's hook.
    let _ = std::io::stdout().lock().write_all(b"{}\n");
    true
}

fn forward_stdin(agent: &str) {
    let Some(port) = std::env::var(ENV_PORT)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
    else {
        return;
    };
    let Some(token) = std::env::var(ENV_TOKEN)
        .ok()
        .filter(|value| value.len() == 26)
    else {
        return;
    };
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let Some(input) = read_input(std::io::stdin().lock(), at) else {
        return;
    };
    let _ = send(
        port,
        &HookMessage {
            version: 1,
            token,
            agent,
            input,
        },
    );
}

// Codex can keep stdin open. Parse exactly one JSON value, without waiting for EOF.
pub fn read_input<R: Read>(reader: R, at: i64) -> Option<HookInput> {
    let mut stream =
        serde_json::Deserializer::from_reader(BufReader::new(reader.take(MAX_PAYLOAD_BYTES)));
    let value = Value::deserialize(&mut stream).ok()?;
    from_value(&value, at)
}

pub fn from_value(value: &Value, occurred_at: i64) -> Option<HookInput> {
    let event = field(value, "hook_event_name")?;
    let session_id = field(value, "session_id")?;
    if !EVENTS.contains(&event.as_str())
        || session_id == "."
        || session_id.len() > 512
        || session_id.contains(['/', '\\'])
        || session_id.contains("..")
    {
        return None;
    }
    let tool_name = field(value, "tool_name");
    Some(HookInput {
        event,
        session_id,
        occurred_at,
        turn_id: field(value, "turn_id"),
        source: field(value, "source"),
        agent_id: field(value, "agent_id"),
        transcript_path: field(value, "transcript_path"),
        notification_type: field(value, "notification_type"),
        tool_key: tool_name
            .as_ref()
            .map(|name| tool_key(name, &value["tool_input"])),
        tool_name,
        is_interrupt: value["is_interrupt"].as_bool().unwrap_or(false),
        background_work: ["background_tasks", "session_crons"]
            .iter()
            .any(|key| value[key].as_array().is_some_and(|items| !items.is_empty())),
    })
}

fn field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .filter(|text| {
            !text.is_empty() && text.len() <= MAX_FIELD_BYTES && !text.chars().any(char::is_control)
        })
        .map(str::to_owned)
}

fn tool_key(name: &str, arguments: &Value) -> String {
    let mut hasher = DefaultHasher::new();
    name.hash(&mut hasher);
    canonical(arguments).hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let sorted: std::collections::BTreeMap<_, _> = map
                .iter()
                .map(|(key, value)| (key, canonical(value)))
                .collect();
            serde_json::to_string(&sorted).unwrap_or_default()
        }
        Value::Array(items) => format!(
            "[{}]",
            items.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        _ => value.to_string(),
    }
}

pub fn send<A: Serialize>(port: u16, message: &HookMessage<A>) -> bool {
    let Ok(mut bytes) = serde_json::to_vec(message) else {
        return false;
    };
    bytes.push(b'\n');
    if bytes.len() > MAX_MESSAGE_BYTES as usize {
        return false;
    }
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, IO_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
    if stream.write_all(&bytes).is_err() {
        return false;
    }
    let mut reply = String::new();
    BufReader::new(stream.take(MAX_MESSAGE_BYTES))
        .read_line(&mut reply)
        .is_ok()
        && serde_json::from_str::<Value>(&reply).is_ok_and(|value| value["ok"] == true)
}
