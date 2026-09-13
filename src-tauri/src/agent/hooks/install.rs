use super::config;
use crate::{agent::AgentKind, terminal::AppError};
use serde::Serialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

pub(super) struct InstallSpec {
    pub path: PathBuf,
    pub kind: AgentKind,
    pub command: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallPreview {
    pub id: String,
    pub kind: AgentKind,
    pub config_path: String,
    pub enabling: bool,
    pub command: Option<String>,
    pub events: Vec<String>,
    pub managed_before: usize,
}

#[derive(Default)]
pub(super) struct Installer {
    pending: Mutex<Option<Pending>>,
}

struct Pending {
    id: String,
    path: PathBuf,
    before: String,
    after: String,
    created: Instant,
}
const PREVIEW_LIFETIME: Duration = Duration::from_secs(180);
const MAX_CONFIG_BYTES: u64 = 2 * 1024 * 1024;

impl Installer {
    pub fn preview(&self, spec: InstallSpec) -> Result<InstallPreview, AppError> {
        let before = read_config(&spec.path)?;
        let after = config::merge(&before, spec.kind, spec.command.as_deref())?;
        let managed_before = config::owned_count(&config::parse(&before)?, spec.kind);
        let id = ulid::Ulid::generate().to_string();
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::io("Hook 预览状态不可用"))?;
        *pending = Some(Pending {
            id: id.clone(),
            path: spec.path.clone(),
            before,
            after,
            created: Instant::now(),
        });
        Ok(InstallPreview {
            id,
            kind: spec.kind,
            config_path: spec.path.to_string_lossy().into(),
            enabling: spec.command.is_some(),
            command: spec.command,
            events: config::events(spec.kind)
                .into_iter()
                .map(str::to_owned)
                .collect(),
            managed_before,
        })
    }

    pub fn apply(&self, id: &str) -> Result<(), AppError> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::io("Hook 预览状态不可用"))?;
        let valid = pending.as_ref().is_some_and(|preview| {
            preview.id == id && preview.created.elapsed() <= PREVIEW_LIFETIME
        });
        if !valid {
            return Err(AppError::invalid_argument("预览已失效，请重新预览"));
        }
        let preview = pending.take().unwrap();
        if read_config(&preview.path)? != preview.before {
            return Err(AppError::invalid_argument(
                "配置已在预览后变化，已保留新内容，请重新预览",
            ));
        }
        if preview.before != preview.after {
            crate::atomic::write_atomic(&preview.path, &preview.after, true)?;
        }
        Ok(())
    }

    pub fn cancel(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            if pending.as_ref().is_some_and(|preview| preview.id == id) {
                *pending = None;
            }
        }
    }
}

pub(super) fn read_config(path: &Path) -> Result<String, AppError> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(AppError::io(error.to_string())),
    };
    let mut bytes = Vec::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| AppError::io(error.to_string()))?;
    if bytes.len() > MAX_CONFIG_BYTES as usize {
        return Err(AppError::invalid_argument(
            "Hook 配置文件过大，未读取或修改",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| AppError::invalid_argument("Hook 配置不是有效 UTF-8，已保留原文件"))
}
