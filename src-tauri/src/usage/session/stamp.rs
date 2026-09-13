use crate::terminal::AppError;
use std::{
    fs::{File, Metadata},
    io::Read,
    path::Path,
    time::SystemTime,
};

pub(super) struct Stamp {
    pub len: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    identity: Option<(u64, u64)>,
    prefix: Vec<u8>,
}

impl Stamp {
    pub fn read(path: &Path) -> Result<Self, AppError> {
        const PREFIX_BYTES: u64 = 256;
        let mut file = File::open(path).map_err(io_error)?;
        let metadata = file.metadata().map_err(io_error)?;
        if !metadata.is_file() {
            return Err(AppError::invalid_argument("会话日志不是普通文件"));
        }
        let mut prefix = Vec::new();
        file.by_ref()
            .take(PREFIX_BYTES)
            .read_to_end(&mut prefix)
            .map_err(io_error)?;
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
            created: metadata.created().ok(),
            identity: identity(&metadata),
            prefix,
        })
    }

    pub fn changed_from(&self, previous: &Self) -> bool {
        self.identity != previous.identity
            || self.created != previous.created
            || self.len < previous.len
            || !self.prefix.starts_with(&previous.prefix)
            || (self.len == previous.len && self.modified != previous.modified)
    }
}

#[cfg(unix)]
fn identity(metadata: &Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    Some((metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn identity(_metadata: &Metadata) -> Option<(u64, u64)> {
    None
}

pub(super) fn io_error(error: std::io::Error) -> AppError {
    AppError::io(error.to_string())
}
