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
    pub disabled: bool,
    pub note: String,
    pub error: Option<String>,
}

impl AgentHookReport {
    pub fn enabled(&self) -> bool {
        self.supported && !self.disabled && self.error.is_none() && self.installed >= self.expected
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
        disabled: false,
        note: String::new(),
        error: None,
    };
    match inspect_config(kind) {
        Ok((path, count, disabled)) => {
            report.config_path = Some(path);
            report.installed = count;
            report.disabled = disabled;
        }
        Err(error) => report.error = Some(error.message),
    }
    report.note = status_note(&report).into();
    report
}

fn inspect_config(kind: AgentKind) -> Result<(String, usize, bool), AppError> {
    let path = config_path(kind)?;
    let value = config::parse(&read_config(&path)?)?;
    let disabled = if kind == AgentKind::Claude {
        value["disableAllHooks"] == true
    } else {
        codex_disabled(&path)
    };
    Ok((
        path.to_string_lossy().into(),
        config::owned_count(&value, kind),
        disabled,
    ))
}

fn codex_disabled(path: &Path) -> bool {
    path.parent()
        .and_then(|directory| read_config(&directory.join("config.toml")).ok())
        .and_then(|text| text.parse::<toml_edit::DocumentMut>().ok())
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
    if report.kind == AgentKind::Codex {
        "已安装；重开会话后，在 Codex /hooks 中审阅并信任这些命令"
    } else {
        "已安装；重开会话后接收 Hook，未连接前仍显示屏幕推断"
    }
}
