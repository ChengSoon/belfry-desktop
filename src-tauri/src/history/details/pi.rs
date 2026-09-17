//! Pi 会话详情的单行解析。每行是一条 AgentMessage（`role` + Unix 毫秒 `timestamp`）。

use super::{
    contracts::{HistoryEntry, HistoryTool},
    text,
};
use crate::agent::AgentSessionRef;
use serde_json::Value;

pub(super) fn parse(session: &AgentSessionRef, value: &Value, source: &str) -> Option<HistoryEntry> {
    if session.agent != crate::agent::AgentKind::Pi {
        return None;
    }
    let role = value["role"].as_str()?;
    let (body, omitted_blocks, tools) = match role {
        "user" | "assistant" => {
            let (body, omitted) = text::content(&value["content"]);
            let tools = value["content"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .filter_map(|(index, block)| tool_call(block, &format!("{source}:tool-{index}")))
                .take(text::MAX_TOOLS + 1)
                .collect::<Vec<_>>();
            (body, omitted, tools)
        }
        "toolResult" => {
            let (body, _) = text::content(&value["content"]);
            let tools = vec![HistoryTool {
                id: text::identity(value["toolCallId"].as_str(), source),
                name: value["toolName"].as_str().unwrap_or("未知工具").to_string(),
                kind: "result".to_string(),
                text: String::new(),
                success: Some(value["isError"] != true),
                ..Default::default()
            }];
            (body, 0, tools)
        }
        "bashExecution" => (
            value["output"].as_str().unwrap_or_default().to_string(),
            0,
            Vec::new(),
        ),
        _ => return None,
    };
    Some(HistoryEntry {
        id: source.into(),
        role: role.into(),
        timestamp: value["timestamp"].as_i64().map(|ms| ms / 1_000),
        text: body,
        tools,
        omitted_blocks,
        ..Default::default()
    })
}

fn tool_call(block: &Value, source: &str) -> Option<HistoryTool> {
    if block["type"].as_str()? != "toolCall" {
        return None;
    }
    Some(HistoryTool {
        id: text::identity(block["id"].as_str(), source),
        name: block["name"].as_str().unwrap_or("未知工具").to_string(),
        kind: "call".to_string(),
        text: text::display(&block["arguments"]),
        ..Default::default()
    })
}
