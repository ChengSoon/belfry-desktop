use super::{PluginRuntime, agent_context, engine, with_host};
use crate::{
    agent::AgentKind,
    terminal::{AppError, CreateTerminalRequest, LaunchProfileId},
};
use serde_json::json;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager};

const URL_ENV: &str = "BELFRY_PLUGIN_MCP_URL";
const TOKEN_ENV: &str = "BELFRY_PLUGIN_MCP_TOKEN";
const NODE_ENV: &str = "BELFRY_PLUGIN_NODE";
const BRIDGE_ENV: &str = "BELFRY_PLUGIN_MCP_BRIDGE";

pub fn attach(app: &AppHandle, request: &mut CreateTerminalRequest) -> Option<String> {
    if request.command.is_some()
        || !matches!(
            LaunchProfileId::parse(&request.profile_id),
            Ok(LaunchProfileId::AgentCodex | LaunchProfileId::AgentClaude)
        )
    {
        return None;
    }
    let workspace = crate::resource::file_uri_to_path(request.cwd.as_deref()?).ok()?;
    let session_id = ulid::Ulid::generate().to_string();
    let input = agent_context::connection(request, &workspace, &session_id);
    match open(app, &input) {
        Ok(mut env) => {
            if let Some(id) = input["launchSessionId"].as_str() {
                env.insert(agent_context::CLAUDE_SESSION_ENV.into(), id.into());
            }
            request.env.extend(env);
            Some(session_id)
        }
        Err(error) => {
            let _ = app.emit_to("main", "plugin-notice", json!({"pluginId":"插件连接", "args":[format!("Agent 可正常使用，插件连接暂不可用：{}", error.message)]}));
            None
        }
    }
}
fn open(app: &AppHandle, input: &serde_json::Value) -> Result<HashMap<String, String>, AppError> {
    let state = app.state::<PluginRuntime>();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| AppError::io("插件操作锁不可用"))?;
    let registry = with_host(app, |host| host.list())?;
    state
        .engine
        .synchronize(app, &registry)
        .map_err(AppError::io)?;
    let (node, bridge) = engine::bridge_paths(app).map_err(AppError::io)?;
    let session = state
        .engine
        .request(app, "session.open", input.clone())
        .map_err(AppError::io)?;
    let field = |key: &str| {
        session[key]
            .as_str()
            .map(String::from)
            .ok_or_else(|| AppError::io("插件会话响应无效"))
    };
    Ok(HashMap::from([
        (URL_ENV.into(), field("url")?),
        (TOKEN_ENV.into(), field("token")?),
        (NODE_ENV.into(), node.to_string_lossy().into_owned()),
        (BRIDGE_ENV.into(), bridge.to_string_lossy().into_owned()),
    ]))
}
pub fn bind(app: &AppHandle, terminal_id: &str, ticket: Option<String>) {
    let Some(ticket) = ticket else {
        return;
    };
    if let Ok(mut sessions) = app.state::<PluginRuntime>().sessions.lock() {
        sessions.insert(terminal_id.into(), ticket);
    }
}
pub fn revoke(app: &AppHandle, ticket: &str) {
    let _ = app.state::<PluginRuntime>().engine.request(
        app,
        "session.revoke",
        json!({"sessionId":ticket}),
    );
}
pub fn release(app: &AppHandle, terminal_id: &str) {
    let ticket = app
        .state::<PluginRuntime>()
        .sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(terminal_id));
    if let Some(ticket) = ticket {
        revoke(app, &ticket);
    }
}
pub(crate) fn arguments(kind: AgentKind, env: &HashMap<String, String>) -> Vec<String> {
    let (Some(node), Some(bridge)) = (env.get(NODE_ENV), env.get(BRIDGE_ENV)) else {
        return vec![];
    };
    if !env.contains_key(URL_ENV) || !env.contains_key(TOKEN_ENV) {
        return vec![];
    }
    match kind {
        AgentKind::Claude => {
            let mut arguments = vec![
                "--mcp-config".into(),
                json!({"mcpServers":{"belfry_plugins":{"command":node, "args":[bridge]}}})
                    .to_string(),
            ];
            if let Some(id) = env.get(agent_context::CLAUDE_SESSION_ENV) {
                arguments.extend(["--session-id".into(), id.clone()]);
            }
            arguments
        }
        AgentKind::Codex => {
            let entries = [
                ("command", json!(node)),
                ("args", json!([bridge])),
                ("env_vars", json!([URL_ENV, TOKEN_ENV])),
                ("startup_timeout_sec", json!(10)),
                ("tool_timeout_sec", json!(120)),
            ];
            entries
                .into_iter()
                .flat_map(|(key, value)| {
                    [
                        "-c".into(),
                        format!("mcp_servers.belfry_plugins.{key}={value}"),
                    ]
                })
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    fn environment() -> HashMap<String, String> {
        HashMap::from([
            (NODE_ENV.into(), "/path with spaces/node".into()),
            (BRIDGE_ENV.into(), "/plugin runtime/mcp-stdio.mjs".into()),
            (URL_ENV.into(), "http://127.0.0.1:1234/mcp".into()),
            (TOKEN_ENV.into(), "secret-session-token".into()),
        ])
    }
    #[test]
    fn codex_config_is_valid_toml_and_forwards_only_named_credentials() {
        let args = arguments(AgentKind::Codex, &environment());
        let text = args
            .chunks(2)
            .map(|pair| pair[1].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let parsed = text.parse::<toml_edit::DocumentMut>().unwrap();
        assert_eq!(
            Some("/path with spaces/node"),
            parsed["mcp_servers"]["belfry_plugins"]["command"].as_str()
        );
        assert!(!text.contains("secret-session-token"));
        assert!(text.contains(TOKEN_ENV));
    }
    #[test]
    fn claude_config_preserves_paths_and_does_not_replace_global_servers() {
        let args = arguments(AgentKind::Claude, &environment());
        assert_eq!("--mcp-config", args[0]);
        let value: Value = serde_json::from_str(&args[1]).unwrap();
        assert_eq!(
            json!(["/plugin runtime/mcp-stdio.mjs"]),
            value["mcpServers"]["belfry_plugins"]["args"]
        );
        assert!(!args.join(" ").contains("secret-session-token"));
        assert!(!args.contains(&"--strict-mcp-config".to_string()));
    }
    #[test]
    fn ordinary_agent_launches_have_no_extra_plugin_arguments() {
        assert!(arguments(AgentKind::Codex, &HashMap::new()).is_empty());
        assert!(arguments(AgentKind::Claude, &HashMap::new()).is_empty());
    }
}
