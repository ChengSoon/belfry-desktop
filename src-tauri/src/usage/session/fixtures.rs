use crate::agent::{AgentKind, AgentSessionRef};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub(super) struct Fixture(pub PathBuf);

impl Fixture {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "belfry-session-statistics-{}",
            ulid::Ulid::generate()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    pub fn write(&self, name: &str, records: &[Value]) -> PathBuf {
        let path = self.0.join(name);
        let text = records
            .iter()
            .map(|record| record.to_string() + "\n")
            .collect::<String>();
        fs::write(&path, text).unwrap();
        path
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn session(agent: AgentKind) -> AgentSessionRef {
    AgentSessionRef {
        agent,
        id: "native".into(),
    }
}

pub(super) fn claude(id: &str, output: u64) -> Value {
    json!({"sessionId":"native", "type":"assistant", "message":{"id":id,"model":"claude-test",
        "usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":0,"output_tokens":output}}})
}

pub(super) fn codex(output: u64) -> Value {
    json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{
        "input_tokens":100,"cached_input_tokens":20,"output_tokens":output}}}})
}

pub(super) fn append(path: &Path, text: &str) {
    OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(text.as_bytes())
        .unwrap();
}
