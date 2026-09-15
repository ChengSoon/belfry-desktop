use super::{SYNTHETIC_MODEL, matches_project, message_delta, read_tokens};
use crate::{
    agent::AgentKind,
    usage::{aggregate::UsageAccumulator, contracts::TokenTotals, timestamp::parse_rfc3339},
};
use serde_json::Value;
use std::collections::{HashMap, hash_map::Entry};

#[derive(Clone, Debug)]
pub(crate) struct ClaudeRecord {
    pub at: Option<i64>,
    model: String,
    cwd: Option<String>,
    key: (String, String),
    tokens: TokenTotals,
}

impl ClaudeRecord {
    pub fn parse(record: &Value) -> Option<Self> {
        let message = &record["message"];
        let model = message["model"].as_str().unwrap_or_default();
        if message["role"] != "assistant"
            || !message["usage"].is_object()
            || model.is_empty()
            || model == SYNTHETIC_MODEL
        {
            return None;
        }
        Some(Self {
            at: record["timestamp"].as_str().and_then(parse_rfc3339),
            model: model.to_string(),
            cwd: record["cwd"].as_str().map(ToOwned::to_owned),
            key: (
                message["id"].as_str().unwrap_or_default().to_string(),
                record["requestId"].as_str().unwrap_or_default().to_string(),
            ),
            tokens: read_tokens(&message["usage"]),
        })
    }

    pub fn accumulate(
        &self,
        accumulator: &mut UsageAccumulator,
        seen: &mut HashMap<(String, String), TokenTotals>,
        project_root: Option<&str>,
    ) -> usize {
        if !matches_project(self.cwd.as_deref(), project_root) {
            return 0;
        }
        let mut retained = 0;
        let previous = match seen.entry(self.key.clone()) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                retained = entry.key().0.capacity() + entry.key().1.capacity();
                entry.insert(TokenTotals::default())
            }
        };
        let delta = message_delta(previous, self.tokens);
        accumulator.record(
            AgentKind::Claude,
            &self.model,
            delta,
            self.at,
            self.cwd.as_deref(),
        );
        retained
    }

    pub fn heap_bytes(&self) -> usize {
        self.model.capacity()
            + self.cwd.as_ref().map_or(0, String::capacity)
            + self.key.0.capacity()
            + self.key.1.capacity()
    }
}
