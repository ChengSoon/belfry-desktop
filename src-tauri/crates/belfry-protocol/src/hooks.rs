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
    "PermissionResult",
    "Stop",
    "StopFailure",
    "Interrupt",
    "Notification",
    "PreCompact",
    "PostCompact",
    "PostInvocation",
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_fingerprint: Option<String>,
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
    if let Some(agent @ ("codex" | "claude" | "pi" | "antigravity" | "opencode" | "kimi")) =
        args.get(1).map(String::as_str)
    {
        forward_stdin(agent, args.get(2).map(String::as_str));
    }
    // A stale endpoint, malformed payload or closed output pipe must never fail the user's hook.
    let _ = std::io::stdout().lock().write_all(observation_reply(
        args.get(1).map(String::as_str).unwrap_or_default(),
        args.get(2).map(String::as_str),
    ));
    true
}

fn observation_reply(agent: &str, event: Option<&str>) -> &'static [u8] {
    match (agent, event) {
        // Required by agy: `allow` delegates to other hooks and the user's policy.
        // An empty object DENIES tools; `auto_approve` would bypass native prompts.
        ("antigravity", Some("PreToolUse")) => b"{\"decision\":\"allow\"}\n",
        // Kimi injects stdout into the model context.
        ("kimi", _) => b"",
        _ => b"{}\n",
    }
}

#[cfg(test)]
mod native_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn observation_neither_denies_tools_nor_bypasses_native_permissions() {
        assert_eq!(
            observation_reply("antigravity", Some("PreToolUse")),
            b"{\"decision\":\"allow\"}\n"
        );
        assert_eq!(
            observation_reply("antigravity", Some("PostToolUse")),
            b"{}\n"
        );
        assert!(observation_reply("kimi", Some("UserPromptSubmit")).is_empty());
    }

    #[test]
    fn antigravity_invocations_tools_errors_and_idle_are_distinct() {
        let value = json!({"conversationId":"native", "stepIdx":3,
            "toolCall":{"name":"ask_question", "args":{"question":"Ready?"}},
            "transcriptPath":"/native/log.jsonl"});
        let pre = from_native_value("antigravity", Some("PreToolUse"), &value, 1).unwrap();
        let post = from_native_value("antigravity", Some("PostToolUse"), &value, 2).unwrap();
        assert_eq!(pre.tool_name.as_deref(), Some("ask_question"));
        assert_eq!(pre.tool_key, post.tool_key);
        assert_eq!(pre.transcript_path.as_deref(), Some("/native/log.jsonl"));
        assert_eq!(
            from_native_value("antigravity", Some("PostInvocation"), &value, 3)
                .unwrap()
                .event,
            "PostInvocation"
        );
        let failed = json!({"conversationId":"native", "terminationReason":"error"});
        assert_eq!(
            from_native_value("antigravity", Some("Stop"), &failed, 4)
                .unwrap()
                .event,
            "StopFailure"
        );
        let background = json!({"conversationId":"native", "fullyIdle":false});
        assert!(
            from_native_value("antigravity", Some("Stop"), &background, 5)
                .unwrap()
                .background_work
        );
    }

    #[test]
    fn kimi_main_identity_and_tool_ids_survive_normalization() {
        let start = json!({"hook_event_name":"SessionStart", "session_id":"session_new", "source":"startup", "agent_id":"main"});
        let input = from_native_value("kimi", None, &start, 1).unwrap();
        assert!(input.agent_id.is_none());
        assert_eq!(input.source.as_deref(), Some("clear"));
        let mut tool = json!({"hook_event_name":"PermissionRequest", "session_id":"session_new", "tool_call_id":"call-1", "tool_name":"Bash", "tool_input":{"command":"ls"}});
        let before = from_native_value("kimi", None, &tool, 2).unwrap();
        tool["hook_event_name"] = json!("PermissionResult");
        tool["tool_input"] = json!({});
        assert_eq!(
            before.tool_key,
            from_native_value("kimi", None, &tool, 3).unwrap().tool_key
        );
    }

    #[test]
    fn claude_permission_input_can_be_correlated_without_exposing_arguments() {
        let mut value = json!({"hook_event_name":"PreToolUse", "session_id":"native",
            "tool_use_id":"question-1", "tool_name":"AskUserQuestion",
            "tool_input":{"questions":[{"question":"private-question"}]}});
        let pre = from_native_value("claude", None, &value, 1).unwrap();
        value["hook_event_name"] = json!("PermissionRequest");
        value.as_object_mut().unwrap().remove("tool_use_id");
        let permission = from_native_value("claude", None, &value, 2).unwrap();
        assert_eq!(pre.tool_key.as_deref(), Some("question-1"));
        assert!(pre.tool_fingerprint.is_some());
        assert_eq!(pre.tool_fingerprint, permission.tool_fingerprint);
        assert_eq!(permission.tool_key, pre.tool_fingerprint);
        assert!(
            !serde_json::to_string(&pre)
                .unwrap()
                .contains("private-question")
        );
    }

    #[test]
    fn old_hook_messages_without_a_fingerprint_remain_readable() {
        let input = from_value(
            &json!({"hook_event_name":"PreToolUse", "session_id":"native",
            "tool_use_id":"call-1", "tool_name":"Bash", "tool_input":{"command":"ls"}}),
            1,
        )
        .unwrap();
        let mut value = serde_json::to_value(input).unwrap();
        value.as_object_mut().unwrap().remove("toolFingerprint");
        let legacy: HookInput = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.tool_key.as_deref(), Some("call-1"));
        assert!(legacy.tool_fingerprint.is_none());
    }
}

fn forward_stdin(agent: &str, configured_event: Option<&str>) {
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
    let mut stream = serde_json::Deserializer::from_reader(BufReader::new(
        std::io::stdin().lock().take(MAX_PAYLOAD_BYTES),
    ));
    let Ok(value) = Value::deserialize(&mut stream) else {
        return;
    };
    let Some(input) = from_native_value(agent, configured_event, &value, at) else {
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

/// Antigravity command hooks use camelCase and omit the configured event name.
pub fn from_native_value(
    agent: &str,
    configured_event: Option<&str>,
    value: &Value,
    at: i64,
) -> Option<HookInput> {
    if agent == "kimi" {
        let mut input = from_value(value, at)?;
        if input.agent_id.as_deref() == Some("main") {
            input.agent_id = None;
        }
        if input.event == "SessionStart" && input.source.as_deref() == Some("startup") {
            input.source = Some("clear".into());
        }
        return Some(input);
    }
    if agent != "antigravity" {
        return from_value(value, at);
    }
    let mut value = value.clone();
    let event = configured_event.or_else(|| value["hookEventName"].as_str())?;
    // PostInvocation precedes tool execution and must never be treated as a completed turn.
    let event = match event {
        "PreInvocation" => "UserPromptSubmit",
        "Stop"
            if value["terminationReason"] == "error"
                || value["error"].as_str().is_some_and(|s| !s.is_empty()) =>
        {
            "StopFailure"
        }
        "PostToolUse" if value["error"].as_str().is_some_and(|s| !s.is_empty()) => {
            "PostToolUseFailure"
        }
        event => event,
    }
    .to_owned();
    let object = value.as_object_mut()?;
    for (native, canonical) in [
        ("conversationId", "session_id"),
        ("transcriptPath", "transcript_path"),
        ("toolName", "tool_name"),
        ("toolInput", "tool_input"),
        ("agentId", "agent_id"),
    ] {
        if let Some(v) = object.get(native).cloned() {
            object.insert(canonical.into(), v);
        }
    }
    object.insert("hook_event_name".into(), Value::String(event.clone()));
    if let Some(name) = object.get("toolCall").and_then(|v| v.get("name")).cloned() {
        object.insert("tool_name".into(), name);
    }
    if let Some(args) = object.get("toolCall").and_then(|v| v.get("args")).cloned() {
        object.insert("tool_input".into(), args);
    }
    if let Some(step) = object.get("stepIdx").and_then(Value::as_u64) {
        object.insert("tool_call_id".into(), Value::String(format!("step:{step}")));
    }
    if event == "SessionStart" {
        object.insert("source".into(), Value::String("resume".into()));
    }
    let mut input = from_value(&value, at)?;
    input.background_work = value["fullyIdle"] == false;
    Some(input)
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
    // PermissionRequest can omit the invocation ID included by Pre/PostToolUse.
    // Keep the input hash alongside that ID so the observer can correlate them.
    let tool_fingerprint = tool_name
        .as_ref()
        .map(|name| tool_key(name, &value["tool_input"]));
    Some(HookInput {
        event,
        session_id,
        occurred_at,
        turn_id: field(value, "turn_id"),
        source: field(value, "source"),
        agent_id: field(value, "agent_id"),
        transcript_path: field(value, "transcript_path"),
        notification_type: field(value, "notification_type"),
        tool_key: field(value, "tool_call_id")
            .or_else(|| field(value, "tool_use_id"))
            .or_else(|| tool_fingerprint.clone()),
        tool_fingerprint,
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
