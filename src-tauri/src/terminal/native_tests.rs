use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::backend::{PtyBackend, TerminalEventSink};
#[cfg(target_os = "macos")]
use super::contracts::SshTarget;
#[cfg(target_os = "macos")]
use super::contracts::TerminalPalette;
use super::contracts::{
    AppError, CreateTerminalRequest, Elevation, Platform, TerminalEvent, TerminalSize,
};
use super::native::NativePtyBackend;
#[cfg(target_os = "macos")]
use super::native_test_commands::color_query_command;
use super::native_test_commands::{
    large_output_command, latency_command, shell_exit_command, shell_marker_command,
    working_directory_command,
};
use crate::resource::{canonicalize, path_to_file_uri};

const MEBIBYTE: usize = 1024 * 1024;
const OUTPUT_PATTERN: &[u8] = b"0123456789abcdef";
// 这些测试都会启动真实 shell。并行运行会让多个 PowerShell/ConPTY 争抢 CPU 和控制台
// I/O，使延迟基准测到测试间干扰而非单会话性能。
static NATIVE_TEST_LOCK: Mutex<()> = Mutex::new(());
#[cfg(target_os = "macos")]
const INPUT_ECHO_P95_BUDGET: Duration = Duration::from_millis(50);
// Windows PowerShell 的观测值包含 PSReadLine 重绘与 ConPTY 刷新，当前机器连续三轮
// P95 为 114–133 ms。250 ms 留出 CI 抢占余量，同时仍能抓住明显的交互延迟回归。
#[cfg(target_os = "windows")]
const INPUT_ECHO_P95_BUDGET: Duration = Duration::from_millis(250);

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<TerminalEvent>>,
    changed: Condvar,
    output_len: AtomicUsize,
}

impl TerminalEventSink for RecordingSink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        if let TerminalEvent::Output { bytes, .. } = &event {
            self.output_len.fetch_add(bytes.len(), Ordering::Relaxed);
        }
        self.events.lock().unwrap().push(event);
        self.changed.notify_all();
        Ok(())
    }
}

#[test]
fn native_backend_runs_default_shell() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let session = backend.spawn(default_request(), sink.clone()).unwrap();
    complete_startup_handshake(&backend, &session.id, &sink);
    backend
        .write(&session.id, shell_marker_command().as_bytes())
        .unwrap();
    assert!(wait_for_marker(&sink, Duration::from_secs(3)));
    backend
        .resize(&session.id, TerminalSize { cols: 90, rows: 25 })
        .unwrap();
    backend.close(&session.id).unwrap();
    assert!(backend.write(&session.id, b"x").is_err());
}

#[test]
fn native_backend_emits_output_before_a_single_exit() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let session = backend.spawn(default_request(), sink.clone()).unwrap();
    complete_startup_handshake(&backend, &session.id, &sink);
    backend
        .write(&session.id, shell_exit_command().as_bytes())
        .unwrap();
    assert!(wait_for_exit(&sink, Duration::from_secs(3)));

    let events = sink.events.lock().unwrap();
    let marker = events.iter().position(event_contains_exit_marker).unwrap();
    let exits: Vec<_> = events
        .iter()
        .enumerate()
        .filter(|(_, event)| matches!(event, TerminalEvent::Exit { .. }))
        .collect();
    assert_eq!(exits.len(), 1);
    assert!(marker < exits[0].0);
}

#[test]
fn native_backend_preserves_one_mebibyte_of_ordered_output() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let session = backend.spawn(default_request(), sink.clone()).unwrap();
    complete_startup_handshake(&backend, &session.id, &sink);
    backend
        .write(&session.id, large_output_command().as_bytes())
        .unwrap();
    if !wait_for_complete_payload(&sink, Duration::from_secs(10)) {
        let bytes = output_bytes(&sink.events.lock().unwrap());
        panic!(
            "incomplete payload: bytes={}, begin={:?}, end={:?}",
            bytes.len(),
            marker_position(&bytes, b"__BELFRY_BEGIN__"),
            marker_position(&bytes, b"__BELFRY_END__")
        );
    }

    let events = sink.events.lock().unwrap();
    assert_sequences_are_ordered(&events);
    let bytes = output_bytes(&events);
    let (begin, end) = complete_payload_range(&bytes).unwrap();
    assert_eq!(
        &bytes[begin..end],
        OUTPUT_PATTERN.repeat(MEBIBYTE / OUTPUT_PATTERN.len())
    );
    drop(events);
    backend.close(&session.id).unwrap();
}

#[test]
fn native_backend_input_echo_p95_stays_under_budget() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let session = backend.spawn(default_request(), sink.clone()).unwrap();
    complete_startup_handshake(&backend, &session.id, &sink);
    assert!(wait_for_output_len(&sink, 1, Duration::from_secs(3)));

    let mut samples = Vec::with_capacity(20);
    for index in 0..20 {
        let marker = format!("__BELFRY_LATENCY_{index}__");
        let started = Instant::now();
        backend
            .write(&session.id, latency_command(&marker).as_bytes())
            .unwrap();
        assert!(wait_for_text(&sink, &marker, Duration::from_secs(1)));
        samples.push(started.elapsed());
    }
    samples.sort_unstable();
    let p95 = samples[18];
    eprintln!(
        "terminal input echo p95: {:.2} ms",
        p95.as_secs_f64() * 1000.0
    );
    assert!(p95 < INPUT_ECHO_P95_BUDGET);
    backend.close(&session.id).unwrap();
}

#[test]
fn native_backend_uses_requested_project_cwd() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let expected = canonicalize(&std::env::current_dir().unwrap()).unwrap();
    let mut request = default_request();
    request.cwd = Some(path_to_file_uri(&expected));
    let session = backend.spawn(request, sink.clone()).unwrap();
    complete_startup_handshake(&backend, &session.id, &sink);
    backend
        .write(&session.id, working_directory_command().as_bytes())
        .unwrap();
    assert!(wait_for_text(
        &sink,
        &expected.to_string_lossy(),
        Duration::from_secs(3)
    ));
    backend.close(&session.id).unwrap();
}

/// 只在 macOS 上跑：/usr/bin/ssh 是系统自带的，Windows 的 OpenSSH 客户端
/// 是可选功能，装没装不该决定测试能不能过。
///
/// 只验到"进程被拉起来"为止：连不连得上取决于本机网络与防火墙，不该进单元测试。
/// spawn 成功即证明 ssh 可执行文件解析、参数拼装与 PTY 接线这条链路是通的。
#[cfg(target_os = "macos")]
#[test]
fn native_backend_spawns_the_system_ssh_client() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let mut request = default_request();
    request.profile_id = "ssh".to_string();
    request.ssh = Some(SshTarget {
        host: "127.0.0.1".to_string(),
        user: Some("root".to_string()),
        port: Some(1),
        password: None,
        remember_password: None,
    });
    let session = backend.spawn(request, sink.clone()).unwrap();
    assert_eq!(session.shell, "root@127.0.0.1");
    backend.close(&session.id).unwrap();
}

/// 只在 macOS 上跑：这里验证的是"过滤器 → PTY writer → 子进程"这段接线，
/// 和平台无关。Windows 上真正的未知数是 ConPTY 会不会把查询透传出来，
/// 那件事只能在真机上验。
#[cfg(target_os = "macos")]
#[test]
fn native_backend_answers_color_queries_from_the_reader_thread() {
    let _guard = lock_native_test();
    let backend = NativePtyBackend::default();
    let sink = Arc::new(RecordingSink::default());
    let mut request = default_request();
    request.palette = Some(TerminalPalette {
        foreground: "#26272b".to_string(),
        background: "#fafafa".to_string(),
    });
    let session = backend.spawn(request, sink.clone()).unwrap();
    backend
        .write(&session.id, color_query_command().as_bytes())
        .unwrap();
    // 子进程从 stdin 读回来的，就是 reader 线程写进 PTY 的那条应答。
    assert!(wait_for_text(
        &sink,
        "__BELFRY_BG__fafa/fafa/fafa",
        Duration::from_secs(5)
    ));
    // 查询不能同时漏给前端：xterm.js 会再答一遍，多出来的那份会变成子进程的键盘输入。
    let events = sink.events.lock().unwrap();
    assert_eq!(marker_position(&output_bytes(&events), b"\x1b]11;?"), None);
    drop(events);
    backend.close(&session.id).unwrap();
}

fn default_request() -> CreateTerminalRequest {
    CreateTerminalRequest {
        platform: Platform::current(),
        profile_id: "system-default".to_string(),
        cwd: None,
        command: None,
        env: HashMap::new(),
        resume: None,
        ssh: None,
        cols: 100,
        rows: 30,
        elevation: Elevation::Normal,
        palette: None,
    }
}

fn wait_for_marker(sink: &RecordingSink, timeout: Duration) -> bool {
    wait_for_event(sink, timeout, event_contains_marker)
}

fn wait_for_output_len(sink: &RecordingSink, minimum: usize, timeout: Duration) -> bool {
    wait_for_events(sink, timeout, |_| {
        sink.output_len.load(Ordering::Relaxed) >= minimum
    })
}

fn wait_for_complete_payload(sink: &RecordingSink, timeout: Duration) -> bool {
    wait_for_events(sink, timeout, |events| {
        sink.output_len.load(Ordering::Relaxed) >= MEBIBYTE
            && complete_payload_range(&output_bytes(events)).is_some()
    })
}

fn wait_for_text(sink: &RecordingSink, marker: &str, timeout: Duration) -> bool {
    wait_for_events(sink, timeout, |events| {
        String::from_utf8_lossy(&output_bytes(events)).contains(marker)
    })
}

fn wait_for_exit(sink: &RecordingSink, timeout: Duration) -> bool {
    wait_for_event(sink, timeout, |event| {
        matches!(event, TerminalEvent::Exit { .. })
    })
}

fn wait_for_event(
    sink: &RecordingSink,
    timeout: Duration,
    predicate: impl Fn(&TerminalEvent) -> bool,
) -> bool {
    wait_for_events(sink, timeout, |events| events.iter().any(&predicate))
}

fn wait_for_events(
    sink: &RecordingSink,
    timeout: Duration,
    predicate: impl Fn(&[TerminalEvent]) -> bool,
) -> bool {
    let deadline = Instant::now() + timeout;
    let mut events = sink.events.lock().unwrap();
    while Instant::now() < deadline {
        if predicate(&events) {
            return true;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let result = sink.changed.wait_timeout(events, remaining).unwrap();
        events = result.0;
    }
    let bytes = output_bytes(&events);
    let tail = &bytes[bytes.len().saturating_sub(2_000)..];
    eprintln!(
        "terminal output before timeout: {:?}",
        String::from_utf8_lossy(tail)
    );
    false
}

fn lock_native_test() -> MutexGuard<'static, ()> {
    NATIVE_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// xterm.js 会自动应答 PowerShell/PSReadLine 的启动查询；这里的 RecordingSink 不是
/// 终端模拟器，必须补上同样的最小握手，否则 PowerShell 会等查询超时后才处理测试输入。
#[cfg(target_os = "windows")]
fn complete_startup_handshake(backend: &NativePtyBackend, session_id: &str, sink: &RecordingSink) {
    assert!(wait_for_text(sink, "\x1b[6n", Duration::from_secs(3)));
    backend.write(session_id, b"\x1b[1;1R\x1b[?1;2c").unwrap();
    // 等到提示符出现再发测试命令，避免响应与命令被 ConPTY 合并为同一输入块，
    // 被 PowerShell 的终端查询读取逻辑一并消费掉。
    assert!(wait_for_text(sink, "PS ", Duration::from_secs(5)));
}

#[cfg(not(target_os = "windows"))]
fn complete_startup_handshake(
    _backend: &NativePtyBackend,
    _session_id: &str,
    _sink: &RecordingSink,
) {
}

fn output_bytes(events: &[TerminalEvent]) -> Vec<u8> {
    events
        .iter()
        .filter_map(|event| match event {
            TerminalEvent::Output { bytes, .. } => Some(bytes.as_slice()),
            TerminalEvent::Exit { .. } => None,
        })
        .flatten()
        .copied()
        .collect()
}

fn assert_sequences_are_ordered(events: &[TerminalEvent]) {
    let sequences: Vec<_> = events
        .iter()
        .filter_map(|event| match event {
            TerminalEvent::Output { sequence, .. } => Some(*sequence),
            TerminalEvent::Exit { .. } => None,
        })
        .collect();
    assert_eq!(sequences, (0..sequences.len() as u64).collect::<Vec<_>>());
}

fn complete_payload_range(bytes: &[u8]) -> Option<(usize, usize)> {
    let begin_marker = b"__BELFRY_BEGIN__";
    let end_marker = b"__BELFRY_END__";
    let begin = bytes
        .windows(begin_marker.len())
        .rposition(|value| value == begin_marker)?
        + begin_marker.len();
    let end = bytes
        .windows(end_marker.len())
        .rposition(|value| value == end_marker)?;
    (end >= begin + MEBIBYTE).then_some((begin, end))
}

fn marker_position(bytes: &[u8], marker: &[u8]) -> Option<usize> {
    bytes
        .windows(marker.len())
        .rposition(|value| value == marker)
}

fn event_contains_exit_marker(event: &TerminalEvent) -> bool {
    match event {
        TerminalEvent::Output { bytes, .. } => {
            String::from_utf8_lossy(bytes).contains("__BELFRY_EXIT__")
        }
        TerminalEvent::Exit { .. } => false,
    }
}

fn event_contains_marker(event: &TerminalEvent) -> bool {
    match event {
        TerminalEvent::Output { bytes, .. } => {
            String::from_utf8_lossy(bytes).contains("__BELFRY_OK__")
        }
        TerminalEvent::Exit { .. } => false,
    }
}
