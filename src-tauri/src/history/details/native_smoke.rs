use super::{cancel::Cancellation, contracts::DetailRequest, reader::DetailReader};
use crate::agent::{AgentKind, AgentSessionRef};
use serde::Deserialize;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
};

struct FixtureProcess(Child);
impl Drop for FixtureProcess {
    fn drop(&mut self) {
        self.0.stdin.take();
        let _ = self.0.wait();
    }
}
#[derive(Deserialize)]
struct Fixture {
    agent: AgentKind,
    id: String,
    root: PathBuf,
}

#[test]
#[ignore = "需要本机 Codex、Claude Code 和 Python；模型请求仅发往本机模拟服务"]
fn actual_cli_messages_can_be_read_without_modifying_logs() {
    let script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/test-session-statistics.py");
    let child = Command::new("python3")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut process = FixtureProcess(child);
    let mut line = String::new();
    BufReader::new(process.0.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let fixtures: Vec<Fixture> =
        serde_json::from_str(&line).expect("native CLI fixture identities");
    for fixture in fixtures {
        verify(fixture);
    }
}

fn verify(fixture: Fixture) {
    let files = crate::history::scan::collect_jsonl_files(&fixture.root);
    let before: Vec<_> = files
        .iter()
        .map(|path| std::fs::read(path).unwrap())
        .collect();
    let request = DetailRequest {
        reader_id: "native-smoke".into(),
        session: AgentSessionRef {
            agent: fixture.agent,
            id: fixture.id,
        },
    };
    let mut reader = DetailReader::open(request, &fixture.root, Cancellation::default()).unwrap();
    let page = reader.page(0).unwrap();
    assert!(
        page.entries
            .iter()
            .any(|entry| entry.role == "user" && entry.text.contains("Reply with OK."))
    );
    assert!(
        page.entries
            .iter()
            .any(|entry| entry.role == "assistant" && !entry.text.is_empty())
    );
    assert_eq!(0, page.skipped_lines);
    assert!(!page.has_more);
    assert_eq!(page.scanned_bytes, reader.page(0).unwrap().scanned_bytes);
    let after: Vec<_> = files
        .iter()
        .map(|path| std::fs::read(path).unwrap())
        .collect();
    assert_eq!(before, after);
    println!(
        "{:?}: native user + assistant messages, repeat page stable, original bytes unchanged",
        fixture.agent
    );
}
