use super::Check;
use crate::terminal::AppError;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    time::Duration,
};

pub(super) const MAX_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const MAX_RECORDS: usize = 200_000;

pub(super) fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn error(error: impl std::fmt::Display) -> AppError {
    AppError::io(error.to_string())
}

pub(super) fn confined(root: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let root = root.canonicalize().map_err(error)?;
    let path = path.canonicalize().map_err(error)?;
    if path == root || !path.starts_with(&root) {
        return Err(AppError::invalid_argument("会话文件超出原生数据目录"));
    }
    Ok(path)
}

pub(super) fn json(path: &Path) -> Result<Value, AppError> {
    let mut text = String::new();
    fs::File::open(path)
        .map_err(error)?
        .take(4 * 1024 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(error)?;
    if text.len() > 4 * 1024 * 1024 {
        return Err(AppError::io("会话元数据超过读取上限"));
    }
    serde_json::from_str(&text).map_err(error)
}

pub(super) fn lines(
    path: &Path,
    check: Check<'_>,
    mut consume: impl FnMut(usize, Value) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let file = fs::File::open(path).map_err(error)?;
    if file.metadata().map_err(error)?.len() > MAX_BYTES {
        return Err(AppError::io("原生会话超过 128 MiB，请在 CLI 中查看"));
    }
    let mut reader = crate::history::line_reader::LineReader::new(BufReader::new(file));
    let mut count = 0;
    while let Some(line) = reader.next(check)? {
        count += 1;
        if count > MAX_RECORDS {
            return Err(AppError::io("原生会话超过 20 万条记录，请在 CLI 中查看"));
        }
        if let Ok(value) = serde_json::from_slice(line) {
            consume(count, value)?;
        }
    }
    if reader.skipped > 0 {
        return Err(AppError::io("原生日志含超过 8 MiB 的记录，无法完整读取"));
    }
    Ok(())
}

/// Avoid symlink traversal and unbounded recursion through agent workspaces/artifacts.
pub(super) fn children(root: &Path, check: Check<'_>) -> Result<Vec<PathBuf>, AppError> {
    check()?;
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(error(e)),
    };
    let mut paths = Vec::new();
    for entry in entries {
        check()?;
        let entry = entry.map_err(error)?;
        if entry.file_type().map_err(error)?.is_dir() {
            paths.push(entry.path());
        }
        if paths.len() > 20_000 {
            return Err(AppError::io("原生会话目录超过扫描上限"));
        }
    }
    paths.sort();
    Ok(paths)
}

pub(super) fn sqlite(path: &Path) -> Result<Connection, AppError> {
    if let Ok(db) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        db.busy_timeout(Duration::from_secs(2)).map_err(error)?;
        if db
            .query_row("PRAGMA schema_version", [], |row| row.get::<_, i64>(0))
            .is_ok()
        {
            return Ok(db);
        }
    }
    // agy removes WAL/SHM on exit. A read-only connection cannot recreate them on
    // some platforms. Only use immutable mode for a checkpointed DB with no journal.
    for suffix in ["-wal", "-wal2", "-journal"] {
        if PathBuf::from(format!("{}{suffix}", path.display())).exists() {
            return Err(AppError::io("原生历史数据库正在更新，请稍后重试"));
        }
    }
    let url = reqwest::Url::from_file_path(path)
        .map_err(|_| AppError::invalid_argument("数据库路径无效"))?;
    Connection::open_with_flags(
        format!("{url}?mode=ro&immutable=1"),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(error)
}
