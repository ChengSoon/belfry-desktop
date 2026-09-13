use super::{
    contracts::{HistoryChange, HistoryEntry, HistoryTool},
    text,
};
use crate::agent::AgentSessionRef;
use serde_json::Value;

pub(super) fn parse(
    session: &AgentSessionRef,
    value: &Value,
    source: &str,
) -> Option<HistoryEntry> {
    if value["isSidechain"] == true
        || value["sessionId"]
            .as_str()
            .is_some_and(|id| id != session.id)
    {
        return None;
    }
    let role = value["type"].as_str()?;
    if !matches!(role, "user" | "assistant") {
        return None;
    }
    let (body, omitted_blocks) = text::content(&value["message"]["content"]);
    let tools: Vec<_> = value["message"]["content"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, block)| tool(block, &format!("{source}:tool-{index}")))
        .take(text::MAX_TOOLS + 1)
        .collect();
    let role =
        if body.is_empty() && !tools.is_empty() && tools.iter().all(|tool| tool.kind == "result") {
            "tool"
        } else {
            role
        };
    Some(HistoryEntry {
        id: source.into(),
        role: role.into(),
        timestamp: text::timestamp(&value["timestamp"]),
        text: body,
        tools,
        omitted_blocks,
        ..Default::default()
    })
}

fn tool(block: &Value, source: &str) -> Option<HistoryTool> {
    match block["type"].as_str()? {
        "tool_use" => {
            let name = block["name"].as_str().unwrap_or("未知工具");
            Some(HistoryTool {
                id: text::identity(block["id"].as_str(), source),
                name: name.into(),
                kind: "call".into(),
                text: text::display(&block["input"]),
                changes: changes(name, &block["input"]),
                ..Default::default()
            })
        }
        "tool_result" => Some(HistoryTool {
            id: text::identity(block["tool_use_id"].as_str(), source),
            name: "工具结果".into(),
            kind: "result".into(),
            text: text::content(&block["content"]).0,
            success: Some(!block["is_error"].as_bool().unwrap_or(false)),
            ..Default::default()
        }),
        _ => None,
    }
}

fn changes(name: &str, input: &Value) -> Vec<HistoryChange> {
    let Some(path) = input["file_path"].as_str() else {
        return Vec::new();
    };
    match name {
        "Edit" => vec![edit(path, input)],
        "MultiEdit" => input["edits"]
            .as_array()
            .into_iter()
            .flatten()
            .take(text::MAX_CHANGES + 1)
            .map(|item| edit(path, item))
            .collect(),
        "Write" => vec![HistoryChange {
            path: path.into(),
            kind: "write".into(),
            new_text: input["content"].as_str().map(str::to_owned),
            note: "日志中的写入内容；原内容未记录，无法判定是新建还是覆盖".into(),
            ..Default::default()
        }],
        _ => Vec::new(),
    }
}

fn edit(path: &str, input: &Value) -> HistoryChange {
    let old = input["old_string"].as_str();
    let new = input["new_string"].as_str();
    let note = if old.is_none() || new.is_none() {
        "日志内容不足，无法完整展示这次替换"
    } else if input["replace_all"] == true {
        "替换全部匹配位置；日志仅记录替换片段"
    } else {
        "日志中的替换片段，不代表完整文件"
    };
    HistoryChange {
        path: path.into(),
        kind: "edit".into(),
        old_text: old.map(str::to_owned),
        new_text: new.map(str::to_owned),
        note: note.into(),
        ..Default::default()
    }
}
