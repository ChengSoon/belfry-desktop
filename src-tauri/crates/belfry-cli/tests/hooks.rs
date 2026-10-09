use belfry_protocol::hooks::{ENV_PORT, ENV_TOKEN, HookMessage};
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

fn hook_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_belfry"));
    command.args(["--belfry-hook", "codex"]);
    command.env_remove(ENV_PORT).env_remove(ENV_TOKEN);
    command
        .env_remove("BELFRY_ENDPOINT")
        .env_remove("BELFRY_TAB_ID")
        .env_remove("BELFRY_TOKEN");
    command
}

fn wait(mut child: Child) -> Output {
    let deadline = Instant::now() + Duration::from_secs(5);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("hook waited for EOF or exceeded its startup budget");
        }
        thread::sleep(Duration::from_millis(10));
    }
    child.wait_with_output().unwrap()
}

fn spawn(command: &mut Command) -> Child {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

#[test]
fn console_hook_forwards_sanitized_payload_without_waiting_for_stdin_eof() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let collector = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "no hook event received");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        stream.write_all(b"{\"ok\":true}\n").unwrap();
        line
    });
    let mut command = hook_command();
    command
        .env(ENV_PORT, port.to_string())
        .env(ENV_TOKEN, "0".repeat(26));
    let mut child = spawn(&mut command);
    // Keep the write end alive, as Codex does. No newline or EOF is required.
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(br#"{"hook_event_name":"PreToolUse","session_id":"native-1","tool_name":"Bash","tool_input":{"command":"private-command"},"prompt":"private-prompt","error":"private-error"}"#).unwrap();
    let output = wait(child);
    assert!(output.status.success(), "{output:?}");
    assert_eq!(b"{}\n", output.stdout.as_slice());
    let line = collector.join().unwrap();
    let message: HookMessage<String> = serde_json::from_str(&line).unwrap();
    assert_eq!("codex", message.agent);
    assert_eq!("native-1", message.input.session_id);
    assert!(message.input.tool_key.is_some());
    assert!(!line.contains("private-"));
    drop(stdin);
}

#[test]
fn stale_endpoint_and_bad_payloads_are_neutral_not_failed_hooks() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    for payload in [
        "not-json",
        r#"{"hook_event_name":"Stop","session_id":"native-1"}"#,
    ] {
        let mut command = hook_command();
        command
            .env(ENV_PORT, port.to_string())
            .env(ENV_TOKEN, "0".repeat(26));
        let mut child = spawn(&mut command);
        child
            .stdin
            .take()
            .unwrap()
            .write_all(payload.as_bytes())
            .unwrap();
        let output = wait(child);
        assert!(output.status.success());
        assert_eq!(b"{}\n", output.stdout.as_slice());
        assert!(output.stderr.is_empty());
    }
    let output = wait(spawn(&mut hook_command()));
    assert!(output.status.success());
    assert_eq!(b"{}\n", output.stdout.as_slice());
}

#[cfg(windows)]
#[test]
fn cmd_hook_with_spaces_unicode_and_metacharacters_uses_console_stdio() {
    use std::os::windows::process::CommandExt;
    let root =
        std::env::temp_dir().join(format!("belfry hook 中文 & (test) {}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let binary = root.join("belfry.exe");
    std::fs::copy(env!("CARGO_BIN_EXE_belfry"), &binary).unwrap();
    let mut command = Command::new("cmd.exe");
    // Match Codex's /C raw_arg wrapper, not Rust's ordinary argument escaping.
    command
        .args(["/D", "/S", "/C"])
        .raw_arg(format!("\"\"{}\" --belfry-hook codex\"", binary.display()))
        .env_remove(ENV_PORT)
        .env_remove(ENV_TOKEN);
    let output = wait(spawn(&mut command));
    std::fs::remove_dir_all(root).unwrap();
    assert!(output.status.success(), "{output:?}");
    assert_eq!(b"{}\n", output.stdout.as_slice());
}
