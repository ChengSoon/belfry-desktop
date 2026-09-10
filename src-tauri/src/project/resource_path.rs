use crate::resource::canonicalize;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ResourcePathError {
    Invalid,
    OutsideRoot,
    NotFound,
    Io,
}

pub(crate) fn canonical_root(root: &Path) -> Result<PathBuf, ResourcePathError> {
    let root = canonicalize(root).map_err(map_io)?;
    if root.is_dir() {
        Ok(root)
    } else {
        Err(ResourcePathError::Invalid)
    }
}

pub(crate) fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, ResourcePathError> {
    let relative = validate_relative(relative)?;
    let resolved = canonicalize(&root.join(relative)).map_err(map_io)?;
    if resolved.starts_with(root) {
        Ok(resolved)
    } else {
        Err(ResourcePathError::OutsideRoot)
    }
}

pub(crate) fn revalidate(root: &Path, path: &Path) -> Result<(), ResourcePathError> {
    let resolved = canonicalize(path).map_err(map_io)?;
    if resolved.starts_with(root) {
        Ok(())
    } else {
        Err(ResourcePathError::OutsideRoot)
    }
}

fn validate_relative(value: &str) -> Result<PathBuf, ResourcePathError> {
    if value.contains('\0') || has_windows_prefix(value) {
        return Err(ResourcePathError::Invalid);
    }
    let path = Path::new(value.trim());
    if path.is_absolute() || path.components().any(invalid_component) {
        return Err(ResourcePathError::Invalid);
    }
    Ok(path.to_path_buf())
}

fn invalid_component(component: Component<'_>) -> bool {
    matches!(
        component,
        Component::ParentDir | Component::RootDir | Component::Prefix(_)
    )
}

fn has_windows_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with("\\\\")
        || value.starts_with("//")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'/' | b'\\'))
}

fn map_io(error: std::io::Error) -> ResourcePathError {
    if error.kind() == std::io::ErrorKind::NotFound {
        ResourcePathError::NotFound
    } else {
        ResourcePathError::Io
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_portable_escape_shapes() {
        let root = std::env::temp_dir();
        for value in ["../x", "/tmp/x", "C:\\temp\\x", "\\\\server\\x", "bad\0x"] {
            assert_eq!(
                resolve_existing(&root, value),
                Err(ResourcePathError::Invalid)
            );
        }
    }
}
