use super::contracts::ScanDiagnostics;
use std::{
    fs::{File, Metadata},
    io::{self, Read, Seek, SeekFrom},
    path::Path,
    time::SystemTime,
};

const GUARD_BYTES: u64 = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Stamp {
    pub len: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    identity: Option<(u64, u64)>,
    changed: Option<(i64, i64)>,
}

impl Stamp {
    pub fn open(path: &Path) -> io::Result<(File, Self)> {
        let file = File::open(path)?;
        let stamp = Self::read(&file)?;
        Ok((file, stamp))
    }

    pub fn read(file: &File) -> io::Result<Self> {
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Err(io::Error::other("用量日志不是普通文件"));
        }
        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified()?,
            created: metadata.created().ok(),
            identity: identity(file, &metadata)?,
            changed: changed(&metadata),
        })
    }

    pub fn can_append(&self, previous: &Self) -> bool {
        self.len > previous.len
            && self.identity == previous.identity
            && self.created == previous.created
    }

    pub fn preserves_snapshot(&self, previous: &Self) -> bool {
        self == previous || self.can_append(previous)
    }
}

#[derive(Clone, Default)]
pub(super) struct Guards {
    prefix: Vec<u8>,
    suffix: Vec<u8>,
    suffix_at: u64,
}

impl Guards {
    pub fn read(file: &mut File, len: u64, metrics: &mut ScanDiagnostics) -> io::Result<Self> {
        let suffix_at = len.saturating_sub(GUARD_BYTES);
        Ok(Self {
            prefix: read_range(file, (0, len.min(GUARD_BYTES)), metrics)?,
            suffix: read_range(file, (suffix_at, len - suffix_at), metrics)?,
            suffix_at,
        })
    }

    pub fn matches(&self, file: &mut File, metrics: &mut ScanDiagnostics) -> io::Result<bool> {
        Ok(
            read_range(file, (0, self.prefix.len() as u64), metrics)? == self.prefix
                && read_range(file, (self.suffix_at, self.suffix.len() as u64), metrics)?
                    == self.suffix,
        )
    }
}

fn read_range(
    file: &mut File,
    range: (u64, u64),
    metrics: &mut ScanDiagnostics,
) -> io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(range.0))?;
    let mut bytes = vec![0; range.1 as usize];
    file.read_exact(&mut bytes)?;
    metrics.validation_bytes += range.1;
    Ok(bytes)
}

#[cfg(unix)]
fn identity(_file: &File, metadata: &Metadata) -> io::Result<Option<(u64, u64)>> {
    use std::os::unix::fs::MetadataExt;
    Ok(Some((metadata.dev(), metadata.ino())))
}

#[cfg(unix)]
fn changed(metadata: &Metadata) -> Option<(i64, i64)> {
    use std::os::unix::fs::MetadataExt;
    Some((metadata.ctime(), metadata.ctime_nsec()))
}

#[cfg(windows)]
fn identity(file: &File, _metadata: &Metadata) -> io::Result<Option<(u64, u64)>> {
    super::windows_identity::read(file).map(Some)
}

#[cfg(not(any(unix, windows)))]
fn identity(_file: &File, _metadata: &Metadata) -> io::Result<Option<(u64, u64)>> {
    Ok(None)
}

#[cfg(not(unix))]
fn changed(_metadata: &Metadata) -> Option<(i64, i64)> {
    None
}
