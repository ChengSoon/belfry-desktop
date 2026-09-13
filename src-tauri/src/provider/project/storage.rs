use super::contracts::ProjectProviderSelection;
use crate::{agent::AgentKind, terminal::AppError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, sync::Mutex};

const VERSION: u32 = 1;
const MAX_STORE_BYTES: u64 = 1024 * 1024;
static WRITER: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
pub(super) struct ProjectChoices {
    pub version: u32,
    pub projects: BTreeMap<String, BTreeMap<String, String>>,
}

impl Default for ProjectChoices {
    fn default() -> Self {
        Self {
            version: VERSION,
            projects: BTreeMap::new(),
        }
    }
}

impl ProjectChoices {
    pub fn provider(&self, root: &str, kind: AgentKind) -> Option<&str> {
        self.projects
            .get(root)?
            .get(super::super::store::storage_key(kind))
            .map(String::as_str)
    }
}

pub(super) fn read(path: &Path) -> Result<ProjectChoices, AppError> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProjectChoices::default());
        }
        Err(error) => return Err(AppError::io(format!("无法读取项目 Provider：{error}"))),
    };
    if metadata.len() > MAX_STORE_BYTES {
        return Err(AppError::io("项目 Provider 存档超过读取上限"));
    }
    let text = std::fs::read_to_string(path).map_err(|error| AppError::io(error.to_string()))?;
    let choices: ProjectChoices = serde_json::from_str(&text).map_err(|_| {
        AppError::invalid_argument("项目 Provider 存档已损坏，已停止操作以保留原文件")
    })?;
    if choices.version != VERSION {
        return Err(AppError::unsupported("项目 Provider 存档版本不支持"));
    }
    Ok(choices)
}

pub(super) fn save(path: &Path, selection: &ProjectProviderSelection) -> Result<(), AppError> {
    let _guard = WRITER
        .lock()
        .map_err(|_| AppError::io("项目 Provider 保存锁不可用"))?;
    let mut choices = read(path)?;
    let group = choices
        .projects
        .entry(selection.root_path.clone())
        .or_default();
    let key = super::super::store::storage_key(selection.kind);
    match &selection.provider_id {
        Some(id) => {
            group.insert(key.to_owned(), id.clone());
        }
        None => {
            group.remove(key);
        }
    }
    choices.projects.retain(|_, group| !group.is_empty());
    let text =
        serde_json::to_string_pretty(&choices).map_err(|error| AppError::io(error.to_string()))?;
    crate::atomic::write_atomic(path, &text, true)
}
