use crate::{agent::AgentKind, terminal::AppError};
use serde_json::{Map, Value, json};
use std::path::Path;

const MARKER: &str = "Belfry 会话状态";
const COMMON_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "Stop",
    "SessionEnd",
];

pub(super) fn events(kind: AgentKind) -> Vec<&'static str> {
    let mut events = COMMON_EVENTS.to_vec();
    events.extend(match kind {
        AgentKind::Codex => vec!["Interrupt", "PreCompact", "PostCompact"],
        AgentKind::Claude => vec!["Notification", "StopFailure", "PostToolUseFailure"],
    });
    events
}

pub(super) fn merge(
    text: &str,
    kind: AgentKind,
    command: Option<&str>,
) -> Result<String, AppError> {
    let mut value = parse(text)?;
    let before = value.clone();
    let root = value.as_object_mut().unwrap();
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap();
    remove_owned(hooks, kind);
    if let Some(command) = command {
        for event in events(kind) {
            hooks
                .entry(event)
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .unwrap()
                .push(handler(kind, event, command));
        }
    }
    if hooks.is_empty() {
        root.remove("hooks");
    }
    if value == before {
        return Ok(text.into());
    }
    serde_json::to_string_pretty(&value)
        .map(|text| text + "\n")
        .map_err(|error| AppError::io(error.to_string()))
}

pub(super) fn parse(text: &str) -> Result<Value, AppError> {
    let value: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(text)
            .map_err(|_| AppError::invalid_argument("Hook 配置不是有效 JSON，已保留原文件"))?
    };
    let root = value
        .as_object()
        .ok_or_else(|| AppError::invalid_argument("Hook 配置顶层必须是对象"))?;
    if let Some(hooks) = root.get("hooks") {
        let hooks = hooks
            .as_object()
            .ok_or_else(|| AppError::invalid_argument("hooks 必须是对象"))?;
        for groups in hooks.values() {
            validate_groups(groups)?;
        }
    }
    Ok(value)
}

fn validate_groups(value: &Value) -> Result<(), AppError> {
    let invalid = || AppError::invalid_argument("Hook 事件必须包含命令数组，已保留原文件");
    for group in value.as_array().ok_or_else(invalid)? {
        let handlers = group
            .get("hooks")
            .and_then(Value::as_array)
            .ok_or_else(invalid)?;
        if handlers.iter().any(|handler| !handler.is_object()) {
            return Err(invalid());
        }
    }
    Ok(())
}

fn handler(kind: AgentKind, event: &str, command: &str) -> Value {
    let mut value = json!({"hooks":[{"type":"command", "command":command, "timeout":1,
        "statusMessage":format!("{MARKER} · {}", kind.command_name())}]});
    if event == "Notification" {
        value["matcher"] = json!("permission_prompt|elicitation_dialog");
    }
    value
}

fn owned(handler: &Value, kind: AgentKind) -> bool {
    handler["type"] == "command"
        && handler["statusMessage"] == format!("{MARKER} · {}", kind.command_name())
        && handler["command"].as_str().is_some_and(|command| {
            command.ends_with(&format!(" --belfry-hook {}", kind.command_name()))
        })
}

fn remove_owned(hooks: &mut Map<String, Value>, kind: AgentKind) {
    hooks.retain(|_, value| {
        let groups = value.as_array_mut().unwrap();
        let was_empty = groups.is_empty();
        groups.retain_mut(|group| {
            let handlers = group["hooks"].as_array_mut().unwrap();
            let before = handlers.len();
            handlers.retain(|handler| !owned(handler, kind));
            !handlers.is_empty() || before == 0
        });
        !groups.is_empty() || was_empty
    });
}

pub(super) fn owned_count(value: &Value, kind: AgentKind) -> usize {
    value["hooks"]
        .as_object()
        .into_iter()
        .flat_map(|hooks| hooks.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|group| group["hooks"].as_array())
        .flatten()
        .filter(|handler| owned(handler, kind))
        .count()
}

pub(super) fn command(path: &Path, kind: AgentKind, windows: bool) -> Result<String, AppError> {
    let path = path
        .to_str()
        .filter(|path| !path.chars().any(char::is_control))
        .ok_or_else(|| AppError::invalid_argument("应用路径无法安全转换为 Hook 命令"))?;
    let quoted = if windows {
        if path.contains(['%', '!', '"']) {
            return Err(AppError::invalid_argument(
                "应用路径含命令展开字符，请移动应用后重试",
            ));
        }
        format!("\"{path}\"")
    } else {
        format!("'{}'", path.replace('\'', "'\"'\"'"))
    };
    Ok(format!("{quoted} --belfry-hook {}", kind.command_name()))
}
