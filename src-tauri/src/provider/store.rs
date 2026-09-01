//! Belfry 自己的 provider 库：`<app_data_dir>/providers.json`。
//!
//! 文件里有明文 API key，所以新建时按 0600 落盘（见 `atomic`）。

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::agent::AgentKind;
use crate::terminal::AppError;

use crate::atomic::write_atomic;
use super::contracts::AgentProviders;

const FILE: &str = "providers.json";
const VERSION: u32 = 1;

/// 存储用的键。刻意和 `command_name()` 分开：可执行文件名是可能变的
/// （比如某个 agent 改了 bin 名），而库里的键一变，用户的配置就失联了。
pub(super) fn storage_key(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Codex => "codex",
        AgentKind::Claude => "claude",
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoreFile {
    pub version: u32,
    #[serde(default)]
    pub agents: BTreeMap<String, AgentProviders>,
    /// 切到三方 provider 之前存下的 `~/.codex/auth.json` 原文。
    /// 里面是 ChatGPT 的 OAuth 令牌，切回官方时原样放回去。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_official_auth: Option<Value>,
}

impl Default for StoreFile {
    fn default() -> Self {
        Self {
            version: VERSION,
            agents: BTreeMap::new(),
            codex_official_auth: None,
        }
    }
}

impl StoreFile {
    pub fn agent(&self, kind: AgentKind) -> AgentProviders {
        self.agents
            .get(storage_key(kind))
            .cloned()
            .unwrap_or_default()
    }

    pub fn agent_mut(&mut self, kind: AgentKind) -> &mut AgentProviders {
        self.agents
            .entry(storage_key(kind).to_string())
            .or_default()
    }
}

fn path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::io(format!("找不到应用数据目录：{err}")))?;
    Ok(base.join(FILE))
}

pub(super) fn load(app: &AppHandle) -> Result<StoreFile, AppError> {
    let path = path(app)?;
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(StoreFile::default()),
        Err(err) => return Err(AppError::io(format!("读不了 {}：{err}", path.display()))),
    };
    if text.trim().is_empty() {
        return Ok(StoreFile::default());
    }
    // 坏文件不能当空文件处理：回落成默认值的话，下一次保存就把用户所有
    // provider 连同 API key 一起覆盖没了。宁可报错让人去看一眼。
    serde_json::from_str(&text).map_err(|err| {
        AppError::invalid_argument(format!(
            "{} 解析失败，为避免覆盖已有配置已停止操作：{err}",
            path.display()
        ))
    })
}

pub(super) fn save(app: &AppHandle, store: &StoreFile) -> Result<(), AppError> {
    let path = path(app)?;
    let mut text = serde_json::to_string_pretty(store)
        .map_err(|err| AppError::io(format!("序列化 providers.json 失败：{err}")))?;
    text.push('\n');
    write_atomic(&path, &text, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_keys_are_independent_of_the_binary_name() {
        // 库里的键一变，用户已存的 provider 就全失联了，所以它不跟着 command_name 走。
        assert_eq!(storage_key(AgentKind::Codex), "codex");
        assert_eq!(storage_key(AgentKind::Claude), "claude");
    }

    #[test]
    fn a_fresh_store_is_versioned() {
        assert_eq!(StoreFile::default().version, VERSION);
    }

    #[test]
    fn round_trips_through_json() {
        let mut store = StoreFile::default();
        store.agent_mut(AgentKind::Claude).current_id = Some("p1".into());
        let text = serde_json::to_string(&store).unwrap();
        let back: StoreFile = serde_json::from_str(&text).unwrap();
        assert_eq!(
            back.agent(AgentKind::Claude).current_id.as_deref(),
            Some("p1")
        );
        assert!(back.codex_official_auth.is_none());
    }

    #[test]
    fn unknown_agents_in_the_file_survive_a_round_trip() {
        // 老版本写下的键不该在新版本手里丢掉——用户可能又切回去。
        let text = r#"{"version":1,"agents":{"future":{"providers":[],"currentId":"x"}}}"#;
        let store: StoreFile = serde_json::from_str(text).unwrap();
        let back = serde_json::to_string(&store).unwrap();
        assert!(back.contains("future"));
    }
}
