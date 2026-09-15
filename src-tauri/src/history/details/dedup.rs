use super::{contracts::HistoryEntry, parser};
use crate::agent::{AgentKind, AgentSessionRef};
use serde_json::Value;
use std::{
    collections::{HashSet, VecDeque},
    hash::{Hash, Hasher},
};

const RECENT_RECORDS: usize = 4096;
struct Echo {
    role: String,
    hash: u64,
    variant: String,
    timestamp: Option<i64>,
}
pub(super) struct Parser {
    session: AgentSessionRef,
    verified: bool,
    recent: HashSet<String>,
    order: VecDeque<String>,
    echo: Option<Echo>,
}

impl Parser {
    pub fn new(session: AgentSessionRef) -> Self {
        Self {
            session,
            verified: true,
            recent: HashSet::new(),
            order: VecDeque::new(),
            echo: None,
        }
    }

    pub fn next_file(&mut self) {
        self.verified = true;
        self.echo = None;
    }

    pub fn parse(&mut self, value: &Value, source: &str) -> Option<HistoryEntry> {
        if self.session.agent == AgentKind::Codex && value["type"] == "session_meta" {
            self.verified = value["payload"]["session_id"]
                .as_str()
                .or_else(|| value["payload"]["id"].as_str())
                == Some(&self.session.id);
            return None;
        }
        if !self.verified {
            return None;
        }
        let entry = parser::parse(&self.session, value, source)?;
        if self.duplicate(value, &entry) || self.echoed(value, &entry) {
            return None;
        }
        Some(entry)
    }

    fn duplicate(&mut self, value: &Value, entry: &HistoryEntry) -> bool {
        let payload = if self.session.agent == AgentKind::Codex {
            &value["payload"]
        } else {
            &value["message"]
        };
        let id = value["uuid"]
            .as_str()
            .or_else(|| payload["id"].as_str())
            .or_else(|| payload["call_id"].as_str());
        let Some(id) = id else {
            return false;
        };
        let key = format!("{}:{}:{}", entry.role, hash(id), hash(&payload.to_string()));
        if !self.recent.insert(key.clone()) {
            return true;
        }
        self.order.push_back(key);
        if self.order.len() > RECENT_RECORDS {
            if let Some(oldest) = self.order.pop_front() {
                self.recent.remove(&oldest);
            }
        }
        false
    }

    fn echoed(&mut self, value: &Value, entry: &HistoryEntry) -> bool {
        if self.session.agent != AgentKind::Codex || !entry.tools.is_empty() {
            self.echo = None;
            return false;
        }
        let variant = value["type"].as_str().unwrap_or_default();
        let fingerprint = hash(&entry.text);
        let duplicate = self.echo.as_ref().is_some_and(|last| {
            last.role == entry.role
                && last.hash == fingerprint
                && last.variant != variant
                && close_time(last.timestamp, entry.timestamp)
        });
        self.echo = (!duplicate).then(|| Echo {
            role: entry.role.clone(),
            hash: fingerprint,
            variant: variant.into(),
            timestamp: entry.timestamp,
        });
        duplicate
    }
}

fn close_time(left: Option<i64>, right: Option<i64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.abs_diff(right) <= 2,
        _ => true,
    }
}
fn hash(value: &str) -> u64 {
    let mut state = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut state);
    state.finish()
}
