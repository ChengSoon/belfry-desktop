//! 轻量分支读取（code-review M3）：顶栏面包屑只要分支名，不该每 3 秒跑一次
//! `git status --untracked-files=all` 全量扫描工作区。这里只问 HEAD 指向哪里：
//! 有分支时一次 `symbolic-ref`；分离 HEAD 时再补一次 `rev-parse --short`。不碰索引、不扫文件。

use std::path::Path;

use super::command;
use super::contracts::GitBranch;
use crate::resource::canonicalize;
use crate::terminal::AppError;

const OUTPUT_LIMIT: usize = 4 * 1024;

pub(super) fn read(path: &str) -> Result<GitBranch, AppError> {
    let path = canonicalize(Path::new(path))
        .map_err(|error| AppError::io(format!("项目目录无法读取：{error}")))?;
    if !path.is_dir() {
        return Err(AppError::invalid_argument("项目路径必须是目录"));
    }
    let named = command::run(&path, &["symbolic-ref", "--short", "-q", "HEAD"], OUTPUT_LIMIT)?;
    if named.status.success() {
        return Ok(GitBranch { repository: true, branch: line(&named.bytes), detached: None });
    }
    // symbolic-ref -q：分离 HEAD 时静默退出 1；不是仓库时报 "not a git repository"。
    if not_repository(&named.error) {
        return Ok(GitBranch::default());
    }
    let commit = command::run(&path, &["rev-parse", "--short", "HEAD"], OUTPUT_LIMIT)?;
    if commit.status.success() {
        return Ok(GitBranch { repository: true, branch: None, detached: line(&commit.bytes) });
    }
    if not_repository(&commit.error) {
        return Ok(GitBranch::default());
    }
    // 仓库存在但还没有任何提交（unborn HEAD）：symbolic-ref 在这种情况下其实会成功，
    // 走到这里说明是其它读取失败，按「仓库但读不到」返回，前端不显示。
    Ok(GitBranch { repository: true, branch: None, detached: None })
}

fn line(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let value = text.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn not_repository(error: &str) -> bool {
    error.contains("not a git repository") || error.contains("must be run in a work tree")
}
