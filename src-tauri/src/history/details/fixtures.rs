use super::{cancel::Cancellation, contracts::DetailRequest, reader::DetailReader};
use crate::agent::{AgentKind, AgentSessionRef};
use serde_json::{Value, json};
use std::path::PathBuf;

pub(super) struct Fixture {
    pub root: PathBuf,
}
impl Fixture {
    pub fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-cm09-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&root).unwrap();
        Self { root }
    }
    pub fn write(&self, name: &str, lines: &[Value]) -> PathBuf {
        let path = self.root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            lines
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        path
    }
    pub fn reader(&self, agent: AgentKind) -> DetailReader {
        DetailReader::open(request(agent), &self.root, Cancellation::default()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub(super) fn request(agent: AgentKind) -> DetailRequest {
    DetailRequest {
        reader_id: "reader-one".into(),
        session: AgentSessionRef {
            agent,
            id: "native".into(),
        },
    }
}
pub(super) fn meta(id: &str) -> Value {
    json!({"type":"session_meta","payload":{"id":id,"cwd":"/work/中文"}})
}
pub(super) fn codex_message(text: &str) -> Value {
    json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":text}]}})
}
pub(super) fn claude_message(id: &str, text: &str) -> Value {
    json!({"type":"user","uuid":id,"sessionId":"native","message":{"content":text}})
}
