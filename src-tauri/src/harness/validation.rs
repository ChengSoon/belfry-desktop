use serde_json::Value;
use std::path::{Path, PathBuf};

pub(super) fn validate_command(
    entry: &str,
    args: &[String],
    allowed: &Path,
) -> Result<PathBuf, String> {
    let name = Path::new(entry)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if name != "node" && name != "node.exe" {
        return Err("only the repository fake worker is allowed".into());
    }
    let script = args.first().ok_or("fake worker script argument missing")?;
    let actual = Path::new(script)
        .canonicalize()
        .map_err(|error| format!("invalid worker script: {error}"))?;
    let expected = allowed
        .canonicalize()
        .map_err(|error| format!("invalid allowed script: {error}"))?;
    if actual != expected {
        return Err("only the repository fake worker is allowed".into());
    }
    resolve_executable(entry)
}

pub(super) fn resolve_node() -> Result<PathBuf, String> {
    resolve_executable("node")
}

pub(super) fn validate_request(value: &Value) -> Result<(), String> {
    let object = value.as_object().ok_or("request must be an object")?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || object.get("id").and_then(Value::as_str).is_none()
    {
        return Err("invalid RPC request".into());
    }
    let request = object.get("method").and_then(Value::as_str).is_some();
    let response = object.contains_key("result") ^ object.contains_key("error");
    if request == response {
        return Err("invalid RPC request".into());
    }
    Ok(())
}

pub(super) fn valid_envelope(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if let Some(event) = object.get("event").and_then(Value::as_object) {
        return event.get("schemaVersion").and_then(Value::as_u64) == Some(1)
            && event.get("type").and_then(Value::as_str).is_some()
            && event
                .get("sequence")
                .and_then(Value::as_u64)
                .is_some_and(|value| value > 0)
            && event.get("timestamp").and_then(Value::as_u64).is_some()
            && event.get("sessionId").and_then(Value::as_str).is_some();
    }
    object.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && object.get("id").and_then(Value::as_str).is_some()
        && (object.get("method").and_then(Value::as_str).is_some()
            || (object.contains_key("result") ^ object.contains_key("error")))
}

fn resolve_executable(entry: &str) -> Result<PathBuf, String> {
    let entry_path = Path::new(entry);
    if entry_path.components().count() > 1 {
        return Ok(entry_path.to_path_buf());
    }
    let path = std::env::var_os("PATH").ok_or("PATH unavailable")?;
    for directory in std::env::split_paths(&path) {
        let candidate = directory.join(entry);
        if candidate.is_file() {
            return Ok(candidate);
        }
        #[cfg(windows)]
        {
            let candidate = directory.join(format!("{entry}.exe"));
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err(format!("executable not found: {entry}"))
}
