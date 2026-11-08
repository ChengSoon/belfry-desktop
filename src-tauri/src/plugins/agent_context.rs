use crate::{agent::AgentKind, terminal::CreateTerminalRequest};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub(super) const CLAUDE_SESSION_ENV: &str = "BELFRY_PLUGIN_CLAUDE_SESSION_ID";

pub(super) fn connection(request: &CreateTerminalRequest, workspace: &Path, ticket: &str) -> Value {
    let kind = AgentKind::from_profile_id(&request.profile_id)
        .expect("agent connection requires an agent profile");
    // 重连已有 PTY 不会重新执行启动参数，不能给旧 Claude 进程虚构一个 --session-id。
    let launch_id = (kind == AgentKind::Claude
        && request.resume.is_none()
        && request.launch_overlay.attachment.is_none())
    .then(new_uuid);
    let session_id = request.resume.as_ref().or(launch_id.as_ref());
    json!({
        "sessionId": ticket, "workspace": workspace, "agentKind": kind, "tabId": request.tab_id,
        "agentSession": session_id.map(|id| json!({"agent": kind, "id": id})),
        "historyRoot": history_root(request, kind, workspace), "launchSessionId": launch_id,
    })
}
fn history_root(
    request: &CreateTerminalRequest,
    kind: AgentKind,
    workspace: &Path,
) -> Option<PathBuf> {
    if crate::history::native::supported(kind) {
        return crate::history::native::root(kind);
    }
    if !matches!(kind, AgentKind::Codex | AgentKind::Claude) {
        return crate::agent::paths::sessions_root(kind);
    }
    let (key, folder, suffix) = if kind == AgentKind::Codex {
        ("CODEX_HOME", ".codex", "sessions")
    } else {
        ("CLAUDE_CONFIG_DIR", ".claude", "projects")
    };
    let configured = request
        .env
        .get(key)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(key)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        });
    let root =
        configured.or_else(|| crate::history::scan::home_dir().map(|path| path.join(folder)))?;
    Some(
        if root.is_absolute() {
            root
        } else {
            workspace.join(root)
        }
        .join(suffix),
    )
}
fn new_uuid() -> String {
    let mut bytes = ulid::Ulid::generate().to_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let value = format!("{:032x}", u128::from_be_bytes(bytes));
    format!(
        "{}-{}-{}-{}-{}",
        &value[..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn claude_allocates_an_identity_only_for_a_new_process_and_keeps_known_resume() {
        let mut request: CreateTerminalRequest = serde_json::from_value(json!({
            "platform":"macos", "profileId":"agent:claude", "cwd":"file:///tmp",
            "cols":80, "rows":24, "elevation":"normal"
        }))
        .unwrap();
        let workspace = Path::new("/tmp");
        let fresh = connection(&request, workspace, "fresh");
        assert!(fresh["launchSessionId"].is_string());
        assert_eq!(fresh["launchSessionId"], fresh["agentSession"]["id"]);

        request.launch_overlay.attachment = Some("existing-pty".into());
        let attached = connection(&request, workspace, "attached");
        assert!(attached["launchSessionId"].is_null());
        assert!(attached["agentSession"].is_null());

        request.resume = Some("known-claude-history".into());
        let resumed = connection(&request, workspace, "resumed");
        assert!(resumed["launchSessionId"].is_null());
        assert_eq!(resumed["agentSession"]["id"], "known-claude-history");
    }
    #[test]
    fn new_claude_identifiers_have_the_uuid_shape_required_by_the_cli() {
        let value = new_uuid();
        assert_eq!(
            vec![8, 4, 4, 4, 12],
            value.split('-').map(str::len).collect::<Vec<_>>()
        );
        assert_eq!("4", &value[14..15]);
        assert!(matches!(&value[19..20], "8" | "9" | "a" | "b"));
        assert_ne!(value, new_uuid());
    }
}
