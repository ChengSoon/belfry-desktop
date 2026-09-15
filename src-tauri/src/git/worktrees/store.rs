use std::{fs::{self, File, OpenOptions}, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use crate::{atomic::write_atomic, terminal::AppError};
use super::contracts::ManagedWorktree;

const MAX_REGISTRY_BYTES: u64 = 1024 * 1024;
const MAX_TASKS: usize = 200;
#[derive(Serialize, Deserialize)]
struct Registry { version: u8, entries: Vec<ManagedWorktree> }

pub fn load(dir: &Path) -> Result<Vec<ManagedWorktree>, AppError> {
    let path = dir.join("worktrees.json");
    if !path.exists() { return Ok(vec![]); }
    if fs::metadata(&path).map_err(io)?.len() > MAX_REGISTRY_BYTES { return Err(AppError::io("Worktree 存档超过上限")); }
    let registry: Registry = serde_json::from_str(&fs::read_to_string(path).map_err(io)?)
        .map_err(|_| AppError::io("Worktree 存档损坏，已保留原文"))?;
    if registry.version != 1 || registry.entries.len() > MAX_TASKS { return Err(AppError::io("Worktree 存档版本或数量不支持")); }
    for entry in &registry.entries { validate_entry(dir, entry)?; }
    Ok(registry.entries)
}

pub fn save(dir: &Path, entries: Vec<ManagedWorktree>) -> Result<(), AppError> {
    if entries.len() > MAX_TASKS { return Err(AppError::invalid_argument("最多保存 200 个 Worktree 任务")); }
    let raw = serde_json::to_string(&Registry { version: 1, entries }).map_err(io)?;
    write_atomic(&dir.join("worktrees.json"), &raw, true)?;
    if fs::read_to_string(dir.join("worktrees.json")).map_err(io)? != raw { return Err(AppError::io("Worktree 保存回读不一致")); }
    Ok(())
}

fn validate_entry(dir: &Path, entry: &ManagedWorktree) -> Result<(), AppError> {
    if entry.id.is_empty() || !entry.id.bytes().all(|value| value.is_ascii_alphanumeric())
        || PathBuf::from(&entry.root_path) != dir.join("trees").join(&entry.id) {
        return Err(AppError::invalid_argument("Worktree 所有权记录无效"));
    }
    Ok(())
}
fn io(error: impl std::fmt::Display) -> AppError { AppError::io(error.to_string()) }

pub struct RegistryLock { _file: File }
impl RegistryLock {
    pub fn acquire(dir: &Path) -> Result<Self, AppError> {
        fs::create_dir_all(dir).map_err(io)?;
        let mut options = OpenOptions::new(); options.read(true).write(true).create(true);
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let file = options.open(dir.join("worktrees.lock")).map_err(|_| AppError::io("其他窗口正在操作 Worktree，请稍后重试"))?;
        #[cfg(unix)] {
            use std::os::fd::AsRawFd;
            unsafe extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
            const LOCK_EX_NB: i32 = 2 | 4;
            if unsafe { flock(file.as_raw_fd(), LOCK_EX_NB) } != 0 { return Err(AppError::io("其他窗口正在操作 Worktree，请稍后重试")); }
        }
        Ok(Self { _file: file })
    }
}
