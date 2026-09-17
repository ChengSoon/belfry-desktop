use super::contracts::{HistoryQuery, SearchRoots};
use serde_json::json;
use std::fs;
use std::path::PathBuf;

pub(super) struct Fixture {
    pub root: PathBuf,
    pub roots: SearchRoots,
}

impl Fixture {
    pub fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("belfry-history-index-{}", ulid::Ulid::generate()));
        let roots = SearchRoots {
            codex: Some(root.join("codex")),
            claude: Some(root.join("claude")),
            pi: Some(root.join("pi")),
        };
        Self { root, roots }
    }

    pub fn write(&self, name: &str, content: &str) -> PathBuf {
        let path = self.root.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        path
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(super) fn codex_log(id: &str, cwd: &str, body: &str) -> String {
    [
        json!({"type":"session_meta","payload":{"session_id":id,"cwd":cwd,"timestamp":"2026-09-10T00:00:00Z"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"开始开发"}]}}),
        json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":body}]}}),
    ].iter().map(|value| format!("{value}\n")).collect()
}

pub(super) fn query(text: &str) -> HistoryQuery {
    HistoryQuery {
        text: text.to_string(),
        ..Default::default()
    }
}
