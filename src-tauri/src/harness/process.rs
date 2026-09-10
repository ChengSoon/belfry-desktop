use super::{framer::NdjsonFramer, types::*, validation::valid_envelope};
use serde_json::Value;
use std::{
    io::Read,
    process::{ChildStderr, ChildStdout},
    sync::Arc,
    thread,
    time::Duration,
};

const STDERR_LIMIT: usize = 64 * 1024;

pub(super) fn watch(
    id: String,
    stdout: ChildStdout,
    stderr: ChildStderr,
    process: Arc<WorkerProcess>,
    sink: EventSink,
    cleanup: Cleanup,
) {
    watch_stdout(
        id.clone(),
        stdout,
        process.clone(),
        sink.clone(),
        cleanup.clone(),
    );
    watch_stderr(id.clone(), stderr, sink.clone());
    watch_exit(id, process, sink, cleanup);
}

fn watch_stdout(
    id: String,
    mut stdout: ChildStdout,
    process: Arc<WorkerProcess>,
    sink: EventSink,
    cleanup: Cleanup,
) {
    thread::spawn(move || {
        let mut framer = NdjsonFramer::default();
        let mut chunk = [0_u8; 8192];
        loop {
            let read = match stdout.read(&mut chunk) {
                Ok(value) => value,
                Err(error) => {
                    return protocol_failure(&id, &process, &sink, &cleanup, error.to_string());
                }
            };
            if read == 0 {
                if let Err(error) = framer.finish() {
                    protocol_failure(&id, &process, &sink, &cleanup, format!("{error:?}"));
                }
                return;
            }
            let frames = match framer.push(&chunk[..read]) {
                Ok(value) => value,
                Err(error) => {
                    return protocol_failure(&id, &process, &sink, &cleanup, format!("{error:?}"));
                }
            };
            if !emit_frames(&id, frames, &process, &sink, &cleanup) {
                return;
            }
        }
    });
}

fn emit_frames(
    id: &str,
    frames: Vec<String>,
    process: &WorkerProcess,
    sink: &EventSink,
    cleanup: &Cleanup,
) -> bool {
    for frame in frames {
        let value: Value = match serde_json::from_str(&frame) {
            Ok(value) => value,
            Err(error) => {
                protocol_failure(id, process, sink, cleanup, format!("invalid JSON: {error}"));
                return false;
            }
        };
        if !valid_envelope(&value) {
            protocol_failure(
                id,
                process,
                sink,
                cleanup,
                "invalid RPC/event envelope".into(),
            );
            return false;
        }
        sink(WorkerEvent {
            worker_id: id.into(),
            kind: "message".into(),
            message: Some(value),
            lifecycle: None,
            detail: None,
        });
    }
    true
}

fn watch_stderr(id: String, mut stderr: ChildStderr, sink: EventSink) {
    thread::spawn(move || {
        let mut captured = 0;
        let mut bytes = [0_u8; 4096];
        while let Ok(read) = stderr.read(&mut bytes) {
            if read == 0 {
                break;
            }
            let keep = read.min(STDERR_LIMIT.saturating_sub(captured));
            if keep > 0 {
                captured += keep;
                sink(WorkerEvent {
                    worker_id: id.clone(),
                    kind: "diagnostic".into(),
                    message: None,
                    lifecycle: None,
                    detail: Some(String::from_utf8_lossy(&bytes[..keep]).into_owned()),
                });
            }
        }
    });
}

fn watch_exit(id: String, process: Arc<WorkerProcess>, sink: EventSink, cleanup: Cleanup) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(25));
            let status = match process.child.lock().unwrap().try_wait() {
                Ok(value) => value,
                Err(_) => return,
            };
            if let Some(status) = status {
                let lifecycle = match *process.exit_intent.lock().unwrap() {
                    ExitIntent::Cancel => Lifecycle::Cancelled,
                    ExitIntent::Shutdown => Lifecycle::Shutdown,
                    ExitIntent::Force => Lifecycle::ForceTerminated,
                    ExitIntent::None if status.success() => Lifecycle::Shutdown,
                    ExitIntent::None => Lifecycle::UnexpectedExit,
                };
                finish(
                    &id,
                    &process,
                    &sink,
                    &cleanup,
                    lifecycle,
                    Some(format!("exit status {status}")),
                );
                return;
            }
        }
    });
}

pub(super) fn finish(
    id: &str,
    process: &WorkerProcess,
    sink: &EventSink,
    cleanup: &Cleanup,
    lifecycle: Lifecycle,
    detail: Option<String>,
) {
    let mut current = process.lifecycle.lock().unwrap();
    if *current != Lifecycle::Running {
        return;
    }
    *current = lifecycle.clone();
    process.stdin.lock().unwrap().take();
    sink(lifecycle_event(id, lifecycle, detail));
    cleanup(id);
}

fn protocol_failure(
    id: &str,
    process: &WorkerProcess,
    sink: &EventSink,
    cleanup: &Cleanup,
    detail: String,
) {
    finish(
        id,
        process,
        sink,
        cleanup,
        Lifecycle::ProtocolFailed,
        Some(detail),
    );
    let _ = process.child.lock().unwrap().kill();
    let _ = process.child.lock().unwrap().wait();
}
