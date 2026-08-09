use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::contracts::{TerminalEvent, TerminalExitReason};
use super::native::NativeSession;

pub(super) fn spawn_exit_monitor(
    session_id: String,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    session: Arc<NativeSession>,
    sessions: Arc<Mutex<HashMap<String, Arc<NativeSession>>>>,
) {
    thread::spawn(move || {
        let status = child.wait();
        let (exit_code, fallback_reason) = match status {
            Ok(status) => (status.exit_code() as i32, TerminalExitReason::Normal),
            Err(_) => (1, TerminalExitReason::IoFailed),
        };
        let reason = resolved_reason(&session, fallback_reason);
        wait_for_reader(&session);
        if !session.exit_emitted.swap(true, Ordering::AcqRel) {
            let _ = session.sink.send(TerminalEvent::Exit {
                session_id: session_id.clone(),
                exit_code,
                reason,
            });
        }
        sessions.lock().unwrap().remove(&session_id);
    });
}

/// 轮询等待退出事件，返回是否在截止时刻前等到。
pub(super) fn wait_until(session: &NativeSession, deadline: Instant) -> bool {
    while !session.exit_emitted.load(Ordering::Acquire) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    session.exit_emitted.load(Ordering::Acquire)
}

/// 先给宽限期自行退出，超时再强杀。调用方负责决定是否放到后台线程。
pub(super) fn reap(session: &NativeSession, grace: Duration, kill_grace: Duration) {
    if wait_until(session, Instant::now() + grace) {
        return;
    }
    *session.exit_reason.lock().unwrap() = TerminalExitReason::Terminated;
    let _ = session.killer.lock().unwrap().kill();
    wait_until(session, Instant::now() + kill_grace);
}

fn resolved_reason(session: &NativeSession, fallback: TerminalExitReason) -> TerminalExitReason {
    let reason = *session.exit_reason.lock().unwrap();
    if reason == TerminalExitReason::Normal {
        fallback
    } else {
        reason
    }
}

fn wait_for_reader(session: &NativeSession) {
    let done = session.reader_done.0.lock().unwrap();
    if !*done {
        let _ = session
            .reader_done
            .1
            .wait_timeout_while(done, Duration::from_secs(1), |value| !*value)
            .unwrap();
    }
}
