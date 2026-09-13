use std::path::{Path, PathBuf};

use super::contracts::GitStatus;
use super::{command, status_parser};
use crate::resource::canonicalize;
use crate::terminal::AppError;

const ROOT_OUTPUT_LIMIT: usize = 16 * 1024;
const STATUS_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

pub(super) fn read(path: &str) -> Result<GitStatus, AppError> {
    let path = canonicalize(Path::new(path))
        .map_err(|error| AppError::io(format!("项目目录无法读取：{error}")))?;
    if !path.is_dir() {
        return Err(AppError::invalid_argument("项目路径必须是目录"));
    }
    let Some(root) = repository_root(&path)? else {
        return Ok(GitStatus {
            root_path: path.to_string_lossy().into_owned(),
            ..Default::default()
        });
    };
    let output = command::run(
        &root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--renames",
            "--untracked-files=all",
        ],
        STATUS_OUTPUT_LIMIT,
    )?;
    if !output.status.success() {
        return Err(AppError::io(format!(
            "Git 状态读取失败：{}",
            output.error.trim()
        )));
    }
    let mut report = GitStatus {
        repository: true,
        root_path: root.to_string_lossy().into_owned(),
        truncated: output.truncated,
        ..Default::default()
    };
    status_parser::parse(&output.bytes, &mut report)?;
    Ok(report)
}

fn repository_root(path: &Path) -> Result<Option<PathBuf>, AppError> {
    let output = command::run(path, &["rev-parse", "--show-toplevel"], ROOT_OUTPUT_LIMIT)?;
    if !output.status.success() {
        if output.error.contains("not a git repository")
            || output.error.contains("must be run in a work tree")
        {
            return Ok(None);
        }
        return Err(AppError::io(format!(
            "Git 仓库无法读取：{}",
            output.error.trim()
        )));
    }
    if output.truncated {
        return Err(AppError::io("Git 仓库路径超过读取限制"));
    }
    let text =
        std::str::from_utf8(&output.bytes).map_err(|_| AppError::io("仓库路径不是有效 UTF-8"))?;
    let root = canonicalize(Path::new(text.trim_end_matches(['\r', '\n'])))
        .map_err(|error| AppError::io(format!("Git 根目录无法读取：{error}")))?;
    Ok(Some(root))
}
