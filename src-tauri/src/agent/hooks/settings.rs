use super::{config, features, install::read_config};
use crate::{
    agent::{AgentKind, detection::detect_agent},
    terminal::AppError,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentHookReport {
    pub kind: AgentKind,
    pub version: Option<String>,
    pub supported: bool,
    pub config_path: Option<String>,
    pub installed: usize,
    pub expected: usize,
    pub stale: usize,
    pub disabled: bool,
    pub note: String,
    pub error: Option<String>,
}

impl AgentHookReport {
    pub fn enabled(&self) -> bool {
        self.supported
            && !self.disabled
            && self.error.is_none()
            && self.stale == 0
            && self.installed >= self.expected
    }
}

pub(super) fn config_path(kind: AgentKind) -> Result<PathBuf, AppError> {
    let (variable, directory, file) = match kind {
        AgentKind::Codex => ("CODEX_HOME", ".codex", "hooks.json"),
        AgentKind::Claude => ("CLAUDE_CONFIG_DIR", ".claude", "settings.json"),
    };
    let base = std::env::var_os(variable)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| crate::usage::home_dir().map(|home| home.join(directory)))
        .ok_or_else(|| AppError::not_found("找不到 CLI 配置目录"))?;
    Ok(base.join(file))
}

pub(super) fn report(kind: AgentKind) -> AgentHookReport {
    let availability = detect_agent(kind);
    let supported = features::supported(kind, availability.version.as_deref());
    let mut report = AgentHookReport {
        kind,
        version: availability.version,
        supported,
        config_path: None,
        installed: 0,
        expected: config::events(kind).len(),
        stale: 0,
        disabled: false,
        note: String::new(),
        error: None,
    };
    if let Err(error) = inspect_config(kind, &mut report) {
        report.error = Some(error.message);
    }
    report.note = status_note(&report).into();
    report
}

fn inspect_config(kind: AgentKind, report: &mut AgentHookReport) -> Result<(), AppError> {
    let path = config_path(kind)?;
    let value = config::parse(&read_config(&path)?)?;
    report.config_path = Some(path.to_string_lossy().into());
    report.installed = config::owned_count(&value, kind);
    report.stale = config::stale_count(&value, kind);
    report.disabled = if kind == AgentKind::Claude {
        value["disableAllHooks"] == true
    } else {
        codex_disabled(&path)
    };
    Ok(())
}

fn codex_disabled(path: &Path) -> bool {
    path.parent()
        .and_then(|directory| read_config(&directory.join("config.toml")).ok())
        .is_some_and(|text| codex_hooks_disabled(&text))
}

// hooks 在 Codex 是 stable 特性、默认开启，键缺失不等于关闭；`codex features list` 可核对。
fn codex_hooks_disabled(text: &str) -> bool {
    text.parse::<toml_edit::DocumentMut>()
        .ok()
        .and_then(|doc| {
            doc.get("features")
                .and_then(|features| {
                    features
                        .get("hooks")
                        .or_else(|| features.get("codex_hooks"))
                })
                .and_then(toml_edit::Item::as_bool)
        })
        .is_some_and(|enabled| !enabled)
}

fn status_note(report: &AgentHookReport) -> &'static str {
    if report.error.is_some() {
        return "配置不可读取，保持屏幕推断，原文件未改动";
    }
    if !report.supported {
        return "CLI 未安装或版本尚未验证 Hook 接口，保持屏幕推断";
    }
    if report.disabled {
        return "CLI 全局设置已关闭 Hook；本页保留该设置，启用 CLI Hook 后再重开会话";
    }
    if report.installed == 0 {
        return "尚未启用 Hook，当前使用屏幕推断";
    }
    if report.installed < report.expected {
        return "Hook 安装不完整，可重新预览并启用";
    }
    if report.stale > 0 {
        return "Hook 指向的应用已不存在，可能移动过应用或清理过构建；请重新预览并启用";
    }
    if report.kind == AgentKind::Codex {
        "已安装；重开会话后，在 Codex /hooks 中审阅并信任这些命令"
    } else {
        "已安装；重开会话后接收 Hook，未连接前仍显示屏幕推断"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_hooks_stay_on_unless_the_config_turns_them_off() {
        assert!(codex_hooks_disabled("[features]\nhooks = false\n"));
        for text in [
            "",
            "[features]\njs_repl = false\n",
            "[features]\nhooks = true\n",
            "[features]\nhooks = \"false\"\n",
            "not = valid = toml",
        ] {
            assert!(!codex_hooks_disabled(text), "{text:?}");
        }
    }

    #[test]
    fn a_report_that_points_at_a_removed_build_does_not_advertise_hooks() {
        let mut report = AgentHookReport {
            kind: AgentKind::Claude,
            version: None,
            supported: true,
            config_path: None,
            installed: 3,
            expected: 3,
            stale: 0,
            disabled: false,
            note: String::new(),
            error: None,
        };
        assert!(report.enabled());
        report.stale = 1;
        assert!(!report.enabled());
        assert_eq!(
            "Hook 指向的应用已不存在，可能移动过应用或清理过构建；请重新预览并启用",
            status_note(&report)
        );
    }
}
