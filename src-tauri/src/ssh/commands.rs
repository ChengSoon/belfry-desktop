use std::process::Command;
use std::time::Duration;
use tauri::State;
use crate::terminal::{AppError, resolve_ssh_executable};
use super::{aliases, contracts::{AliasReport, ProbeRequest, RemoteReport}, process, remote, SshRequests};

const PROBE_TIMEOUT: Duration = Duration::from_secs(12);

#[tauri::command]
pub async fn ssh_aliases() -> Result<AliasReport, AppError> {
    tauri::async_runtime::spawn_blocking(aliases::read_default).await
        .map_err(|error| AppError::io(error.to_string()))?
}

#[tauri::command]
pub fn ssh_cancel_probe(state: State<'_, SshRequests>, request_id: String) {
    state.cancel(&request_id);
}

#[tauri::command]
pub async fn ssh_probe(state: State<'_, SshRequests>, request: ProbeRequest) -> Result<RemoteReport, AppError> {
    request.target.validate()?;
    if request.target.password.is_some() || request.target.remember_password == Some(true) {
        return Err(AppError::invalid_argument("SSH 目录浏览不接收密码，请使用密钥或在终端连接"));
    }
    let cancelled = state.begin(&request.id)?;
    let id = request.id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(resolve_ssh_executable()?);
        command.args(remote::probe_arguments(&request.target, request.browse));
        if let Some(path) = crate::agent::login_shell_env().get("PATH") { command.env("PATH", path); }
        command.env("SSH_ASKPASS_REQUIRE", "never");
        let output = process::run(command, &cancelled, PROBE_TIMEOUT)?;
        if !output.status.success() {
            return Err(AppError::io(format!("SSH 连接失败：{}\n需要密码或首次确认主机指纹时，请先通过连接按钮在终端完成。", output.error.trim())));
        }
        remote::parse_output(&output.bytes)
    }).await.map_err(|error| AppError::io(error.to_string()));
    state.finish(&id);
    result?
}
