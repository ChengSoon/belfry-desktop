//! Agent CLI 的发布状态：当前版本、最新版本与一键安装/升级。
//!
//! 与 `agent/hooks/` 平级。版本比较在 `version.rs`，包名反查在 `package.rs`，
//! registry 查询在 `registry.rs`，安装执行在 `install.rs`。

pub(crate) mod commands;
mod contracts;
mod install;
mod package;
mod registry;
mod version;

use std::path::Path;

use crate::agent::contracts::AgentDescriptor;
use crate::agent::detection::find_agent;
use crate::agent::AgentKind;

pub(crate) use contracts::{AgentRelease, AgentReleaseInstall, ReleaseState};

/// 同步探测的一半：可执行文件、当前版本、真实包名。不碰网络，可在阻塞池里跑。
struct LocalRelease {
    kind: AgentKind,
    display_name: String,
    command: String,
    executable: Option<String>,
    current_version: Option<String>,
    package: Option<String>,
    notice: Option<String>,
}

fn local(kind: AgentKind) -> LocalRelease {
    let descriptor = AgentDescriptor::for_kind(kind);
    let Some(executable) = find_agent(kind) else {
        // 没装：包名给官方默认值，好让前端的「安装」按钮能拼出命令。
        return LocalRelease {
            kind,
            display_name: descriptor.display_name,
            command: descriptor.command,
            executable: None,
            current_version: None,
            package: Some(package::default_package(kind).to_string()),
            notice: Some(format!("未在用户命令环境中找到 {}", kind.command_name())),
        };
    };
    let path = executable.to_string_lossy().to_string();
    match package::detect(&executable) {
        Some(resolved) => LocalRelease {
            kind,
            display_name: descriptor.display_name,
            command: descriptor.command,
            executable: Some(path),
            // 优先用 package.json 的干净版本号；拿不到再回退到 `--version` 的原始首行。
            current_version: resolved.version.or_else(|| fallback_version(&executable)),
            package: Some(resolved.package),
            notice: None,
        },
        None => LocalRelease {
            kind,
            display_name: descriptor.display_name,
            command: descriptor.command,
            executable: Some(path),
            current_version: None,
            package: None,
            notice: Some("已安装，但不是 npm 全局包，无法一键升级".to_string()),
        },
    }
}

fn fallback_version(executable: &Path) -> Option<String> {
    crate::setup::process::run(executable, &["--version"])
        .ok()
        .and_then(|output| crate::setup::process::first_output_line(&output))
}

fn local_all() -> Vec<LocalRelease> {
    AgentKind::ALL.into_iter().map(local).collect()
}

/// 组装三个 CLI 的发布状态。本地探测走阻塞池，registry 查询并发且逐包降级
/// —— 一个包查挂了不能让整页报错。
pub(crate) async fn report() -> Vec<AgentRelease> {
    let locals: Vec<LocalRelease> = match tauri::async_runtime::spawn_blocking(local_all).await {
        Ok(value) => value,
        Err(error) => {
            return AgentKind::ALL
                .into_iter()
                .map(|kind| AgentRelease {
                    kind,
                    display_name: kind.display_name().to_string(),
                    command: kind.command_name().to_string(),
                    executable: None,
                    current_version: None,
                    latest_version: None,
                    package: Some(package::default_package(kind).to_string()),
                    state: ReleaseState::Unknown,
                    notice: Some(format!("agent release detection failed: {error}")),
                    install_command: None,
                })
                .collect();
        }
    };
    let mut releases = Vec::with_capacity(locals.len());
    for item in locals {
        releases.push(latest(item).await);
    }
    releases
}

/// 重新反查某个 CLI 的包名，供安装命令使用。
///
/// 已安装但不是 npm 包时拒绝：一键升级对 Homebrew / scoop 装的二进制不适用。
pub(crate) fn package_for(kind: AgentKind) -> Result<String, crate::terminal::AppError> {
    match find_agent(kind) {
        Some(executable) => match package::detect(&executable) {
            Some(resolved) => Ok(resolved.package),
            None => Err(crate::terminal::AppError::unsupported(
                "该 CLI 不是 npm 全局包，无法一键升级，请在终端中手动更新",
            )),
        },
        None => Ok(package::default_package(kind).to_string()),
    }
}

async fn latest(item: LocalRelease) -> AgentRelease {
    // 没装：直接 Missing，不必查 registry。
    if item.executable.is_none() {
        let install_command = item
            .package
            .as_ref()
            .map(|package| format!("npm install -g {package}@latest"));
        return AgentRelease {
            kind: item.kind,
            display_name: item.display_name,
            command: item.command,
            executable: None,
            current_version: None,
            latest_version: None,
            package: item.package,
            state: ReleaseState::Missing,
            notice: item.notice,
            install_command,
        };
    }
    // 装了但不是 npm 包：置灰，同样不必查 registry。
    let Some(package) = item.package.clone() else {
        return AgentRelease {
            kind: item.kind,
            display_name: item.display_name,
            command: item.command,
            executable: item.executable,
            current_version: None,
            latest_version: None,
            package: None,
            state: ReleaseState::Unmanaged,
            notice: item.notice,
            install_command: None,
        };
    };
    let install_command = Some(format!("npm install -g {package}@latest"));
    match registry::latest(&package).await {
        Ok(Some(latest_version)) => {
            let (state, notice) = match item
                .current_version
                .as_deref()
                .and_then(|current| version::is_upgradable(current, &latest_version))
            {
                Some(true) => (ReleaseState::Upgradable, None),
                Some(false) => (ReleaseState::Ready, None),
                None => (
                    ReleaseState::Unknown,
                    Some("无法确定当前版本与最新版本的关系".to_string()),
                ),
            };
            // 装的是第三方镜像时，官方包可能已经跑到前面：镜像不跟进，卡片上就
            // 永远看不到新版本（本机 @cometix/claude-code 停在 2.1.263 而官方已
            // 2.1.274，就是这么漏报的）。查一遍官方包，落后了在 notice 里说清楚——
            // 但升级动作仍只针对用户装的那个包，不偷偷换成官方包。
            let notice = match notice {
                Some(_) => notice,
                None => mirror_lag_notice(item.kind, &package, &latest_version).await,
            };
            AgentRelease {
                kind: item.kind,
                display_name: item.display_name,
                command: item.command,
                executable: item.executable,
                current_version: item.current_version,
                latest_version: Some(latest_version),
                package: Some(package),
                state,
                notice,
                install_command,
            }
        }
        Ok(None) => unknown(item, "npm registry 上找不到该包"),
        Err(message) => unknown(item, &message),
    }
}

/// 装的是第三方镜像、且官方包已经更前时给出提示。
///
/// 镜像包（`@cometix/claude-code` 这类）通常滞后于官方包，版本检查只盯着镜像，
/// 用户就会对着「已是最新」疑惑官方明明有新版。返回 `None`：装的就是官方包、
/// 官方没更前，或查询失败（失败不阻断主流程，只是不提示）。
async fn mirror_lag_notice(kind: AgentKind, package: &str, mirror_latest: &str) -> Option<String> {
    let official = package::default_package(kind);
    if official == package {
        return None;
    }
    // 镜像查询已经成功过一次，官方这条失败属于另一条独立链路，不连累主结论。
    let official_latest = registry::latest(official).await.ok()??;
    lag_notice_text(official, package, mirror_latest, &official_latest)
}

/// 纯文本组装，抽出来好测：不碰网络。
fn lag_notice_text(official: &str, package: &str, mirror_latest: &str, official_latest: &str) -> Option<String> {
    if official == package {
        return None;
    }
    // 镜像比官方还新（回滚/切到 next 之类）就不必提示。
    if version::is_upgradable(mirror_latest, official_latest) != Some(true) {
        return None;
    }
    Some(format!(
        "官方包 {official} 已发布 {official_latest}；本机装的是第三方镜像 {package}（最新 {mirror_latest}），一键升级只能拿到镜像的版本。要换用官方包：npm install -g {official}@latest"
    ))
}

fn unknown(item: LocalRelease, message: &str) -> AgentRelease {
    AgentRelease {
        kind: item.kind,
        display_name: item.display_name,
        command: item.command,
        executable: item.executable,
        current_version: item.current_version,
        latest_version: None,
        package: item.package,
        state: ReleaseState::Unknown,
        notice: Some(message.to_string()),
        install_command: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_package_points_at_official_names() {
        // 仅用于「未安装 → 安装」；已安装时包名一律从可执行文件反查，不用它。
        assert_eq!(package::default_package(AgentKind::Codex), "@openai/codex");
        assert_eq!(package::default_package(AgentKind::Claude), "@anthropic-ai/claude-code");
        assert_eq!(package::default_package(AgentKind::Pi), "@earendil-works/pi-coding-agent");
    }

    #[test]
    fn lag_notice_reports_when_mirror_trails_official() {
        let notice = lag_notice_text(
            "@anthropic-ai/claude-code",
            "@cometix/claude-code",
            "2.1.263",
            "2.1.274",
        );
        assert!(
            notice.as_ref().is_some_and(|text| text.contains("2.1.274")
                && text.contains("@cometix/claude-code")
                && text.contains("npm install -g @anthropic-ai/claude-code@latest")),
            "镜像落后于官方时要报出官方版本号：{notice:?}"
        );
    }

    #[test]
    fn lag_notice_stays_quiet_when_nothing_to_report() {
        // 镜像与官方同步：不报。
        assert!(lag_notice_text("@anthropic-ai/claude-code", "@cometix/claude-code", "2.1.274", "2.1.274").is_none());
        // 装的就是官方包：不报。
        assert!(lag_notice_text("@anthropic-ai/claude-code", "@anthropic-ai/claude-code", "2.1.100", "2.1.999").is_none());
        // 镜像比官方还新：不报。
        assert!(lag_notice_text("@anthropic-ai/claude-code", "@cometix/claude-code", "2.2.0", "2.1.274").is_none());
        // 版本号解不出来：不报。
        assert!(lag_notice_text("@anthropic-ai/claude-code", "@cometix/claude-code", "custom-build", "2.1.274").is_none());
    }

    #[test]
    fn state_truth_table_prefers_unknown_over_false_upgradable() {
        // 解不出版本时必须判 Unknown，不能误报可升级。
        assert_eq!(version::is_upgradable("custom-build", "1.2.3"), None);
        assert_eq!(version::is_upgradable("1.2.3", "1.2.3"), Some(false));
        assert_eq!(version::is_upgradable("1.2.2", "1.2.3"), Some(true));
    }
}
