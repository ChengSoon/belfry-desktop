//! Structured protocol events read from the native agent session logs.
//!
//! The terminal screen is a rendering surface: TUI redraws, line wrapping and
//! cursor movement make it unsuitable as the only source of collaboration
//! events. This module reads only assistant messages written after a
//! run-specific marker, while keeping the JSONL file and byte cursor private to
//! the local Codex/Claude history roots.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::history::scan::{claude_sessions_root, codex_sessions_root, collect_jsonl_files};
use crate::terminal::AppError;

const MAX_MARKER_LENGTH: usize = 512;
const MAX_RETURNED_CHUNKS: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationLogReadRequest {
    pub provider_id: String,
    pub marker: String,
    pub path: Option<String>,
    pub offset: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationLogReadResponse {
    pub path: Option<String>,
    pub offset: u64,
    pub marker_found: bool,
    pub chunks: Vec<String>,
}

#[tauri::command]
pub async fn collaboration_log_read(
    request: CollaborationLogReadRequest,
) -> Result<CollaborationLogReadResponse, AppError> {
    tauri::async_runtime::spawn_blocking(move || read_protocol_log(request))
        .await
        .map_err(|error| AppError::io(format!("读取 Agent 会话日志失败: {error}")))?
}

fn read_protocol_log(
    request: CollaborationLogReadRequest,
) -> Result<CollaborationLogReadResponse, AppError> {
    validate_request(&request)?;
    let root = sessions_root(&request.provider_id)?;
    let path = match request.path.as_deref() {
        Some(value) => Some(validate_log_path(&root, value)?),
        None => None,
    };

    if let Some(path) = path {
        if request.offset == 0 {
            return read_from_marker(&path, &request.marker);
        }
        return read_from_cursor(&path, request.offset, &request.marker);
    }

    for candidate in collect_jsonl_files(&root) {
        if let Some(result) = find_marker_in_file(&candidate, &request.marker)? {
            return Ok(result);
        }
    }
    Ok(empty_response())
}

fn read_from_marker(path: &Path, marker: &str) -> Result<CollaborationLogReadResponse, AppError> {
    Ok(find_marker_in_file(path, marker)?.unwrap_or_else(empty_response))
}

fn read_from_cursor(
    path: &Path,
    offset: u64,
    marker: &str,
) -> Result<CollaborationLogReadResponse, AppError> {
    let bytes = fs::read(path).map_err(|error| AppError::io(error.to_string()))?;
    if offset as usize > bytes.len() {
        return Ok(find_marker_in_bytes(path, &bytes, marker)?.unwrap_or_else(empty_response));
    }
    let (chunks, next_offset) = parse_complete_lines(&bytes[offset as usize..], marker, false);
    Ok(CollaborationLogReadResponse {
        path: Some(path.to_string_lossy().into_owned()),
        offset: offset.saturating_add(next_offset as u64),
        marker_found: true,
        chunks,
    })
}

fn find_marker_in_file(
    path: &Path,
    marker: &str,
) -> Result<Option<CollaborationLogReadResponse>, AppError> {
    let bytes = fs::read(path).map_err(|error| AppError::io(error.to_string()))?;
    find_marker_in_bytes(path, &bytes, marker)
}

fn find_marker_in_bytes(
    path: &Path,
    bytes: &[u8],
    marker: &str,
) -> Result<Option<CollaborationLogReadResponse>, AppError> {
    let mut cursor = 0usize;
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        let complete = line.ends_with(b"\n");
        if !complete {
            break;
        }
        let line_end = cursor + line.len();
        if is_user_marker(line, marker) {
            let (chunks, consumed) = parse_complete_lines(&bytes[line_end..], marker, false);
            return Ok(Some(CollaborationLogReadResponse {
                path: Some(path.to_string_lossy().into_owned()),
                offset: (line_end + consumed) as u64,
                marker_found: true,
                chunks,
            }));
        }
        cursor = line_end;
    }
    Ok(None)
}

fn parse_complete_lines(bytes: &[u8], marker: &str, seek_marker: bool) -> (Vec<String>, usize) {
    let mut chunks = Vec::new();
    let mut consumed = 0usize;
    let mut active = !seek_marker;
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        if !line.ends_with(b"\n") {
            break;
        }
        consumed += line.len();
        if !active {
            active = String::from_utf8_lossy(line).contains(marker);
            continue;
        }
        if let Ok(value) = serde_json::from_slice::<Value>(line)
            && let Some(text) = assistant_text(&value)
            && !text.is_empty()
        {
            chunks.push(text);
            if chunks.len() >= MAX_RETURNED_CHUNKS {
                break;
            }
        }
    }
    (chunks, consumed)
}

fn assistant_text(value: &Value) -> Option<String> {
    let record_type = value.get("type").and_then(Value::as_str);
    let (role, content) = if record_type == Some("response_item") {
        let payload = value.get("payload")?;
        if payload.get("type").and_then(Value::as_str) != Some("message")
            || payload.get("role").and_then(Value::as_str) != Some("assistant")
        {
            return None;
        }
        (
            payload.get("role").and_then(Value::as_str),
            payload.get("content"),
        )
    } else if record_type == Some("assistant") {
        (
            value
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(Value::as_str),
            value
                .get("message")
                .and_then(|message| message.get("content")),
        )
    } else {
        return None;
    };
    if role != Some("assistant") {
        return None;
    }
    content_text(content?)
}

fn is_user_marker(line: &[u8], marker: &str) -> bool {
    let Ok(value) = serde_json::from_slice::<Value>(line) else {
        return false;
    };
    let record_type = value.get("type").and_then(Value::as_str);
    if record_type == Some("response_item") {
        let Some(payload) = value.get("payload") else {
            return false;
        };
        return payload.get("type").and_then(Value::as_str) == Some("message")
            && payload.get("role").and_then(Value::as_str) == Some("user")
            && payload
                .get("content")
                .and_then(content_text)
                .is_some_and(|text| text.contains(marker));
    }
    record_type == Some("user")
        && value
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(content_text)
            .is_some_and(|text| text.contains(marker))
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let parts = content.as_array()?;
    let text = parts
        .iter()
        .filter(|part| {
            matches!(
                part.get("type").and_then(Value::as_str),
                Some("text" | "input_text" | "output_text")
            )
        })
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    Some(text)
}

fn sessions_root(provider_id: &str) -> Result<PathBuf, AppError> {
    match provider_id {
        "codex" => codex_sessions_root(),
        "claude" => claude_sessions_root(),
        _ => None,
    }
    .ok_or_else(|| AppError::not_found("Agent 会话日志目录不存在"))
}

fn validate_request(request: &CollaborationLogReadRequest) -> Result<(), AppError> {
    if !matches!(request.provider_id.as_str(), "codex" | "claude") {
        return Err(AppError::invalid_argument("不支持的 Agent provider"));
    }
    if request.marker.is_empty()
        || request.marker.len() > MAX_MARKER_LENGTH
        || request.marker.chars().any(char::is_control)
    {
        return Err(AppError::invalid_argument("协作 marker 无效"));
    }
    Ok(())
}

fn validate_log_path(root: &Path, value: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(value);
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| AppError::not_found(format!("Agent 会话日志目录不可用: {error}")))?;
    let canonical = fs::canonicalize(&path)
        .map_err(|error| AppError::not_found(format!("Agent 会话日志不可用: {error}")))?;
    if !canonical.starts_with(&canonical_root)
        || canonical.extension().and_then(|value| value.to_str()) != Some("jsonl")
    {
        return Err(AppError::invalid_argument("Agent 会话日志路径越界"));
    }
    Ok(canonical)
}

fn empty_response() -> CollaborationLogReadResponse {
    CollaborationLogReadResponse {
        path: None,
        offset: 0,
        marker_found: false,
        chunks: Vec::new(),
    }
}

#[cfg(test)]
#[path = "collaboration_protocol_tests.rs"]
mod tests;
