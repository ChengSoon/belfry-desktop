use crate::{
    agent::{AgentKind, detection::find_agent},
    terminal::AppError,
};
use std::process::Command;

pub(super) fn supported(kind: AgentKind) -> bool {
    matches!(
        kind,
        AgentKind::Antigravity | AgentKind::Opencode | AgentKind::Kimi
    )
}

pub(super) fn command_text(kind: AgentKind, installed: bool) -> Option<String> {
    if installed {
        return match kind {
            AgentKind::Antigravity => Some("agy update".into()),
            AgentKind::Opencode => Some("opencode upgrade".into()),
            AgentKind::Kimi => Some("kimi upgrade --yes".into()),
            _ => None,
        };
    }
    (kind==AgentKind::Antigravity).then(||if cfg!(windows) {
        "powershell -NoProfile -Command \"irm https://antigravity.google/cli/install.ps1 | iex\"".into()
    } else {"curl -fsSL https://antigravity.google/cli/install.sh | bash".into()})
}

pub(super) fn command(kind: AgentKind) -> Result<Option<Command>, AppError> {
    if !supported(kind) {
        return Ok(None);
    }
    if let Some(executable) = find_agent(kind) {
        // npm mirrors retain their original package and registry.
        if super::package::detect(&executable).is_some() {
            return Ok(None);
        }
        let mut command = crate::setup::process::command_for(&executable);
        command.args(match kind {
            AgentKind::Antigravity => &["update"][..],
            AgentKind::Opencode => &["upgrade"][..],
            _ => &["upgrade", "--yes"][..],
        });
        return Ok(Some(command));
    }
    if kind != AgentKind::Antigravity {
        return Ok(None);
    }
    let mut command = if cfg!(windows) {
        let mut command =
            crate::setup::process::command_for(std::path::Path::new("powershell.exe"));
        command.args(["-NoLogo","-NoProfile","-NonInteractive","-Command","$ErrorActionPreference = 'Stop'; Invoke-RestMethod -Uri 'https://antigravity.google/cli/install.ps1' | Invoke-Expression"]);
        command
    } else {
        let mut command = Command::new("bash");
        command.args([
            "-o",
            "pipefail",
            "-c",
            "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        ]);
        command
    };
    command.stdin(std::process::Stdio::null());
    Ok(Some(command))
}

pub(super) async fn latest(kind: AgentKind) -> Result<Option<String>, String> {
    if kind != AgentKind::Antigravity {
        return super::registry::latest(
            super::package::default_package(kind).ok_or(belfry_i18n::text("没有官方安装来源"))?,
        )
        .await;
    }
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "amd64"
    } else {
        return Err(belfry_i18n::text("此平台尚无 Antigravity 官方发行版").into());
    };
    let url = format!(
        "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/{os}_{arch}.json"
    );
    let value = super::registry::json(&url).await?;
    Ok(value["version"].as_str().map(str::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_updates_use_supported_subcommands() {
        assert_eq!(
            command_text(AgentKind::Antigravity, true).as_deref(),
            Some("agy update")
        );
        assert_eq!(
            command_text(AgentKind::Opencode, true).as_deref(),
            Some("opencode upgrade")
        );
        assert_eq!(
            command_text(AgentKind::Kimi, true).as_deref(),
            Some("kimi upgrade --yes")
        );
        assert!(
            command_text(AgentKind::Antigravity, false)
                .unwrap()
                .contains("https://antigravity.google/cli/install.")
        );
    }
}
