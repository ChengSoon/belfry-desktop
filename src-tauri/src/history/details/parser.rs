use serde_json::Value;

use super::{claude, codex, contracts::HistoryEntry, pi, text};
use crate::agent::AgentSessionRef;

pub(super) fn parse(
    session: &AgentSessionRef,
    value: &Value,
    source: &str,
) -> Option<HistoryEntry> {
    let entry = match session.agent {
        crate::agent::AgentKind::Codex => codex::parse(value, source),
        crate::agent::AgentKind::Claude => claude::parse(session, value, source),
        crate::agent::AgentKind::Pi => pi::parse(session, value, source),
    }?;
    if entry.text.is_empty() && entry.tools.is_empty() && entry.omitted_blocks == 0 {
        return None;
    }
    Some(text::bounded(entry))
}
