use crate::{
    agent::AgentKind,
    usage::{claude::ClaudeRecord, codex::CodexRecord},
};

#[derive(Clone, Debug)]
pub(super) enum Record {
    Claude(ClaudeRecord),
    Codex(CodexRecord),
}

impl Record {
    pub fn parse(agent: AgentKind, bytes: &[u8]) -> Result<Option<Self>, ()> {
        let text = std::str::from_utf8(bytes).map_err(|_| ())?;
        let value = serde_json::from_str(text.trim()).map_err(|_| ())?;
        Ok(match agent {
            AgentKind::Claude => ClaudeRecord::parse(&value).map(Self::Claude),
            AgentKind::Codex => CodexRecord::parse(&value).map(Self::Codex),
        })
    }

    pub fn heap_bytes(&self) -> usize {
        match self {
            Self::Claude(record) => record.heap_bytes(),
            Self::Codex(record) => record.heap_bytes(),
        }
    }
}

pub(super) fn relevant(agent: AgentKind, bytes: &[u8]) -> bool {
    let keywords: &[&str] = match agent {
        AgentKind::Claude => &["\"usage\""],
        AgentKind::Codex => &["\"session_meta\"", "\"turn_context\"", "token_count"],
    };
    std::str::from_utf8(bytes).map_or(true, |line| keywords.iter().any(|key| line.contains(key)))
}
