//! Add Belfry's existing MCP bridge using each CLI's supported configuration surface.
use crate::{
    agent::AgentKind,
    terminal::{AppError, CreateTerminalRequest},
};
use serde_json::json;

pub(crate) fn prepare(request: &mut CreateTerminalRequest) -> Result<(), AppError> {
    let Some(kind) = AgentKind::from_profile_id(&request.profile_id) else {
        return Ok(());
    };
    if !matches!(
        kind,
        AgentKind::Antigravity | AgentKind::Opencode | AgentKind::Kimi
    ) {
        return Ok(());
    }
    let (Some(node), Some(bridge)) = (
        request.env.get("BELFRY_PLUGIN_NODE"),
        request.env.get("BELFRY_PLUGIN_MCP_BRIDGE"),
    ) else {
        return Ok(());
    };
    if !request.env.contains_key("BELFRY_PLUGIN_MCP_TOKEN") {
        return Ok(());
    }
    if kind == AgentKind::Opencode {
        let text = request
            .launch_overlay
            .environment
            .get("OPENCODE_CONFIG_CONTENT")
            .or_else(|| request.env.get("OPENCODE_CONFIG_CONTENT"))
            .cloned()
            .or_else(|| std::env::var("OPENCODE_CONFIG_CONTENT").ok())
            .unwrap_or_default();
        let config = mcp_config(kind, &text, node, bridge)?;
        request
            .launch_overlay
            .environment
            .insert("OPENCODE_CONFIG_CONTENT".into(), config);
        return Ok(());
    }
    // These CLIs have no per-invocation MCP flag. Only the bridge command is persistent;
    // authentication is inherited from the individual PTY, never stored in their config.
    let path = if kind == AgentKind::Antigravity {
        crate::history::scan::home_dir().map(|p| p.join(".gemini/config/mcp_config.json"))
    } else {
        super::paths::config_dir(kind).map(|p| p.join("mcp.json"))
    }
    .ok_or_else(|| AppError::not_found("找不到 CLI MCP 配置目录"))?;
    let text = crate::atomic::read_text_optional(&path)?;
    let updated = mcp_config(kind, &text, node, bridge)?;
    if updated != text {
        crate::atomic::write_atomic(&path, &updated, true)?;
    }
    Ok(())
}

fn mcp_config(kind: AgentKind, text: &str, node: &str, bridge: &str) -> Result<String, AppError> {
    let parsed = crate::provider::json_config::parse(text)?;
    let path: &[&str] = if kind == AgentKind::Opencode {
        &["mcp", "servers", "belfry_plugins"]
    } else {
        &["mcpServers", "belfry_plugins"]
    };
    let existing = path.iter().try_fold(&parsed, |v, key| v.get(*key));
    if let Some(existing) = existing {
        let args = if kind == AgentKind::Opencode {
            existing["command"]
                .as_array()
                .filter(|v| v.len() == 2)
                .map(|v| &v[1])
        } else {
            existing["args"]
                .as_array()
                .filter(|v| v.len() == 1)
                .map(|v| &v[0])
        };
        let owned = args
            .and_then(serde_json::Value::as_str)
            .is_some_and(|p| p.replace('\\', "/").ends_with("/mcp-stdio.mjs"));
        if !owned {
            return Err(AppError::invalid_argument(
                "CLI 中 belfry_plugins MCP 名称已被其他配置占用",
            ));
        }
    }
    let mut entry = existing.cloned().unwrap_or_else(|| json!({}));
    if kind == AgentKind::Opencode {
        entry["type"] = json!("local");
        entry["command"] = json!([node, bridge]);
    } else {
        entry["command"] = json!(node);
        entry["args"] = json!([bridge]);
    }
    crate::provider::json_config::set(text, path, Some(&entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_overlay_preserves_provider_and_other_servers_without_storing_tickets() {
        let text = "{ // keep\n\"providers\":{\"mine\":{\"settings\":{\"apiKey\":\"provider-test\"}}},\"model\":\"mine/m\",\"mcp\":{\"servers\":{\"mine\":{\"type\":\"local\",\"command\":[\"server\"]}}}}";
        let updated = mcp_config(
            AgentKind::Opencode,
            text,
            "/bin/node",
            "/belfry/mcp-stdio.mjs",
        )
        .unwrap();
        let parsed = crate::provider::json_config::parse(&updated).unwrap();
        assert_eq!(parsed["model"], "mine/m");
        assert_eq!(
            parsed["providers"]["mine"]["settings"]["apiKey"],
            "provider-test"
        );
        assert_eq!(
            parsed["mcp"]["servers"]["mine"]["command"],
            json!(["server"])
        );
        assert_eq!(
            parsed["mcp"]["servers"]["belfry_plugins"],
            json!({"type":"local","command":["/bin/node","/belfry/mcp-stdio.mjs"]})
        );
        assert!(updated.contains("// keep") && !updated.contains("BELFRY_PLUGIN_MCP_TOKEN"));
    }

    #[test]
    fn native_mcp_keeps_settings_and_refuses_foreign_reserved_names() {
        let source = r#"{"mcpServers":{"belfry_plugins":{"command":"old-node","args":["C:\\Belfry\\mcp-stdio.mjs"],"timeout":90},"mine":{"command":"server"}}}"#;
        let updated = mcp_config(AgentKind::Kimi, source, "node", "/new/mcp-stdio.mjs").unwrap();
        let parsed = crate::provider::json_config::parse(&updated).unwrap();
        assert_eq!(parsed["mcpServers"]["belfry_plugins"]["timeout"], 90);
        assert_eq!(parsed["mcpServers"]["mine"]["command"], "server");
        for kind in [AgentKind::Antigravity, AgentKind::Kimi] {
            assert!(
                mcp_config(
                    kind,
                    r#"{"mcpServers":{"belfry_plugins":{"command":"user-owned-server"}}}"#,
                    "node",
                    "/bridge/mcp-stdio.mjs"
                )
                .is_err()
            );
        }
        assert!(mcp_config(AgentKind::Opencode, r#"{"mcp":{"servers":{"belfry_plugins":{"type":"remote","url":"https://example.test"}}}}"#, "node", "/bridge/mcp-stdio.mjs").is_err());
    }
}
