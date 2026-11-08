use crate::{agent::AgentKind, terminal::AppError};
use serde_json::{Value, json};
use toml_edit::{DocumentMut, Item, Table, value};

const AGY_OWNER: &str = "belfry-session-status";
const JS_MARKER: &str = "// belfry-hook-command: ";

pub(super) fn merge(
    text: &str,
    kind: AgentKind,
    command: Option<&str>,
) -> Result<String, AppError> {
    match kind {
        AgentKind::Kimi => {
            let mut doc: DocumentMut = text
                .parse()
                .map_err(|_| AppError::invalid_argument("Kimi Hook 配置不是有效 TOML"))?;
            if doc
                .get("hooks")
                .is_some_and(|item| !item.is_array_of_tables())
            {
                return Err(AppError::invalid_argument("Kimi hooks 必须为表数组"));
            }
            let mut hooks = doc
                .get("hooks")
                .and_then(Item::as_array_of_tables)
                .cloned()
                .unwrap_or_default();
            hooks.retain(|table| !is_command(table.get("command").and_then(Item::as_str), kind));
            if let Some(command) = command {
                for event in super::config::events(kind) {
                    let mut table = Table::new();
                    table["event"] = value(event);
                    table["command"] = value(command);
                    table["timeout"] = value(if cfg!(windows) { 8 } else { 2 });
                    hooks.push(table);
                }
            }
            if hooks.is_empty() {
                doc.remove("hooks");
            } else {
                doc["hooks"] = Item::ArrayOfTables(hooks);
            }
            Ok(doc.to_string())
        }
        AgentKind::Antigravity => {
            let mut doc = crate::provider::json_config::parse(text)?;
            let root = doc.as_object_mut().unwrap();
            if let Some(existing) = root.get(AGY_OWNER) {
                if !existing.is_object()
                    || commands(existing)
                        .iter()
                        .any(|c| !is_command(Some(c), kind))
                {
                    return Err(AppError::invalid_argument(
                        "Antigravity 同名 Hook 已被其他配置占用，未覆盖",
                    ));
                }
            }
            root.remove(AGY_OWNER);
            if let Some(command) = command {
                let mut events = serde_json::Map::new();
                for event in super::config::events(kind) {
                    let handler = json!({"type":"command", "command":format!("{command} {event}"), "timeout":if cfg!(windows) {8} else {2}});
                    events.insert(
                        event.into(),
                        if matches!(event, "PreToolUse" | "PostToolUse") {
                            json!([{"matcher":".*", "hooks":[handler]}])
                        } else {
                            json!([handler])
                        },
                    );
                }
                root.insert(AGY_OWNER.into(), Value::Object(events));
            }
            serde_json::to_string_pretty(&doc)
                .map(|s| s + "\n")
                .map_err(|e| AppError::io(e.to_string()))
        }
        AgentKind::Opencode => {
            if !text.trim().is_empty() && !text.starts_with(JS_MARKER) {
                return Err(AppError::invalid_argument(
                    "OpenCode 同名插件已被占用，未覆盖",
                ));
            }
            Ok(format!(
                "{JS_MARKER}{}\n{}",
                serde_json::to_string(&command).unwrap(),
                if command.is_some() {
                    include_str!("opencode.mjs")
                } else {
                    "export default { id: 'belfry-status', setup() {} };\n"
                }
            ))
        }
        _ => Err(AppError::invalid_argument("不支持的 Hook 类型")),
    }
}

fn is_command(command: Option<&str>, kind: AgentKind) -> bool {
    command.is_some_and(|c| {
        let end = format!(" --belfry-hook {}", kind.id());
        c.ends_with(&end)
            || (kind == AgentKind::Antigravity
                && super::config::events(kind)
                    .iter()
                    .any(|event| c.ends_with(&format!("{end} {event}"))))
    })
}
fn commands(value: &Value) -> Vec<String> {
    let mut found = Vec::new();
    match value {
        Value::Object(map) => {
            if let Some(command) = map.get("command").and_then(Value::as_str) {
                found.push(command.into());
            } else {
                for value in map.values() {
                    found.extend(commands(value));
                }
            }
        }
        Value::Array(array) => {
            for value in array {
                found.extend(commands(value));
            }
        }
        _ => {}
    }
    found
}

// Project the native formats into the inspector's common command list; never write this projection to disk.
pub(super) fn inspect(text: &str, kind: AgentKind) -> Result<Value, AppError> {
    let commands = match kind {
        AgentKind::Kimi => {
            let doc: DocumentMut = text
                .parse()
                .map_err(|_| AppError::invalid_argument("Kimi Hook 配置不是有效 TOML"))?;
            if doc.get("hooks").is_some_and(|v| !v.is_array_of_tables()) {
                return Err(AppError::invalid_argument("Kimi hooks 必须为表数组"));
            }
            doc.get("hooks")
                .and_then(Item::as_array_of_tables)
                .into_iter()
                .flatten()
                .filter_map(|t| t.get("command").and_then(Item::as_str))
                .map(str::to_string)
                .collect::<Vec<_>>()
        }
        AgentKind::Antigravity => commands(&crate::provider::json_config::parse(text)?[AGY_OWNER]),
        AgentKind::Opencode => {
            if text.trim().is_empty() {
                Vec::new()
            } else {
                let raw = text
                    .lines()
                    .next()
                    .and_then(|s| s.strip_prefix(JS_MARKER))
                    .ok_or_else(|| {
                        AppError::invalid_argument("OpenCode Hook 插件不是 Belfry 管理的文件")
                    })?;
                let command: Option<String> = serde_json::from_str(raw)
                    .map_err(|_| AppError::invalid_argument("OpenCode Hook 插件标识无效"))?;
                command
                    .into_iter()
                    .flat_map(|c| vec![c; super::config::events(kind).len()])
                    .collect()
            }
        }
        _ => Vec::new(),
    };
    let handlers = commands.into_iter().filter(|c| is_command(Some(c), kind)).map(|mut command| {
        if kind == AgentKind::Antigravity { command = command.rsplit_once(' ').unwrap().0.to_string(); }
        json!({"type":"command", "command":command, "statusMessage":format!("Belfry 会话状态 · {}",kind.id())})
    }).collect::<Vec<_>>();
    Ok(json!({"hooks":{"native":[{"hooks":handlers}]}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_hook_configs_round_trip_and_do_not_inject_unsupported_fields() {
        for kind in [AgentKind::Antigravity, AgentKind::Kimi, AgentKind::Opencode] {
            let command = format!("'/belfry' --belfry-hook {}", kind.id());
            let source = if kind == AgentKind::Kimi {
                "# keep\n[[hooks]]\nevent='Stop'\ncommand='user-hook'\n"
            } else {
                ""
            };
            let added = merge(source, kind, Some(&command)).unwrap();
            assert_eq!(
                super::super::config::owned_count(&inspect(&added, kind).unwrap(), kind),
                super::super::config::events(kind).len()
            );
            assert_eq!(merge(&added, kind, Some(&command)).unwrap(), added);
            let removed = merge(&added, kind, None).unwrap();
            assert_eq!(
                super::super::config::owned_count(&inspect(&removed, kind).unwrap(), kind),
                0
            );
            if kind == AgentKind::Kimi {
                assert!(removed.contains("user-hook"));
                assert!(!added.contains("statusMessage"));
            }
        }
    }
}
