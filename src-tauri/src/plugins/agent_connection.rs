use super::{PluginRuntime, agent_context, engine, with_host};
use crate::{
    agent::{AgentKind, AgentSessionRef},
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
    if request.profile_id == "agent:codex" && crate::agent::native_launch::enabled(&request.env) {
        return None;
    }
    if request.command.is_some()
        || !matches!(
            LaunchProfileId::parse(&request.profile_id),
            Ok(LaunchProfileId::AgentCodex
                | LaunchProfileId::AgentClaude
                | LaunchProfileId::AgentPi
                | LaunchProfileId::AgentAntigravity
                | LaunchProfileId::AgentOpencode
                | LaunchProfileId::AgentKimi)
        )
    {
        return None;
    }
    let workspace = crate::resource::file_uri_to_path(request.cwd.as_deref()?).ok()?;
    if let Some(root) = crate::resource::canonicalize(&workspace)
        .ok()
        .and_then(|path| path.to_str().map(str::to_owned))
    {
        let existing = authorized_agents(app)
            .ok()
            .and_then(|owners| reattached_owner(request, &root, &owners).cloned());
        if let Some(owner) = existing {
            let input = agent_context::connection(request, &workspace, &owner.ticket);
            if let Ok((env, native)) = open(app, &input, "session.reconnect") {
                // Remounting a view does not replace its live PTY, MCP context,
                // or A2A identity. A new host still issues its own fresh ticket.
                request.env.extend(env);
                restore_discovered_session(request, native);
                return Some(owner.ticket);
            }
        }
    }
    let session_id = ulid::Ulid::generate().to_string();
    let input = agent_context::connection(request, &workspace, &session_id);
    if let Ok(kind) = serde_json::from_value(input["agentKind"].clone()) {
        if let Ok(mut identities) = app.state::<PluginRuntime>().identities.lock() {
            identities.register(&session_id, kind);
        }
    }
    match open(app, &input, "session.open") {
        Ok((mut env, native)) => {
            restore_discovered_session(request, native);
            if let Some(id) = input["launchSessionId"].as_str() {
                env.insert(agent_context::CLAUDE_SESSION_ENV.into(), id.into());
            }
            request.env.extend(env);
            Some(session_id)
        }
        Err(error) => {
            if let Ok(mut identities) = app.state::<PluginRuntime>().identities.lock() {
                identities.remove(&session_id);
            }
            let _ = app.emit_to("main", "plugin-notice", json!({"pluginId":belfry_i18n::text("插件连接"), "args":[belfry_i18n::lformat!("Agent 可正常使用，插件连接暂不可用：{}", error.message)]}));
            None
        }
    }
}

fn restore_discovered_session(
    request: &mut CreateTerminalRequest,
    native: Option<AgentSessionRef>,
) {
    // Claude 的 launchSessionId 是尚未创建的会话，不能把它误作 --resume。
    if request.profile_id == "agent:codex" && request.resume.is_none() {
        if let Some(native) =
            native.filter(|session| session.agent == AgentKind::Codex && session.validate().is_ok())
        {
            request.resume = Some(native.id);
        }
    }
}
fn open(
    app: &AppHandle,
    input: &serde_json::Value,
    method: &str,
) -> Result<(HashMap<String, String>, Option<AgentSessionRef>), AppError> {
    let state = app.state::<PluginRuntime>();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| AppError::io(belfry_i18n::text("插件操作锁不可用")))?;
    let registry = with_host(app, |host| host.list())?;
    state
        .engine
        .synchronize(app, &registry)
        .map_err(AppError::io)?;
    let (node, bridge) = engine::bridge_paths(app).map_err(AppError::io)?;
    let session = state
        .engine
        .request(app, method, input.clone())
        .map_err(AppError::io)?;
    let field = |key: &str| {
        session[key]
            .as_str()
            .map(String::from)
            .ok_or_else(|| AppError::io(belfry_i18n::text("插件会话响应无效")))
    };
    let native = serde_json::from_value(session["agentSession"].clone()).ok();
    Ok((
        HashMap::from([
            (URL_ENV.into(), field("url")?),
            (TOKEN_ENV.into(), field("token")?),
            (NODE_ENV.into(), node.to_string_lossy().into_owned()),
            (BRIDGE_ENV.into(), bridge.to_string_lossy().into_owned()),
        ]),
        native,
    ))
}
pub fn bind(app: &AppHandle, terminal_id: &str, ticket: Option<String>) {
    let Some(ticket) = ticket else {
        return;
    };
    let previous = app
        .state::<PluginRuntime>()
        .sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.insert(terminal_id.into(), ticket.clone()));
    if let Some(previous) = previous.filter(|previous| previous != &ticket) {
        revoke(app, &previous);
    }
    let identity = app
        .state::<PluginRuntime>()
        .identities
        .lock()
        .ok()
        .and_then(|mut identities| identities.bind(&ticket, terminal_id));
    if let Some(session) = identity {
        publish_identity(app, ticket, terminal_id.into(), session);
    }
}
pub fn revoke(app: &AppHandle, ticket: &str) {
    if let Some(gateway) = app.try_state::<crate::a2a::local::LocalGateway>() {
        gateway.revoke(ticket);
    }
    if let Some(runtime) = app.try_state::<crate::a2a::A2aRuntime>() {
        runtime.invalidate_session(ticket);
    }
    if let Ok(mut sessions) = app.state::<PluginRuntime>().sessions.lock() {
        sessions.retain(|_, current| current != ticket);
    }
    if let Ok(mut identities) = app.state::<PluginRuntime>().identities.lock() {
        identities.remove(ticket);
    }
    let _ = app.state::<PluginRuntime>().engine.request(
        app,
        "session.revoke",
        json!({"sessionId":ticket}),
    );
}

/// Validate the application ticket against an active managed PTY and its real cwd.
/// Neither a native history ID nor knowledge of a workspace path establishes ownership.
pub(crate) fn authorized_workspace(
    app: &AppHandle,
    workspace: &str,
    ticket: &str,
) -> Result<String, AppError> {
    let tickets = app
        .state::<PluginRuntime>()
        .sessions
        .lock()
        .map_err(|_| authorization_denied())?
        .clone();
    if ticket.is_empty() || ticket.len() > 128 || !tickets.values().any(|current| current == ticket)
    {
        return Err(authorization_denied());
    }
    let sessions = app
        .state::<crate::terminal::TerminalRuntime>()
        .background_sessions()
        .map_err(|_| authorization_denied())?;
    let (terminal, root) = authorized_snapshot(workspace, ticket, &tickets, &sessions)?;
    // A replacement/revoke may have happened while the daemon query was running.
    if app
        .state::<PluginRuntime>()
        .sessions
        .lock()
        .map_err(|_| authorization_denied())?
        .get(&terminal)
        .is_none_or(|current| current != ticket)
    {
        return Err(authorization_denied());
    }
    Ok(root)
}

/// An authenticated application instance. PTY and front-end tab IDs are distinct;
/// room membership always uses tab_id. This type deliberately has no Debug/Serialize.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct AuthorizedAgent {
    pub root: String,
    pub ticket: String,
    pub terminal_id: String,
    pub tab_id: String,
    pub agent: AgentKind,
}

fn reattached_owner<'a>(
    request: &CreateTerminalRequest,
    root: &str,
    owners: &'a [AuthorizedAgent],
) -> Option<&'a AuthorizedAgent> {
    let terminal_id = request.launch_overlay.attachment.as_deref()?;
    let tab_id = request.tab_id.as_deref()?;
    let agent = AgentKind::from_profile_id(&request.profile_id)?;
    owners.iter().find(|owner| {
        owner.terminal_id == terminal_id
            && owner.tab_id == tab_id
            && owner.agent == agent
            && owner.root == root
    })
}

pub(crate) fn authorized_agent(
    app: &AppHandle,
    workspace: &str,
    ticket: &str,
) -> Result<AuthorizedAgent, AppError> {
    if ticket.is_empty() || ticket.len() > 128 || !std::path::Path::new(workspace).is_absolute() {
        return Err(authorization_denied());
    }
    let root = crate::resource::canonicalize(std::path::Path::new(workspace))
        .map_err(|_| authorization_denied())?;
    authorized_agents(app)?
        .into_iter()
        .find(|agent| {
            agent.ticket == ticket
                && crate::resource::canonicalize(std::path::Path::new(&agent.root))
                    .ok()
                    .as_ref()
                    == Some(&root)
        })
        .ok_or_else(authorization_denied)
}

pub(crate) fn authorized_agents(app: &AppHandle) -> Result<Vec<AuthorizedAgent>, AppError> {
    let tickets = app
        .state::<PluginRuntime>()
        .sessions
        .lock()
        .map_err(|_| authorization_denied())?
        .clone();
    let sessions = app
        .state::<crate::terminal::TerminalRuntime>()
        .background_sessions()
        .map_err(|_| authorization_denied())?;
    let plugin_runtime = app.state::<PluginRuntime>();
    let current = plugin_runtime
        .sessions
        .lock()
        .map_err(|_| authorization_denied())?;
    let mut agents = vec![];
    for session in &sessions {
        let Some(ticket) = tickets
            .get(&session.session.id)
            .filter(|ticket| current.get(&session.session.id) == Some(ticket))
        else {
            continue;
        };
        let Some(tab) = session.tab_id.as_ref().filter(|tab| !tab.is_empty()) else {
            continue;
        };
        let Some(agent) = AgentKind::from_profile_id(&session.profile_id) else {
            continue;
        };
        let Ok(cwd) = crate::resource::file_uri_to_path(&session.session.cwd) else {
            continue;
        };
        let Some(workspace) = cwd.to_str() else {
            continue;
        };
        if let Ok((terminal_id, root)) = authorized_snapshot(workspace, ticket, &tickets, &sessions)
        {
            agents.push(AuthorizedAgent {
                root,
                ticket: ticket.clone(),
                terminal_id,
                tab_id: tab.clone(),
                agent,
            });
        }
    }
    Ok(agents)
}

fn authorization_denied() -> AppError {
    let mut error = AppError::invalid_argument(
        "An active Belfry agent connection in this project is required.",
    );
    error.code.0 = "A2A_AGENT_SESSION_INVALID".into();
    error
}

fn authorized_snapshot(
    workspace: &str,
    ticket: &str,
    tickets: &HashMap<String, String>,
    sessions: &[crate::terminal::daemon::SessionInfo],
) -> Result<(String, String), AppError> {
    if ticket.is_empty() || ticket.len() > 128 || !std::path::Path::new(workspace).is_absolute() {
        return Err(authorization_denied());
    }
    let terminal = tickets
        .iter()
        .find(|(_, current)| current.as_str() == ticket)
        .map(|(terminal, _)| terminal.clone())
        .ok_or_else(authorization_denied)?;
    let root = crate::resource::canonicalize(std::path::Path::new(workspace))
        .map_err(|_| authorization_denied())?;
    if !root.is_dir() {
        return Err(authorization_denied());
    }
    let session = sessions
        .iter()
        .find(|session| session.session.id == terminal)
        .ok_or_else(authorization_denied)?;
    if session.session.status != crate::terminal::TerminalStatus::Running
        || !session.profile_id.starts_with("agent:")
    {
        return Err(authorization_denied());
    }
    let cwd = crate::resource::file_uri_to_path(&session.session.cwd)
        .map_err(|_| authorization_denied())?;
    if crate::resource::canonicalize(&cwd).map_err(|_| authorization_denied())? != root {
        return Err(authorization_denied());
    }
    Ok((
        terminal,
        root.to_str()
            .map(str::to_owned)
            .ok_or_else(authorization_denied)?,
    ))
}

/// 只接收宿主核验的 MCP / 精确标签快照身份，不把插件正文或工具参数当作身份来源。
pub(super) fn identity_event(app: &AppHandle, event: &serde_json::Value) -> bool {
    if event["name"] != "sessionIdentity" {
        return false;
    }
    let Some(ticket) = event["sessionId"].as_str() else {
        return true;
    };
    let Ok(session) = serde_json::from_value::<AgentSessionRef>(event["session"].clone()) else {
        return true;
    };
    let terminal = app
        .state::<PluginRuntime>()
        .identities
        .lock()
        .ok()
        .and_then(|mut identities| identities.learn(ticket, session.clone()));
    if let Some(terminal) = terminal {
        publish_identity(app, ticket.into(), terminal, session);
    }
    true
}

fn publish_identity(app: &AppHandle, ticket: String, terminal: String, session: AgentSessionRef) {
    let app = app.clone();
    // 宿主 stdout 的读取不能等后台 I/O，否则身份事件会挡住同管道上的命令响应。
    std::thread::spawn(move || {
        let current = app
            .state::<PluginRuntime>()
            .identities
            .lock()
            .ok()
            .is_some_and(|identities| identities.is_current(&ticket, &terminal, &session));
        if current {
            let _ = app
                .state::<crate::terminal::TerminalRuntime>()
                .bind_native_session(&terminal, session);
        }
    });
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
        // Pi 的 MCP 服务器由扩展（pi package）装配，没有 CLI 标志可以注入，
        // 插件连接对 Pi 暂不生效，启动参数保持原样。
        AgentKind::Pi | AgentKind::Antigravity | AgentKind::Opencode | AgentKind::Kimi => {
            Vec::new()
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
    fn a2a_authorization_uses_the_live_ticket_pty_and_canonical_project() {
        let root =
            std::env::temp_dir().join(format!("belfry-a2a-owner-{}", ulid::Ulid::generate()));
        let project = root.join("project");
        let other = root.join("other");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let workspace = project.to_str().unwrap();
        let tickets = HashMap::from([("pty".to_owned(), "current-ticket".to_owned())]);
        let session: crate::terminal::daemon::SessionInfo = serde_json::from_value(json!({
            "session":{"id":"pty", "platform":"macos", "shell":"codex", "cwd":crate::resource::path_to_file_uri(&project),
                "cols":80, "rows":24, "status":"running", "exitCode":null},
            "tabId":"tab", "profileId":"agent:codex", "nativeSession":{"agent":"codex", "id":"native-history-id"}
        })).unwrap();
        assert!(
            authorized_snapshot(workspace, "current-ticket", &tickets, &[session.clone()]).is_ok()
        );
        for invalid in ["native-history-id", "retired-ticket", "pty", ""] {
            assert!(authorized_snapshot(workspace, invalid, &tickets, &[session.clone()]).is_err());
        }
        assert!(
            authorized_snapshot(
                other.to_str().unwrap(),
                "current-ticket",
                &tickets,
                &[session.clone()]
            )
            .is_err()
        );
        assert!(
            authorized_snapshot(
                workspace,
                "current-ticket",
                &HashMap::new(),
                &[session.clone()]
            )
            .is_err()
        );
        assert!(authorized_snapshot(workspace, "current-ticket", &tickets, &[]).is_err());
        let mut exited = session.clone();
        exited.session.status = crate::terminal::TerminalStatus::Exited;
        assert!(authorized_snapshot(workspace, "current-ticket", &tickets, &[exited]).is_err());
        let mut shell = session;
        shell.profile_id = "shell:zsh".into();
        assert!(authorized_snapshot(workspace, "current-ticket", &tickets, &[shell]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn view_reattachment_reuses_only_the_verified_same_pty_tab_agent_and_project() {
        let owner = AuthorizedAgent {
            root: "/project".into(),
            ticket: "live-ticket".into(),
            terminal_id: "existing-pty".into(),
            tab_id: "existing-tab".into(),
            agent: AgentKind::Codex,
        };
        let owners = vec![owner.clone()];
        let mut request: CreateTerminalRequest = serde_json::from_value(json!({
            "platform":"macos", "profileId":"agent:codex", "cwd":"file:///project",
            "tabId":"existing-tab", "cols":80, "rows":24, "elevation":"normal",
        }))
        .unwrap();
        assert!(reattached_owner(&request, "/project", &owners).is_none());
        request.launch_overlay.attachment = Some("existing-pty".into());
        assert!(reattached_owner(&request, "/project", &owners) == Some(&owner));
        assert!(reattached_owner(&request, "/other-project", &owners).is_none());
        assert!(reattached_owner(&request, "/project", &[]).is_none());
        let mut changed = request.clone();
        changed.tab_id = Some("other-tab".into());
        assert!(reattached_owner(&changed, "/project", &owners).is_none());
        let mut changed = request.clone();
        changed.profile_id = "agent:claude".into();
        assert!(reattached_owner(&changed, "/project", &owners).is_none());
        request.launch_overlay.attachment = Some("other-pty".into());
        assert!(reattached_owner(&request, "/project", &owners).is_none());
    }
    #[test]
    fn snapshot_identity_resumes_codex_without_turning_a_new_claude_launch_into_resume() {
        let request = |profile: &str, resume: Option<&str>| {
            serde_json::from_value::<CreateTerminalRequest>(json!({
                "platform":"macos", "profileId":profile, "cwd":"file:///tmp", "cols":80, "rows":24,
                "elevation":"normal", "resume":resume,
            }))
            .unwrap()
        };
        let native = |agent, id: &str| {
            Some(AgentSessionRef {
                agent,
                id: id.into(),
            })
        };
        let mut fresh = request("agent:codex", None);
        restore_discovered_session(&mut fresh, native(AgentKind::Codex, "discovered"));
        assert_eq!(fresh.resume.as_deref(), Some("discovered"));
        let mut saved = request("agent:codex", Some("known"));
        restore_discovered_session(&mut saved, native(AgentKind::Codex, "older"));
        assert_eq!(saved.resume.as_deref(), Some("known"));
        let mut claude = request("agent:claude", None);
        restore_discovered_session(&mut claude, native(AgentKind::Claude, "preallocated"));
        assert!(claude.resume.is_none());
        let mut codex = request("agent:codex", None);
        restore_discovered_session(&mut codex, native(AgentKind::Claude, "foreign"));
        restore_discovered_session(&mut codex, native(AgentKind::Codex, "../invalid"));
        assert!(codex.resume.is_none());
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
