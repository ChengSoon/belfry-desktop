use super::contracts::HookInput;
use crate::agent::validate_agent_session_id;
use serde_json::Value;
use std::hash::{DefaultHasher, Hash, Hasher};

pub(super) const EVENTS: &[&str] = &[
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
const MAX_FIELD_BYTES: usize = 4096;

pub(super) fn from_payload(payload: &[u8], occurred_at: i64) -> Option<HookInput> {
    let value: Value = serde_json::from_slice(payload).ok()?;
    let event = field(&value, "hook_event_name")?;
    let session_id = field(&value, "session_id")?;
    if !EVENTS.contains(&event.as_str()) || validate_agent_session_id(&session_id).is_err() {
        return None;
    }
    let tool_name = field(&value, "tool_name");
    Some(HookInput {
        event,
        session_id,
        occurred_at,
        turn_id: field(&value, "turn_id"),
        source: field(&value, "source"),
        agent_id: field(&value, "agent_id"),
        transcript_path: field(&value, "transcript_path"),
        notification_type: field(&value, "notification_type"),
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
