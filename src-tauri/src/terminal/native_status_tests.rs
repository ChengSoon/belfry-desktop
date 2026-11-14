use super::*;
use crate::agent::{AgentKind, ProgramState};
use crate::terminal::contracts::AppErrorCode;
use std::sync::mpsc;

#[derive(Debug)]
struct NoopKiller;
impl ChildKiller for NoopKiller {
    fn kill(&mut self) -> std::io::Result<()> { Ok(()) }
    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> { Box::new(Self) }
}

#[derive(Default)]
struct Sink(Mutex<Vec<TerminalEvent>>);
impl TerminalEventSink for Sink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

struct RecordingWriter(Arc<Mutex<Vec<u8>>>);
impl Write for RecordingWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

fn session(sink: Arc<dyn TerminalEventSink>, writer: Box<dyn Write + Send>) -> Arc<NativeSession> {
    Arc::new(NativeSession {
        master: Mutex::new(None), writer: Mutex::new(Some(writer)), killer: Mutex::new(Box::new(NoopKiller)),
        sink, sequence: AtomicU64::new(0), exit_emitted: AtomicBool::new(false),
        exit_reason: Mutex::new(TerminalExitReason::Normal), reader_done: (Mutex::new(false), Condvar::new()),
        closing: AtomicBool::new(false), palette: RwLock::new(None), auto_password: Mutex::new(None),
        program_status: Mutex::new(ProgramInputStatus::default()), _launch_overlay: Default::default(),
        replies: Mutex::new(PendingReplies::default()),
    })
}

fn report(session: &NativeSession, parser: &mut super::super::program_status::ProgramStatus, agent: AgentKind, state: &str) {
    let wire = format!("\x1b]7501;app={}:state={state}\x1b\\", agent.terminal_status_app().unwrap());
    let snapshot = parser.feed(wire.as_bytes()).pop().unwrap();
    session.observe_program_status(Some(&snapshot), true);
}

#[test]
fn checked_write_waiting_for_the_writer_rechecks_the_latest_native_status() {
    for agent in [AgentKind::Codex, AgentKind::Claude] {
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let session = session(Arc::new(Sink::default()), Box::new(RecordingWriter(bytes.clone())));
        let backend = Arc::new(NativePtyBackend::default());
        backend.sessions.lock().unwrap().insert("pty".into(), session.clone());
        assert_eq!(backend.write_checked("pty", b"paste", Some(1)).unwrap_err().code, AppErrorCode::Conflict);
        let mut parser = super::super::program_status::ProgramStatus::new(agent);
        report(&session, &mut parser, agent, "idle");
        let writer = session.writer.lock().unwrap();
        let (sent, received) = mpsc::channel();
        let task_backend = backend.clone();
        let task = thread::spawn(move || { sent.send(task_backend.write_checked("pty", b"paste", Some(1))).unwrap(); });
        assert!(received.recv_timeout(Duration::from_millis(50)).is_err());
        report(&session, &mut parser, agent, "working");
        drop(writer);
        assert_eq!(received.recv_timeout(Duration::from_secs(2)).unwrap().unwrap_err().code, AppErrorCode::Conflict);
        task.join().unwrap();
        assert!(bytes.lock().unwrap().is_empty());
    }
}

struct DelayedSink {
    started: mpsc::Sender<()>,
    release: Mutex<mpsc::Receiver<()>>,
    output_seen: AtomicBool,
    states: Mutex<Vec<ProgramState>>,
}
impl TerminalEventSink for DelayedSink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        if matches!(event, TerminalEvent::Output { .. }) && !self.output_seen.swap(true, Ordering::AcqRel) {
            self.started.send(()).unwrap();
            self.release.lock().unwrap().recv_timeout(Duration::from_secs(2)).unwrap();
        }
        if let TerminalEvent::AgentState { snapshot, .. } = event {
            self.states.lock().unwrap().push(snapshot.program_status.unwrap().state);
        }
        Ok(())
    }
}

#[test]
fn reader_applies_the_latest_root_report_before_delayed_frontend_delivery() {
    for (agent, blocked) in [(AgentKind::Codex, true), (AgentKind::Claude, true), (AgentKind::Codex, false), (AgentKind::Claude, false)] {
        let (started, received) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let sink = Arc::new(DelayedSink { started, release: Mutex::new(released), output_seen: AtomicBool::new(false), states: Mutex::new(Vec::new()) });
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let session = session(sink.clone(), Box::new(RecordingWriter(bytes.clone())));
        let backend = NativePtyBackend::default();
        backend.sessions.lock().unwrap().insert("pty".into(), session.clone());
        let app = agent.terminal_status_app().unwrap();
        let change = if blocked { format!("\x1b]7501;app={app}:state=blocked:kind=permission\x1b\\") }
            else { "\x1b]cancelled\x18\x1bPcancelled\x1a\x1b[?2004l".into() };
        let wire = format!("\x1b[?2004h\x1b]7501;app={app}:state=idle\x1b\\{change}");
        spawn_reader("pty".into(), Box::new(std::io::Cursor::new(wire.into_bytes())), session.clone(), Some(agent));
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(sink.states.lock().unwrap().is_empty());
        assert_eq!(backend.write_checked("pty", b"paste", Some(1)).unwrap_err().code, AppErrorCode::Conflict);
        assert_eq!(backend.write_checked("pty", b"paste", Some(2)).unwrap_err().code, AppErrorCode::Conflict);
        assert!(bytes.lock().unwrap().is_empty());
        release.send(()).unwrap();
        let (done, _) = session.reader_done.1.wait_timeout_while(session.reader_done.0.lock().unwrap(), Duration::from_secs(2), |done| !*done).unwrap();
        assert!(*done);
        let expected: &[ProgramState] = if blocked { &[ProgramState::Idle, ProgramState::Blocked, ProgramState::Clear] } else { &[ProgramState::Idle] };
        assert_eq!(sink.states.lock().unwrap().as_slice(), expected);
        assert_eq!(session.program_status.lock().unwrap().report, None);
    }
}

struct ReaderDuringWrite(std::sync::Weak<NativeSession>);
impl Write for ReaderDuringWrite {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let session = self.0.upgrade().unwrap();
        let mut status = session.program_status.try_lock().expect("a guarded write blocked the PTY reader");
        status.report = Some((2, false));
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

#[test]
fn status_reader_can_progress_during_a_write_and_stop_the_later_enter() {
    let session = session(Arc::new(Sink::default()), Box::new(std::io::sink()));
    *session.program_status.lock().unwrap() = ProgramInputStatus { report: Some((1, true)), bracketed_paste: true };
    *session.writer.lock().unwrap() = Some(Box::new(ReaderDuringWrite(Arc::downgrade(&session))));
    let backend = NativePtyBackend::default();
    backend.sessions.lock().unwrap().insert("pty".into(), session);
    backend.write_checked("pty", b"large bracketed paste", Some(1)).unwrap();
    assert_eq!(backend.write_checked("pty", b"\r", Some(1)).unwrap_err().code, AppErrorCode::Conflict);
}

struct ReplyWriter(mpsc::Sender<Vec<u8>>);
impl Write for ReplyWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.send(bytes.to_vec()).unwrap();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

#[test]
fn device_replies_do_not_block_the_status_reader_behind_a_large_input_write() {
    let (started, received) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let (written, reply) = mpsc::channel();
    let sink = Arc::new(DelayedSink { started, release: Mutex::new(released), output_seen: AtomicBool::new(false), states: Mutex::new(Vec::new()) });
    let session = session(sink.clone(), Box::new(ReplyWriter(written)));
    let writer = session.writer.lock().unwrap();
    let wire = b"\x1b]7501;?\x1b\\\x1b]7501;app=claude-code:state=working\x1b\\";
    spawn_reader("pty".into(), Box::new(std::io::Cursor::new(wire.to_vec())), session.clone(), Some(AgentKind::Claude));
    // No writer access is possible yet, but the reader must forward output and status.
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    assert_eq!(session.program_status.lock().unwrap().report, Some((1, false)));
    assert!(reply.try_recv().is_err());
    release.send(()).unwrap();
    let (done, _) = session.reader_done.1.wait_timeout_while(session.reader_done.0.lock().unwrap(), Duration::from_secs(2), |done| !*done).unwrap();
    assert!(*done);
    assert_eq!(sink.states.lock().unwrap().as_slice(), &[ProgramState::Working, ProgramState::Clear]);
    drop(writer);
    assert_eq!(reply.recv_timeout(Duration::from_secs(2)).unwrap().as_slice(), super::super::program_status::REPLY);
}
