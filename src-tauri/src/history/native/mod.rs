//! Read native stores and expose a private, versioned transcript snapshot to Belfry's
//! bounded history/search/usage readers. Native stores remain the source of truth.
mod antigravity;
mod cache;
mod kimi;
mod opencode;
mod storage;

use super::contracts::HistorySession;
use crate::{
    agent::{AgentKind, AgentSessionRef, paths},
    terminal::AppError,
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(super) type Check<'a> = &'a dyn Fn() -> Result<(), AppError>;
static CACHE_LOCK: Mutex<()> = Mutex::new(());
pub(crate) const KINDS: [AgentKind; 3] =
    [AgentKind::Antigravity, AgentKind::Opencode, AgentKind::Kimi];

pub(crate) fn supported(kind: AgentKind) -> bool {
    KINDS.contains(&kind)
}

pub(super) struct Source {
    meta: HistorySession,
    files: Vec<PathBuf>,
    extra: Value,
}

pub(crate) fn root(kind: AgentKind) -> Option<PathBuf> {
    let data = paths::data_dir(kind)?;
    let data = if kind == AgentKind::Opencode {
        opencode::database(&data)
    } else {
        data
    };
    let user = super::scan::home_dir()?;
    Some(
        user.join(".belfry/cache/agent-history/v1")
            .join(kind.id())
            .join(storage::hash(data.as_os_str().to_string_lossy().as_bytes())),
    )
}

fn sources(
    kind: AgentKind,
    data: &Path,
    id: Option<&str>,
    check: Check<'_>,
) -> Result<Vec<Source>, AppError> {
    match kind {
        AgentKind::Antigravity => antigravity::list(data, id, check),
        AgentKind::Opencode => opencode::list(data, id, check),
        AgentKind::Kimi => kimi::list(data, id, check),
        _ => Err(AppError::invalid_argument("不支持的原生历史类型")),
    }
}

pub(crate) fn list(kind: AgentKind) -> Vec<HistorySession> {
    let Some(data) = paths::data_dir(kind) else {
        return Vec::new();
    };
    sources(kind, &data, None, &|| Ok(()))
        .unwrap_or_default()
        .into_iter()
        .map(|source| source.meta)
        .collect()
}

/// Run on a blocking worker. Cancellation is checked during discovery and every log line.
pub(crate) fn refresh(
    kind: AgentKind,
    id: Option<&str>,
    check: Check<'_>,
) -> Result<PathBuf, AppError> {
    if let Some(id) = id {
        super::scan::validate_session_id(id)?;
    }
    let data = paths::data_dir(kind).ok_or_else(|| AppError::not_found("找不到 CLI 数据目录"))?;
    let root = root(kind).ok_or_else(|| AppError::not_found("找不到历史缓存目录"))?;
    refresh_in(kind, &data, &root, id, check)?;
    Ok(root)
}

fn refresh_in(
    kind: AgentKind,
    data: &Path,
    root: &Path,
    id: Option<&str>,
    check: Check<'_>,
) -> Result<(), AppError> {
    let _guard = CACHE_LOCK
        .lock()
        .map_err(|_| AppError::io("历史缓存暂不可用"))?;
    check()?;
    let sources = sources(kind, data, id, check)?;
    cache::refresh(kind, data, root, &sources, id, check)
}

pub(crate) fn cache_file(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{}.jsonl", storage::hash(id.as_bytes())))
}

pub(crate) fn read_cached(path: &Path) -> Result<Option<HistorySession>, AppError> {
    cache::header(path)
        .and_then(|header| header.get("belfrySession").cloned())
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| AppError::invalid_argument("原生历史缓存格式无效"))
}

pub(crate) fn delete(kind: AgentKind, id: &str) -> Result<(), AppError> {
    super::scan::validate_session_id(id)?;
    let _guard = CACHE_LOCK
        .lock()
        .map_err(|_| AppError::io("历史缓存暂不可用"))?;
    let data = paths::data_dir(kind).ok_or_else(|| AppError::not_found("找不到 CLI 数据目录"))?;
    let source = sources(kind, &data, Some(id), &|| Ok(()))?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found("会话已不存在"))?;
    match kind {
        AgentKind::Antigravity => antigravity::delete(&data, &source)?,
        AgentKind::Opencode => opencode::delete(&data, &source)?,
        AgentKind::Kimi => kimi::delete(&data, &source)?,
        _ => return Err(AppError::invalid_argument("不支持的原生历史类型")),
    }
    if let Some(root) = root(kind) {
        let _ = std::fs::remove_file(cache_file(&root, id));
    }
    Ok(())
}

pub(crate) fn clear(kind: AgentKind) -> Result<u32, AppError> {
    let data = paths::data_dir(kind).ok_or_else(|| AppError::not_found("找不到 CLI 数据目录"))?;
    let sessions = sources(kind, &data, None, &|| Ok(()))?;
    let mut count = 0;
    for source in sessions {
        delete(kind, &source.meta.id)?;
        count += 1;
    }
    Ok(count)
}

fn metadata(
    kind: AgentKind,
    id: String,
    title: String,
    cwd: Option<String>,
    started: Option<i64>,
    updated: i64,
) -> Result<HistorySession, AppError> {
    super::scan::validate_session_id(&id)?;
    Ok(HistorySession {
        agent: kind,
        session_ref: AgentSessionRef {
            agent: kind,
            id: id.clone(),
        },
        id,
        title: super::scan::normalize_title(&title),
        cwd: cwd.filter(|s| !s.is_empty()),
        started_at: started,
        last_active_at: updated,
    })
}

fn message(
    source: &Source,
    role: &str,
    id: &str,
    at: &Value,
    model: Option<&str>,
    content: Value,
    usage: Option<Value>,
) -> Value {
    let mut value = json!({"type":role, "sessionId":source.meta.id, "cwd":source.meta.cwd,
        "timestamp":timestamp(at), "message":{"id":format!("{}:{id}",source.meta.agent.id()), "role":role,"content":content}});
    if let Some(model) = model {
        value["message"]["model"] = json!(model);
    }
    if let Some(usage) = usage {
        value["message"]["usage"] = usage;
    }
    value
}

fn timestamp(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .map(|v| {
            if v.unsigned_abs() > 100_000_000_000 {
                v / 1000
            } else {
                v
            }
        })
        .or_else(|| {
            value
                .as_str()
                .and_then(crate::usage::timestamp::parse_rfc3339)
        })
}

fn text_content(text: &str) -> Value {
    json!([{"type":"text", "text":text}])
}

fn normalize(
    kind: AgentKind,
    data: &Path,
    source: &Source,
    check: Check<'_>,
) -> Result<Vec<Value>, AppError> {
    match kind {
        AgentKind::Antigravity => antigravity::read(source, check),
        AgentKind::Opencode => opencode::read(data, source, check),
        AgentKind::Kimi => kimi::read(source, check),
        _ => Err(AppError::invalid_argument("不支持的原生历史类型")),
    }
}

#[cfg(test)]
mod tests;
