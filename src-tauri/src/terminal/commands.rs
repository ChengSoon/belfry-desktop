use tauri::{State, ipc::Channel};

use crate::collab::SessionIdentities;

use super::contracts::{
    AppError, CreateTerminalRequest, LaunchProfileId, ShellProfile, SshTarget, TerminalEvent,
    TerminalPalette, TerminalSession, TerminalSize,
};
use super::launch::detect_shell_profiles;
use super::runtime::TerminalRuntime;

#[tauri::command]
pub fn terminal_create(
    runtime: State<'_, TerminalRuntime>,
    identities: State<'_, SessionIdentities>,
    mut request: CreateTerminalRequest,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSession, AppError> {
    issue_collab_identity(&identities, &mut request);
    runtime.create(request, on_event)
}

/// 给 Agent 会话发协作身份牌，注入进它自己那条 PTY 的环境变量。
///
/// 只发给 Agent：Shell 和 SSH 会话不参与协作，给它们发牌等于凭空多出一条
/// 能以「会话」身份说话的通道，而它背后可能是任意一个用户手敲的命令。
///
/// token 在这里生成，全程不经过前端——前端只说「这条会话是谁」，不碰凭证。
fn issue_collab_identity(identities: &SessionIdentities, request: &mut CreateTerminalRequest) {
    let Some(tab_id) = request.tab_id.clone() else {
        return;
    };
    if !matches!(
        LaunchProfileId::parse(&request.profile_id),
        Ok(LaunchProfileId::AgentCodex | LaunchProfileId::AgentClaude)
    ) {
        return;
    }
    for (key, value) in identities.issue(&tab_id, request.cwd.as_deref()) {
        // 调用方显式传的同名变量优先：别让身份注入盖掉用户自己的设置。
        request.env.entry(key).or_insert(value);
    }
}

#[tauri::command]
pub fn terminal_shell_profiles() -> Vec<ShellProfile> {
    detect_shell_profiles()
}

#[tauri::command]
pub fn terminal_write(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    bytes: Vec<u8>,
) -> Result<(), AppError> {
    runtime.write(&session_id, &bytes)
}

#[tauri::command]
pub fn terminal_resize(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), AppError> {
    runtime.resize(&session_id, TerminalSize { cols, rows })
}

#[tauri::command]
pub fn terminal_set_palette(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
    palette: TerminalPalette,
) -> Result<(), AppError> {
    runtime.set_palette(&session_id, &palette)
}

#[tauri::command]
pub fn terminal_close(
    runtime: State<'_, TerminalRuntime>,
    session_id: String,
) -> Result<(), AppError> {
    runtime.close(&session_id)
}

/// 清除某个 SSH 目标保存的密码。没有存过也算成功，按钮点击无需区分状态。
#[tauri::command]
pub fn ssh_credentials_remove(target: SshTarget) -> Result<(), AppError> {
    super::ssh_auth::remove(&target).map_err(AppError::io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use belfry_protocol::{ENV_PROJECT, ENV_TAB_ID, ENV_TOKEN};
    use std::collections::HashMap;

    fn request(profile_id: &str, tab_id: Option<&str>) -> CreateTerminalRequest {
        CreateTerminalRequest {
            platform: super::super::contracts::Platform::Macos,
            profile_id: profile_id.to_string(),
            tab_id: tab_id.map(str::to_string),
            cwd: Some("/tmp/project".to_string()),
            command: None,
            env: HashMap::new(),
            resume: None,
            ssh: None,
            cols: 80,
            rows: 24,
            elevation: super::super::contracts::Elevation::Normal,
            palette: None,
        }
    }

    #[test]
    fn an_agent_session_gets_an_identity() {
        let identities = SessionIdentities::default();
        let mut req = request("agent:claude", Some("tab-1"));

        issue_collab_identity(&identities, &mut req);

        assert_eq!(req.env.get(ENV_TAB_ID).map(String::as_str), Some("tab-1"));
        assert_eq!(
            req.env.get(ENV_PROJECT).map(String::as_str),
            Some("/tmp/project")
        );
        let token = req.env.get(ENV_TOKEN).expect("应该发了 token");
        assert!(identities.verify("tab-1", token));
    }

    #[test]
    fn shell_and_ssh_sessions_get_nothing() {
        let identities = SessionIdentities::default();

        // 给 Shell 发牌等于凭空多出一条能以「会话」身份说话的通道，
        // 而它背后是用户手敲的任意命令。
        for profile in ["system-default", "shell:zsh", "ssh"] {
            let mut req = request(profile, Some("tab-1"));
            issue_collab_identity(&identities, &mut req);
            assert!(req.env.is_empty(), "{profile} 不该拿到身份");
            assert!(!identities.verify("tab-1", ""));
        }
    }

    #[test]
    fn a_session_without_a_tab_id_gets_nothing() {
        let identities = SessionIdentities::default();
        let mut req = request("agent:codex", None);

        issue_collab_identity(&identities, &mut req);

        assert!(req.env.is_empty());
    }

    #[test]
    fn an_explicit_env_value_is_not_overwritten() {
        let identities = SessionIdentities::default();
        let mut req = request("agent:codex", Some("tab-1"));
        req.env
            .insert(ENV_PROJECT.to_string(), "/elsewhere".to_string());

        issue_collab_identity(&identities, &mut req);

        // 调用方显式传的值优先，身份注入只补缺。
        assert_eq!(
            req.env.get(ENV_PROJECT).map(String::as_str),
            Some("/elsewhere")
        );
        assert!(req.env.contains_key(ENV_TOKEN));
    }
}
