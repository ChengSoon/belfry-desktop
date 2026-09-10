use crate::{harness::broker::BrokerError, project::resource_path};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 512 * 1024;

pub(super) fn read_text(root: &Path, relative: &str) -> Result<(PathBuf, String), BrokerError> {
    let path = resource_path::resolve_existing(root, relative).map_err(map_path)?;
    let metadata = path.metadata().map_err(map_io)?;
    if !metadata.is_file() {
        return Err(BrokerError::new(
            "INVALID_PARAMS",
            "patch target must be a file",
        ));
    }
    if metadata.len() > MAX_BYTES {
        return Err(BrokerError::new("TOO_LARGE", "patch target exceeds limit"));
    }
    let mut bytes = Vec::new();
    File::open(&path)
        .map_err(map_io)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(map_io)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(BrokerError::new("TOO_LARGE", "patch target exceeds limit"));
    }
    if bytes.contains(&0) {
        return Err(BrokerError::new(
            "INVALID_PARAMS",
            "patch target must be UTF-8 text",
        ));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| BrokerError::new("INVALID_PARAMS", "patch target must be UTF-8 text"))?;
    resource_path::revalidate(root, &path).map_err(map_path)?;
    Ok((path, text))
}

pub(super) fn atomic_replace(
    root: &Path,
    path: &Path,
    replacement: &str,
) -> Result<(), BrokerError> {
    resource_path::revalidate(root, path).map_err(map_path)?;
    let parent = path
        .parent()
        .ok_or_else(|| BrokerError::new("IO_ERROR", "patch target has no parent"))?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let temp = parent.join(format!(
        ".{name}.belfry-patch-{}.tmp",
        ulid::Ulid::generate()
    ));
    let result = write_and_replace(root, path, &temp, replacement);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn write_and_replace(
    root: &Path,
    path: &Path,
    temp: &Path,
    replacement: &str,
) -> Result<(), BrokerError> {
    let permissions = path.metadata().map_err(map_io)?.permissions();
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .map_err(map_io)?;
    file.write_all(replacement.as_bytes()).map_err(map_io)?;
    file.sync_all().map_err(map_io)?;
    fs::set_permissions(temp, permissions).map_err(map_io)?;
    resource_path::revalidate(root, path).map_err(map_path)?;
    fs::rename(temp, path).map_err(map_io)
}

fn map_io(error: std::io::Error) -> BrokerError {
    if error.kind() == std::io::ErrorKind::NotFound {
        BrokerError::new("NOT_FOUND", "patch target not found")
    } else {
        BrokerError::new("IO_ERROR", "patch file operation failed")
    }
}
fn map_path(error: resource_path::ResourcePathError) -> BrokerError {
    match error {
        resource_path::ResourcePathError::Invalid
        | resource_path::ResourcePathError::OutsideRoot => {
            BrokerError::new("PATH_OUTSIDE_ROOT", "patch path is outside project root")
        }
        resource_path::ResourcePathError::NotFound => {
            BrokerError::new("NOT_FOUND", "patch target not found")
        }
        resource_path::ResourcePathError::Io => {
            BrokerError::new("IO_ERROR", "patch file operation failed")
        }
    }
}
