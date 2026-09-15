use super::{contracts::SessionStatisticsQuery, service::SessionStatisticsState};
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
#[ignore = "需要本机安装 Codex、Claude Code 和 Python；模型请求只发送到本机模拟服务"]
fn actual_cli_transcripts_are_read_incrementally_without_changing_them() {
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
        serde_json::from_str(&line).expect("CLI fixture must return native session identities");
    let state = SessionStatisticsState::default();
    for fixture in fixtures {
        verify(&state, fixture);
    }
}

fn verify(state: &SessionStatisticsState, fixture: Fixture) {
    let files = crate::history::scan::collect_jsonl_files(&fixture.root);
    let before: Vec<_> = files
        .iter()
        .map(|path| std::fs::read(path).unwrap())
        .collect();
    let query = SessionStatisticsQuery {
        session: AgentSessionRef {
            agent: fixture.agent,
            id: fixture.id,
        },
        transcript_path: None,
    };
    let first = state.read_in(&fixture.root, query.clone()).unwrap();
    assert_eq!(
        Some(1),
        first.tokens.output,
        "{:?} output tokens",
        fixture.agent
    );
    assert_eq!(
        Some(10),
        first.tokens.input,
        "{:?} input tokens",
        fixture.agent
    );
    assert_eq!(Some(0), first.tool_count);
    assert!(!first.models.is_empty());
    assert!(first.source_files > 0);
    let next = state.read_in(&fixture.root, query).unwrap();
    assert_eq!(first.tokens, next.tokens);
    assert_eq!(first.scanned_bytes, next.scanned_bytes);
    let after: Vec<_> = files
        .iter()
        .map(|path| std::fs::read(path).unwrap())
        .collect();
    assert_eq!(before, after);
    println!(
        "{:?}: actual CLI identity, input=10, output=1, no tools; cached reread and original logs unchanged",
        fixture.agent
    );
}
