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
            let name = block["name"].as_str().unwrap_or(belfry_i18n::text("未知工具"));
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
            name: belfry_i18n::text("工具结果").into(),
            kind: "result".into(),
            text: text::content(&block["content"]).0,
            success: Some(!block["is_error"].as_bool().unwrap_or(false)),
            ..Default::default()
        }),
        _ => None,
    }
}

fn changes(name: &str, input: &Value) -> Vec<HistoryChange> {
    let Some(path) = string_field(input, &["file_path", "path", "filePath", "TargetFile"]) else {
        return Vec::new();
    };
    match name {
        "Edit" | "edit" | "replace_file_content" => vec![edit(path, input)],
        "MultiEdit" | "multi_replace_file_content" => input[if name == "MultiEdit" {
            "edits"
        } else {
            "ReplacementChunks"
        }]
        .as_array()
        .into_iter()
        .flatten()
        .take(text::MAX_CHANGES + 1)
        .map(|item| edit(path, item))
        .collect(),
        "Write" | "write" | "write_to_file" => vec![HistoryChange {
            path: path.into(),
            kind: "write".into(),
            new_text: string_field(input, &["content", "CodeContent"]).map(str::to_owned),
            note: belfry_i18n::text("日志中的写入内容；原内容未记录，无法判定是新建还是覆盖").into(),
            ..Default::default()
        }],
        _ => Vec::new(),
    }
}

fn edit(path: &str, input: &Value) -> HistoryChange {
    let old = string_field(input, &["old_string", "oldString", "TargetContent"]);
    let new = string_field(input, &["new_string", "newString", "ReplacementContent"]);
    let note = if old.is_none() || new.is_none() {
        belfry_i18n::text("日志内容不足，无法完整展示这次替换")
    } else if ["replace_all", "replaceAll", "AllowMultiple"]
        .iter()
        .any(|key| input[*key] == true)
    {
        belfry_i18n::text("替换全部匹配位置；日志仅记录替换片段")
    } else {
        belfry_i18n::text("日志中的替换片段，不代表完整文件")
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

fn string_field<'a>(input: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| input[*key].as_str())
}
