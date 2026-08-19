use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::resource::canonicalize;
use crate::terminal::AppError;

use super::contracts::{ProjectDirectory, ProjectEntry, ProjectEntryKind, ProjectFilePreview};

const MAX_DIRECTORY_ENTRIES: usize = 1_000;
const MAX_PREVIEW_BYTES: u64 = 512 * 1024;
const HIDDEN_GENERATED_DIRECTORIES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".next",
    ".turbo",
    "node_modules",
    "target",
];

pub fn list_directory(
    root_path: &str,
    relative_path: Option<&str>,
) -> Result<ProjectDirectory, AppError> {
    let root = project_root(root_path)?;
    let directory = resolve_existing(&root, relative_path.unwrap_or_default())?;
    if !directory.is_dir() {
        return Err(AppError::invalid_argument(
            "project resource must point to a directory",
        ));
    }

    let mut entries = fs::read_dir(&directory)
        .map_err(|error| map_io_error("read project directory", &directory, error))?
        .filter_map(Result::ok)
        .filter_map(|entry| match to_entry(&root, entry) {
            Ok(Some(value)) => Some(Ok(value)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| {
        entry_order(left)
            .cmp(&entry_order(right))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    let truncated = entries.len() > MAX_DIRECTORY_ENTRIES;
    entries.truncate(MAX_DIRECTORY_ENTRIES);
    Ok(ProjectDirectory {
        relative_path: relative_string(&root, &directory),
        entries,
        truncated,
    })
}

pub fn read_file(root_path: &str, relative_path: &str) -> Result<ProjectFilePreview, AppError> {
    let root = project_root(root_path)?;
    let path = resolve_existing(&root, relative_path)?;
    let metadata = path
        .metadata()
        .map_err(|error| map_io_error("read project file metadata", &path, error))?;
    if !metadata.is_file() {
        return Err(AppError::invalid_argument(
            "project resource must point to a file",
        ));
    }

    let size = metadata.len();
    let truncated = size > MAX_PREVIEW_BYTES;
    let mut bytes = Vec::with_capacity(size.min(MAX_PREVIEW_BYTES) as usize);
    File::open(&path)
        .map_err(|error| map_io_error("open project file", &path, error))?
        .take(MAX_PREVIEW_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| map_io_error("read project file", &path, error))?;
    let binary = looks_binary(&bytes);
    let content = if binary {
        String::new()
    } else {
        decode_text(bytes, truncated).unwrap_or_default()
    };
    let binary = binary || (content.is_empty() && size > 0 && !truncated);

    Ok(ProjectFilePreview {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| relative_path.to_string()),
        relative_path: relative_string(&root, &path),
        content,
        size,
        modified_at: modified_at(&metadata),
        language: language_for(&path).map(str::to_string),
        binary,
        truncated,
    })
}

fn project_root(root_path: &str) -> Result<PathBuf, AppError> {
    let requested = Path::new(root_path);
    let root = canonicalize(requested)
        .map_err(|error| map_io_error("open project root", requested, error))?;
    if !root.is_dir() {
        return Err(AppError::invalid_argument(
            "project root must point to a directory",
        ));
    }
    Ok(root)
}

fn resolve_existing(root: &Path, relative_path: &str) -> Result<PathBuf, AppError> {
    let relative = validate_relative_path(relative_path)?;
    let requested = root.join(relative);
    let resolved = canonicalize(&requested)
        .map_err(|error| map_io_error("open project resource", &requested, error))?;
    if !resolved.starts_with(root) {
        return Err(AppError::invalid_argument(
            "project resource must stay inside the project root",
        ));
    }
    Ok(resolved)
}

fn validate_relative_path(value: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(value.trim());
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::invalid_argument(
            "project resource path must be relative",
        ));
    }
    Ok(path.to_path_buf())
}

fn to_entry(root: &Path, entry: fs::DirEntry) -> Result<Option<ProjectEntry>, AppError> {
    let file_type = match entry.file_type() {
        Ok(value) => value,
        Err(error) => return Err(map_io_error("inspect project entry", &entry.path(), error)),
    };
    if file_type.is_symlink() || (!file_type.is_dir() && !file_type.is_file()) {
        return Ok(None);
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if file_type.is_dir() && HIDDEN_GENERATED_DIRECTORIES.contains(&name.as_str()) {
        return Ok(None);
    }
    let metadata = match entry.metadata() {
        Ok(value) => value,
        Err(error) => return Err(map_io_error("inspect project entry", &entry.path(), error)),
    };
    Ok(Some(ProjectEntry {
        name,
        relative_path: relative_string(root, &entry.path()),
        kind: if file_type.is_dir() {
            ProjectEntryKind::Directory
        } else {
            ProjectEntryKind::File
        },
        size: if file_type.is_file() {
            metadata.len()
        } else {
            0
        },
        modified_at: modified_at(&metadata),
    }))
}

fn entry_order(entry: &ProjectEntry) -> u8 {
    match entry.kind {
        ProjectEntryKind::Directory => 0,
        ProjectEntryKind::File => 1,
    }
}

fn relative_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn modified_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|value| u64::try_from(value.as_millis()).ok())
}

fn looks_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(8_192)];
    if sample.contains(&0) {
        return true;
    }
    let controls = sample
        .iter()
        .filter(|byte| **byte < 0x20 && !matches!(**byte, b'\n' | b'\r' | b'\t'))
        .count();
    !sample.is_empty() && controls * 10 > sample.len()
}

fn decode_text(bytes: Vec<u8>, truncated: bool) -> Option<String> {
    match String::from_utf8(bytes) {
        Ok(value) => Some(value),
        Err(error) if truncated && error.utf8_error().error_len().is_none() => {
            let valid = error.utf8_error().valid_up_to();
            String::from_utf8(error.into_bytes()[..valid].to_vec()).ok()
        }
        Err(_) => None,
    }
}

fn language_for(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if matches!(name.as_str(), "dockerfile" | "containerfile") {
        return Some("dockerfile");
    }
    match path.extension()?.to_string_lossy().to_lowercase().as_str() {
        "rs" => Some("rust"),
        "ts" | "tsx" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "json" => Some("json"),
        "toml" => Some("toml"),
        "yaml" | "yml" => Some("yaml"),
        "md" | "mdx" => Some("markdown"),
        "css" | "scss" | "sass" | "less" => Some("css"),
        "html" | "htm" => Some("html"),
        "sh" | "bash" | "zsh" | "fish" => Some("shell"),
        "py" => Some("python"),
        "java" => Some("java"),
        "go" => Some("go"),
        "c" | "h" | "cc" | "cpp" | "hpp" => Some("cpp"),
        "sql" => Some("sql"),
        _ => Some("text"),
    }
}

fn map_io_error(action: &str, path: &Path, error: std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound {
        AppError::not_found(format!("{action}: {} ({error})", path.display()))
    } else {
        AppError::io(format!("{action}: {} ({error})", path.display()))
    }
}

#[cfg(test)]
#[path = "files_test.rs"]
mod tests;
