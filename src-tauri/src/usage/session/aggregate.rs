use super::{
    claude::ClaudeUsage, codex::CodexUsage, contracts::SessionStatistics, details::Details,
    pi::PiUsage,
};
use crate::agent::{AgentKind, AgentSessionRef};
use serde_json::Value;
use std::{
    collections::HashSet,
    hash::{DefaultHasher, Hash, Hasher},
};

const MAX_RECORDS: usize = 200_000;

pub(super) struct Accumulator {
    session: AgentSessionRef,
    codex: CodexUsage,
    claude: ClaudeUsage,
    pi: PiUsage,
    details: Details,
    seen: HashSet<u64>,
    limited: bool,
}

impl Accumulator {
    pub fn new(session: AgentSessionRef) -> Self {
        Self {
            session,
            codex: CodexUsage::default(),
            claude: ClaudeUsage::default(),
            pi: PiUsage::default(),
            details: Details::default(),
            seen: HashSet::new(),
            limited: false,
        }
    }

    pub fn consume(&mut self, record: &Value) {
        if !self.belongs(record) {
            return;
        }
        if self.seen.len() >= MAX_RECORDS {
            self.limited = true;
            return;
        }
        if !self.seen.insert(fingerprint(record)) {
            return;
        }
        self.details.timestamp(record);
        match self.session.agent {
            AgentKind::Codex => self.codex.consume(record, &mut self.details),
            AgentKind::Claude => self.claude.consume(record, &mut self.details),
            AgentKind::Pi => self.pi.consume(record, &mut self.details),
        }
    }

    fn belongs(&self, record: &Value) -> bool {
        record.is_object()
            && record["isSidechain"] != true
            && record["sessionId"]
                .as_str()
                .is_none_or(|id| id == self.session.id)
    }

    pub fn report(&self) -> SessionStatistics {
        let tokens = match self.session.agent {
            AgentKind::Codex => self.codex.tokens(),
            AgentKind::Claude => self.claude.tokens(),
            AgentKind::Pi => self.pi.tokens(),
        };
        SessionStatistics {
            session: self.session.clone(),
            tokens,
            models: self.details.models.iter().cloned().collect(),
            current_model: self.details.current_model.clone(),
            tools: self.details.tool_report(),
            tool_count: if self.seen.is_empty() {
                None
            } else {
                self.details.tool_count()
            },
            updated_at: self.details.updated_at,
            observed_at: now(),
            source_files: 0,
            scanned_bytes: 0,
            pending: false,
            skipped_lines: 0,
            note: self.note(),
        }
    }

    fn note(&self) -> Option<String> {
        let mut notes = Vec::new();
        if self.limited {
            notes.push("日志超过 20 万条，显示已读取部分");
        }
        if self.details.incomplete_tools {
            notes.push("部分工具缺少调用 ID，工具总数不可用");
        }
        if self.claude.incomplete {
            notes.push("部分用量缺少消息 ID，Token 合计不可用");
        }
        (!notes.is_empty()).then(|| notes.join("；"))
    }
}

fn fingerprint(record: &Value) -> u64 {
    let mut hasher = DefaultHasher::new();
    record.to_string().hash(&mut hasher);
    hasher.finish()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or(0)
}
