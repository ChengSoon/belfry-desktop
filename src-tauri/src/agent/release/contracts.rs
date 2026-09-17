use serde::{Deserialize, Serialize};

use crate::agent::AgentKind;

/// 一个 Agent CLI 的发布状态。
///
/// `Unmanaged` 与 `Unknown` 是两回事：前者是「装了，但不归 npm 管」（Homebrew 原生
/// 二进制、scoop shim 之类），一键升级根本不适用；后者是「该问的都问了，但版本号
/// 对不上号」——registry 查询失败，或者版本串解析不出三元组。两种都不该假装能升级。
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseState {
    Ready,
    Upgradable,
    Missing,
    Unmanaged,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRelease {
    pub kind: AgentKind,
    pub display_name: String,
    pub command: String,
    pub executable: Option<String>,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    /// 从可执行文件反查出的**真实**包名。用户装的可能是第三方镜像包
    /// （见 `package::package_name` 的注释），所以这里绝不能按 kind 硬编码。
    /// 只有「未安装」时才退回 `package::default_package`。
    pub package: Option<String>,
    pub state: ReleaseState,
    pub notice: Option<String>,
    /// 给「在终端中重试」和复制按钮用；非 npm 管理时为 None。
    pub install_command: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReleaseInstall {
    pub kind: AgentKind,
    pub package: String,
    /// npm 自己以非零码退出算 `false`，不算命令失败——前端要能把 `log` 摊开给用户看。
    pub success: bool,
    /// 安装后重新探测到的版本，成功时用来即时刷新卡片。
    pub version: Option<String>,
    pub log: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_serializes_with_frontend_field_names() {
        let value = serde_json::to_value(AgentRelease {
            kind: AgentKind::Claude,
            display_name: "Claude Code".into(),
            command: "claude".into(),
            executable: None,
            current_version: Some("2.1.201".into()),
            latest_version: Some("2.1.263".into()),
            package: Some("@cometix/claude-code".into()),
            state: ReleaseState::Upgradable,
            notice: None,
            install_command: Some("npm install -g @cometix/claude-code@latest".into()),
        })
        .unwrap();
        assert_eq!(value["displayName"], "Claude Code");
        assert_eq!(value["currentVersion"], "2.1.201");
        assert_eq!(value["installCommand"], "npm install -g @cometix/claude-code@latest");
        assert_eq!(value["state"], "upgradable");
        assert!(value["executable"].is_null());
    }
}
