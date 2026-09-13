use crate::terminal::AppError;
use std::{
    fs::{self, File, Metadata},
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Clone, Debug, PartialEq)]
struct Stamp {
    len: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    identity: Option<(u64, u64, i64, i64)>,
}

#[derive(Clone, Debug)]
pub(super) struct Snapshot {
    pub path: PathBuf,
    stamp: Stamp,
}

impl Snapshot {
    pub fn capture(root: &Path, path: &Path) -> Result<Self, AppError> {
        let metadata = fs::symlink_metadata(path).map_err(io_error)?;
        let resolved = fs::canonicalize(path).map_err(io_error)?;
        if !metadata.is_file() || !resolved.starts_with(root) {
            return Err(AppError::invalid_argument(
                "详情只能读取 CLI 日志目录内的普通文件",
            ));
        }
        Ok(Self {
            path: resolved,
            stamp: Stamp::from(&metadata),
        })
    }

    pub fn len(&self) -> u64 {
        self.stamp.len
    }

    pub fn open(&self) -> Result<File, AppError> {
        if fs::canonicalize(&self.path).map_err(io_error)? != self.path {
            return Err(changed());
        }
        let file = File::open(&self.path).map_err(io_error)?;
        let metadata = file.metadata().map_err(io_error)?;
        if !metadata.is_file() || Stamp::from(&metadata) != self.stamp {
            return Err(changed());
        }
        Ok(file)
    }
}

impl From<&Metadata> for Stamp {
    fn from(metadata: &Metadata) -> Self {
        Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            created: metadata.created().ok(),
            identity: identity(metadata),
        }
    }
}

#[cfg(unix)]
fn identity(metadata: &Metadata) -> Option<(u64, u64, i64, i64)> {
    use std::os::unix::fs::MetadataExt;
    Some((
        metadata.dev(),
        metadata.ino(),
        metadata.ctime(),
        metadata.ctime_nsec(),
    ))
}

#[cfg(not(unix))]
fn identity(_metadata: &Metadata) -> Option<(u64, u64, i64, i64)> {
    None
}

fn changed() -> AppError {
    AppError::io("会话日志已变化，请刷新详情后重试")
}
pub(super) fn io_error(error: std::io::Error) -> AppError {
    AppError::io(error.to_string())
}
