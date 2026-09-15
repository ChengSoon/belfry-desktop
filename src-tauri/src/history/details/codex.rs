use super::{
    contracts::{HistoryEntry, HistoryTool},
    patch, text,
};
use serde_json::Value;

pub(super) fn parse(value: &Value, source: &str) -> Option<HistoryEntry> {
    let payload = &value["payload"];
    let mut entry = match value["type"].as_str()? {
        "response_item" => response(payload, source)?,
        "event_msg" => event(payload, source)?,
        _ => return None,
    };
    entry.timestamp = text::timestamp(&value["timestamp"]);
    Some(entry)
}

fn response(payload: &Value, source: &str) -> Option<HistoryEntry> {
    match payload["type"].as_str()? {
        "message" => message(payload, source),
        "function_call" | "custom_tool_call" => Some(tool_entry(call(payload, source), source)),
        "function_call_output" | "custom_tool_call_output" => {
            Some(tool_entry(result(payload, source), source))
        }
        _ => None,
    }
}

fn message(payload: &Value, source: &str) -> Option<HistoryEntry> {
    let role = payload["role"].as_str()?;
    if !matches!(role, "user" | "assistant") {
        return None;
    }
    let (body, omitted_blocks) = text::content(&payload["content"]);
    Some(HistoryEntry {
        id: source.into(),
        role: role.into(),
        text: body,
        omitted_blocks,
        ..Default::default()
    })
}

fn event(payload: &Value, source: &str) -> Option<HistoryEntry> {
    let role = match payload["type"].as_str()? {
        "user_message" => "user",
        "agent_message" => "assistant",
        _ => return None,
    };
    let (body, omitted_blocks) = text::content(&payload["message"]);
    Some(HistoryEntry {
        id: source.into(),
        role: role.into(),
        text: body,
        omitted_blocks,
        ..Default::default()
    })
}

fn call(payload: &Value, source: &str) -> HistoryTool {
    let name = payload["name"].as_str().unwrap_or("未知工具").to_owned();
    let input = if payload["input"].is_null() {
        &payload["arguments"]
    } else {
        &payload["input"]
    };
    let decoded = input
        .as_str()
        .and_then(|value| serde_json::from_str::<Value>(value).ok());
    let args = decoded.as_ref().unwrap_or(input);
    let patch_text = args
        .as_str()
        .or_else(|| args["patch"].as_str())
        .or_else(|| args["input"].as_str());
    let changes = if name == "apply_patch" || name.ends_with(".apply_patch") {
        patch_text.map(patch::changes).unwrap_or_default()
    } else {
        Vec::new()
    };
    HistoryTool {
        id: text::identity(payload["call_id"].as_str(), source),
        name,
        kind: "call".into(),
        text: text::display(args),
        changes,
        ..Default::default()
    }
}

fn result(payload: &Value, source: &str) -> HistoryTool {
    let raw = &payload["output"];
    let decoded = raw
        .as_str()
        .and_then(|value| serde_json::from_str::<Value>(value).ok());
    HistoryTool {
        id: text::identity(payload["call_id"].as_str(), source),
        name: "工具结果".into(),
        kind: "result".into(),
        text: text::display(raw),
        success: status(decoded.as_ref().unwrap_or(raw)),
        ..Default::default()
    }
}

fn status(value: &Value) -> Option<bool> {
    if let Some(failed) = value["is_error"].as_bool() {
        return Some(!failed);
    }
    if let Some(success) = value["success"].as_bool() {
        return Some(success);
    }
    value["exit_code"]
        .as_i64()
        .or_else(|| value["metadata"]["exit_code"].as_i64())
        .map(|code| code == 0)
}

fn tool_entry(tool: HistoryTool, source: &str) -> HistoryEntry {
    let role = if tool.kind == "result" {
        "tool"
    } else {
        "assistant"
    };
    HistoryEntry {
        id: source.into(),
        role: role.into(),
        tools: vec![tool],
        ..Default::default()
    }
}
