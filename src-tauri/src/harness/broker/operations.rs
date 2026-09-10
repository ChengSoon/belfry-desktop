use super::types::{BrokerError, BrokerResult};
use crate::project::resource_path::{self, ResourcePathError};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::Read,
    path::Path,
};

const LIST_LIMIT: usize = 1_000;
const READ_LIMIT: u64 = 512 * 1024;

pub(super) fn execute(root: &Path, tool: &str, params: &Value) -> BrokerResult {
    let relative = path_param(tool, params)?;
    let path = resource_path::resolve_existing(root, relative).map_err(map_path_error)?;
    let result = match tool {
        "project.list" => list(root, &path),
        "project.read" => read(root, &path),
        _ => Err(BrokerError::new("TOOL_UNDECLARED", "tool is not declared")),
    }?;
    resource_path::revalidate(root, &path).map_err(map_path_error)?;
    Ok(result)
}

pub(super) fn validate_params(tool: &str, params: &Value) -> Result<(), BrokerError> {
    path_param(tool, params).map(|_| ())
}

fn path_param<'a>(tool: &str, params: &'a Value) -> Result<&'a str, BrokerError> {
    let object = params.as_object().ok_or_else(invalid_params)?;
    match tool {
        "project.list" => match object.get("path") {
            None => Ok(""),
            Some(Value::String(path)) => Ok(path),
            _ => Err(invalid_params()),
        },
        "project.read" => object
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(invalid_params),
        _ => Err(BrokerError::new("TOOL_UNDECLARED", "tool is not declared")),
    }
}

fn list(root: &Path, directory: &Path) -> BrokerResult {
    if !directory.is_dir() {
        return Err(invalid_params());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory).map_err(map_io)? {
        let entry = entry.map_err(map_io)?;
        let kind = entry.file_type().map_err(map_io)?;
        if kind.is_symlink() || (!kind.is_file() && !kind.is_dir()) {
            continue;
        }
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "path": relative(root, &entry.path()),
            "kind": if kind.is_dir() { "directory" } else { "file" },
        }));
    }
    entries.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    let truncated = entries.len() > LIST_LIMIT;
    entries.truncate(LIST_LIMIT);
    Ok(json!({"entries": entries, "truncated": truncated}))
}

fn read(root: &Path, path: &Path) -> BrokerResult {
    let metadata = path.metadata().map_err(map_io)?;
    if !metadata.is_file() {
        return Err(invalid_params());
    }
    if metadata.len() > READ_LIMIT {
        return Err(BrokerError::new("TOO_LARGE", "file exceeds read limit"));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .map_err(map_io)?
        .take(READ_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(map_io)?;
    if bytes.len() as u64 > READ_LIMIT {
        return Err(BrokerError::new("TOO_LARGE", "file exceeds read limit"));
    }
    let binary = bytes.contains(&0) || String::from_utf8(bytes.clone()).is_err();
    Ok(
        json!({"path": relative(root, path), "size": metadata.len(), "binary": binary, "content": if binary { None } else { String::from_utf8(bytes).ok() }}),
    )
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn invalid_params() -> BrokerError {
    BrokerError::new("INVALID_PARAMS", "invalid tool parameters")
}
fn map_io(error: std::io::Error) -> BrokerError {
    if error.kind() == std::io::ErrorKind::NotFound {
        BrokerError::new("NOT_FOUND", "project resource not found")
    } else {
        BrokerError::new("IO_ERROR", "project resource access failed")
    }
}
fn map_path_error(error: ResourcePathError) -> BrokerError {
    match error {
        ResourcePathError::Invalid | ResourcePathError::OutsideRoot => BrokerError::new(
            "PATH_OUTSIDE_ROOT",
            "project path is outside the allowed root",
        ),
        ResourcePathError::NotFound => BrokerError::new("NOT_FOUND", "project resource not found"),
        ResourcePathError::Io => BrokerError::new("IO_ERROR", "project resource access failed"),
    }
}
