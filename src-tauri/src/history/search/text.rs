use serde_json::Value;

use crate::agent::AgentKind;

pub(super) fn record_text(agent: AgentKind, record: &Value) -> Vec<String> {
    match agent {
        AgentKind::Codex => codex_text(record),
        AgentKind::Claude => match record["type"].as_str() {
            Some("user" | "assistant") => content_text(&record["message"]["content"]),
            _ => Vec::new(),
        },
    }
}

fn codex_text(record: &Value) -> Vec<String> {
    let payload = &record["payload"];
    match (record["type"].as_str(), payload["type"].as_str()) {
        (Some("response_item"), Some("message"))
            if matches!(payload["role"].as_str(), Some("user" | "assistant")) =>
        {
            content_text(&payload["content"])
        }
        (Some("event_msg"), Some("user_message" | "agent_message")) => {
            content_text(&payload["message"])
        }
        (Some("response_item"), Some("function_call" | "custom_tool_call")) => {
            let mut texts = content_text(&payload["name"]);
            texts.extend(argument_text(&payload["arguments"]));
            texts.extend(argument_text(&payload["input"]));
            texts
        }
        (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => {
            argument_text(&payload["output"])
        }
        _ => Vec::new(),
    }
}

fn content_text(content: &Value) -> Vec<String> {
    let mut texts = Vec::new();
    let mut pending = vec![content];
    while let Some(value) = pending.pop() {
        match value {
            Value::String(text) if !text.trim().is_empty() => texts.push(text.clone()),
            Value::Array(parts) => pending.extend(parts.iter().rev()),
            Value::Object(_) => append_block(value, &mut pending, &mut texts),
            _ => {}
        }
    }
    texts
}

fn append_block<'a>(value: &'a Value, pending: &mut Vec<&'a Value>, texts: &mut Vec<String>) {
    match value["type"].as_str() {
        Some("text" | "input_text" | "output_text") => pending.push(&value["text"]),
        Some("tool_result") => pending.push(&value["content"]),
        Some("tool_use") => {
            texts.extend(argument_text(&value["name"]));
            texts.extend(argument_text(&value["input"]));
        }
        _ => {}
    }
}

fn argument_text(value: &Value) -> Vec<String> {
    let decoded = value
        .as_str()
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    let mut pending = vec![decoded.as_ref().unwrap_or(value)];
    let mut texts = Vec::new();
    while let Some(value) = pending.pop() {
        match value {
            Value::String(text) if !text.trim().is_empty() => texts.push(text.clone()),
            Value::Array(parts) => pending.extend(parts.iter().rev()),
            Value::Object(fields) if !is_image(value) => pending.extend(fields.values().rev()),
            _ => {}
        }
    }
    texts
}

fn is_image(value: &Value) -> bool {
    matches!(
        value["type"].as_str(),
        Some("image" | "image_url" | "input_image" | "base64")
    )
}
