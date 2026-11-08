use belfry_protocol::{ENV_ENDPOINT, ENV_TAB_ID, ENV_TOKEN};
use std::{
    io::{BufRead, BufReader, Write}, net::TcpListener,
    process::{Command, Stdio}, sync::{Arc, atomic::{AtomicBool, Ordering}},
    thread, time::{Duration, Instant},
};

fn run_fake(mode: &'static str, locale: &str) -> (Duration, String, bool) {
    // macOS may spend >500 ms verifying a freshly linked executable before main.
    // Warm that OS loader/cache once, as an installed CLI used to create/query a
    // task would be. Every measured wait still includes spawn through process exit.
    #[cfg(target_os = "macos")]
    {
        static LOADED: std::sync::Once = std::sync::Once::new();
        LOADED.call_once(|| {
            let _ = Command::new(env!("CARGO_BIN_EXE_belfry"))
                .arg("--help").env("BELFRY_LANG", "en")
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .status().expect("CLI loader warmup must launch the real binary");
        });
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("tcp:{}", listener.local_addr().unwrap());
    let stop = Arc::new(AtomicBool::new(false));
    let finished = stop.clone();
    let server = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut connections = Vec::new();
        while !finished.load(Ordering::Acquire) && Instant::now() < deadline {
            if let Ok((mut stream, _)) = listener.accept() {
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
                stream.set_write_timeout(Some(Duration::from_millis(100))).unwrap();
                let mut request = String::new();
                let _ = BufReader::new(&stream).read_line(&mut request);
                match mode {
                    "half" | "trickle" => { let _ = stream.write_all(b"{\"status\":"); }
                    "huge" => { let _ = stream.write_all(&vec![b'x'; 1024 * 1024 + 1]); }
                    "queued" => { let _ = stream.write_all(b"{\"status\":\"ok\",\"data\":{\"kind\":\"taskState\",\"task\":\"test-task\",\"state\":\"queued\",\"settled\":false,\"result\":null}}\n"); }
                    _ => {}
                }
                connections.push(stream);
            }
            if mode == "trickle" { for stream in &mut connections { let _ = stream.write_all(b" "); } }
            thread::sleep(Duration::from_millis(20));
        }
    });
    let started = Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_belfry"))
        .args(["wait", "test-task", "--timeout", "1"])
        .env("BELFRY_LANG", locale)
        .env(ENV_ENDPOINT, endpoint).env(ENV_TAB_ID, "deadline-tab").env(ENV_TOKEN, "deadline-token")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    // The watchdog only stops a hung child. The assertion below still requires <= 1.5s;
    // killing at 1.45s would reject a process that exits within the actual limit.
    let mut killed = false;
    while child.try_wait().unwrap().is_none() {
        if started.elapsed() >= Duration::from_millis(2500) { child.kill().unwrap(); killed = true; break; }
        thread::sleep(Duration::from_millis(5));
    }
    let output = child.wait_with_output().unwrap();
    let elapsed = started.elapsed();
    stop.store(true, Ordering::Release);
    server.join().unwrap();
    assert!(!output.status.success(), "未完成任务不能返回成功");
    (elapsed, String::from_utf8_lossy(&output.stderr).into_owned(), killed)
}

#[test]
fn wait_one_second_bounds_silent_partial_and_trickling_responses() {
    for locale in ["zh-CN", "en"] {
    for mode in ["silent", "half", "trickle", "queued"] {
        let (elapsed, error, killed) = run_fake(mode, locale);
        assert!(!killed, "{mode}: wait --timeout 1 卡在 IPC，超过 watchdog 2.5s: {error}");
        assert!(elapsed <= Duration::from_millis(1500), "{mode}: {elapsed:?}, {error}");
        assert!(error.contains("未完成") || error.contains("还没结") || error.contains("unconfirmed") || error.contains("unsettled"), "{locale}/{mode}: {error}");
    }
    }
}

#[test]
fn oversized_unterminated_response_is_rejected_before_the_wait_deadline() {
    let (elapsed, error, killed) = run_fake("huge", "zh-CN");
    assert!(!killed, "超长回包未被限额拒绝");
    assert!(elapsed < Duration::from_secs(1), "{elapsed:?}: {error}");
    assert!(error.contains("上限"), "{error}");
}
