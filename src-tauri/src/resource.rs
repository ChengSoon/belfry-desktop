use std::path::{Path, PathBuf};

use crate::terminal::AppError;

pub(crate) fn file_uri_to_path(uri: &str) -> Result<PathBuf, AppError> {
    let raw = uri
        .strip_prefix("file://")
        .ok_or_else(|| AppError::invalid_argument("resource must be a file URI"))?;
    #[cfg(target_os = "windows")]
    let raw = raw
        .strip_prefix('/')
        .filter(|value| value.as_bytes().get(1) == Some(&b':'))
        .unwrap_or(raw);
    Ok(PathBuf::from(raw))
}

pub(crate) fn path_to_file_uri(path: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        let normalized = path.to_string_lossy().replace('\\', "/");
        return format!("file:///{}", normalized.trim_start_matches('/'));
    }
    #[cfg(not(target_os = "windows"))]
    format!("file://{}", path.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_uri_round_trips_current_platform_path() {
        let path = std::env::current_dir().unwrap();
        let uri = path_to_file_uri(&path);
        assert_eq!(path, file_uri_to_path(&uri).unwrap());
    }
}
