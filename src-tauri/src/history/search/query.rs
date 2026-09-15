use std::collections::BTreeMap;

use crate::history::contracts::HistorySession;
use crate::terminal::AppError;

use super::contracts::{HistoryQuery, HistorySearchHit};

const MAX_QUERY_CHARS: usize = 256;
const SNIPPET_CONTEXT: usize = 48;
const MAX_SNIPPET_CHARS: usize = 352;

pub(super) fn validate(query: &HistoryQuery) -> Result<(), AppError> {
    if query.text.chars().count() > MAX_QUERY_CHARS {
        return Err(AppError::invalid_argument("搜索文字最多 256 字"));
    }
    if matches!((query.from, query.until), (Some(from), Some(until)) if from >= until) {
        return Err(AppError::invalid_argument("开始日期不能晚于结束日期"));
    }
    Ok(())
}

pub(super) fn matches(session: &HistorySession, query: &HistoryQuery) -> bool {
    query.agent.is_none_or(|agent| agent == session.agent)
        && query.project_root.as_ref().is_none_or(|root| {
            session
                .cwd
                .as_deref()
                .is_some_and(|cwd| path_key(cwd) == path_key(root))
        })
        && query.from.is_none_or(|from| session.last_active_at >= from)
        && query
            .until
            .is_none_or(|until| session.last_active_at < until)
}

fn path_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.as_bytes().get(1) == Some(&b':') || trimmed.starts_with("//") {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn excerpt(text: &str, needle: &str) -> Option<String> {
    if needle.is_empty() {
        return None;
    }
    let position = text.to_lowercase().find(needle)?;
    let mut folded_bytes = 0;
    let index = text
        .chars()
        .take_while(|character| {
            let before = folded_bytes;
            folded_bytes += character.to_lowercase().map(char::len_utf8).sum::<usize>();
            before < position
        })
        .count();
    let start = index.saturating_sub(SNIPPET_CONTEXT);
    let end = (index + needle.chars().count() + SNIPPET_CONTEXT).min(start + MAX_SNIPPET_CHARS);
    let mut chars = text.chars().skip(start);
    let value: String = chars.by_ref().take(end - start).collect();
    Some(format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        value.split_whitespace().collect::<Vec<_>>().join(" "),
        if chars.next().is_some() { "…" } else { "" }
    ))
}

pub(super) fn merge_hit(hits: &mut BTreeMap<String, HistorySearchHit>, hit: HistorySearchHit) {
    let key = format!("{}:{}", hit.session.agent.command_name(), hit.session.id);
    let Some(current) = hits.get_mut(&key) else {
        hits.insert(key, hit);
        return;
    };
    let last_active = current
        .session
        .last_active_at
        .max(hit.session.last_active_at);
    if current.session.started_at > hit.session.started_at {
        current.session = hit.session;
    }
    current.session.last_active_at = last_active;
    if current.snippet.is_none() {
        current.snippet = hit.snippet;
    }
}
