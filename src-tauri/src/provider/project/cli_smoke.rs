use super::{
    launch,
    tests::{TempRoot, provider},
};
use crate::agent::AgentKind;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};

#[test]
#[ignore = "requires local Codex and Claude CLIs; uses a loopback mock endpoint only"]
fn installed_clis_keep_parallel_project_routes_and_credentials_isolated() {
    let root = TempRoot::new();
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/test-project-provider.py");
    let mut command = Command::new("python3");
    if let Some(path) = crate::agent::user_command_path() {
        command.env("PATH", path);
    }
    let mut child = command
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    let port: u16 = line.trim().parse().unwrap();
    let (fixtures, _leases) = fixtures(&root, port);
    writeln!(
        child.stdin.take().unwrap(),
        "{}",
        serde_json::to_string(&fixtures).unwrap()
    )
    .unwrap();
    let mut report = String::new();
    stdout.read_to_string(&mut report).unwrap();
    assert!(child.wait().unwrap().success(), "{report}");
    println!("{report}");
    assert_eq!(4, report.lines().count());
}

fn fixtures(
    root: &TempRoot,
    port: u16,
) -> (
    Vec<serde_json::Value>,
    Vec<crate::terminal::overlay::LaunchOverlay>,
) {
    let mut leases = Vec::new();
    let mut fixtures = Vec::new();
    for kind in AgentKind::ALL {
        for id in ["a", "b"] {
            let mut provider = provider(id);
            provider.base_url = format!(
                "http://127.0.0.1:{port}/{id}{}",
                if kind == AgentKind::Codex { "/v1" } else { "" }
            );
            provider.model = if kind == AgentKind::Claude {
                "claude-sonnet-4-5-20250929"
            } else {
                "gpt-5.4"
            }
            .into();
            let overlay = launch::prepare(&root.0, kind, &provider).unwrap();
            fixtures.push(serde_json::json!({ "kind": kind, "arguments": overlay.arguments,
                "environment": overlay.environment, "unset": overlay.unset,
                "expected": { "path": format!("/{id}/"), "key": provider.api_key, "model": provider.model } }));
            leases.push(overlay);
        }
    }
    (fixtures, leases)
}
