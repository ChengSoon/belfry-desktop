use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{ChildKiller, MasterPty, PtySize, native_pty_system};

use super::auto_password::AutoPassword;
use super::backend::{PtyBackend, TerminalEventSink};
use super::contracts::{
    AppError, CreateTerminalRequest, TerminalEvent, TerminalExitReason, TerminalPalette,
    TerminalSession, TerminalSize, TerminalStatus,
};
use super::launch::{
    map_spawn_error, path_to_resource_uri, resolve_cwd, resolve_launch, validate_platform,
};
use super::native_lifecycle::{reap, spawn_exit_monitor, wait_until};
use super::osc::{OscColorFilter, Palette};
use super::ssh_auth;

const OUTPUT_CHUNK_SIZE: usize = 64 * 1024;
/// 交互式关闭：断开 PTY 后给进程自行收尾的时间，等待发生在后台线程。
const CLOSE_GRACE_PERIOD: Duration = Duration::from_secs(2);
/// 退出应用时不再礼让太久，避免窗口关掉后进程还挂着。
const SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_millis(500);
const KILL_GRACE_PERIOD: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct NativePtyBackend {
    sessions: Arc<Mutex<HashMap<String, Arc<NativeSession>>>>,
}

pub(super) struct NativeSession {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    pub(super) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(super) sink: Arc<dyn TerminalEventSink>,
    sequence: AtomicU64,
    pub(super) exit_emitted: AtomicBool,
    pub(super) exit_reason: Mutex<TerminalExitReason>,
    pub(super) reader_done: (Mutex<bool>, Condvar),
    /// 防止重复 close 拉起多个回收线程。
    closing: AtomicBool,
    /// reader 线程读它来应答 OSC 10/11；换肤时由 set_palette 改写。
    palette: RwLock<Option<Palette>>,
    /// SSH 登录密码：首次出现密码提示时自动填入一次，然后停用。非 SSH 会话为 None。
    auto_password: Mutex<Option<AutoPassword>>,
}

impl PtyBackend for NativePtyBackend {
    fn spawn(
        &self,
        request: CreateTerminalRequest,
        sink: Arc<dyn TerminalEventSink>,
    ) -> Result<TerminalSession, AppError> {
        request.validate()?;
        validate_platform(request.platform)?;
        let cwd = resolve_cwd(request.cwd.as_deref())?;
        let launch = resolve_launch(
            &request.profile_id,
            &cwd,
            &request.env,
            request.resume.as_deref(),
            request.ssh.as_ref(),
            request.collaboration_mode,
        )?;
        let shell = launch.display_name;
        let auto_password = match &request.ssh {
            Some(target) => {
                ssh_auth::resolve_password(target).map(|value| AutoPassword::new(&value))
            }
            None => None,
        };
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(to_pty_size(request.cols, request.rows))
            .map_err(|error| AppError::io(error.to_string()))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| AppError::io(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| AppError::io(error.to_string()))?;
        let child = pair
            .slave
            .spawn_command(launch.command)
            .map_err(|error| map_spawn_error(&shell, error))?;
        drop(pair.slave);

        let id = ulid::Ulid::generate().to_string().to_lowercase();
        let session = Arc::new(NativeSession {
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            killer: Mutex::new(child.clone_killer()),
            sink,
            sequence: AtomicU64::new(0),
            exit_emitted: AtomicBool::new(false),
            exit_reason: Mutex::new(TerminalExitReason::Normal),
            reader_done: (Mutex::new(false), Condvar::new()),
            closing: AtomicBool::new(false),
            // 颜色坏了不该拦下会话：解析失败就当没给，退回让 xterm.js 自己答。
            palette: RwLock::new(request.palette.as_ref().and_then(to_palette)),
            auto_password: Mutex::new(auto_password),
        });
        self.sessions
            .lock()
            .unwrap()
            .insert(id.clone(), session.clone());
        spawn_reader(id.clone(), reader, session.clone());
        spawn_exit_monitor(id.clone(), child, session, self.sessions.clone());

        Ok(TerminalSession {
            id,
            platform: request.platform,
            shell,
            cwd: path_to_resource_uri(&cwd),
            cols: request.cols,
            rows: request.rows,
            status: TerminalStatus::Running,
            exit_code: None,
        })
    }

    fn write(&self, session_id: &str, bytes: &[u8]) -> Result<(), AppError> {
        let session = self.session(session_id)?;
        let mut writer = session.writer.lock().unwrap();
        let writer = writer.as_mut().ok_or_else(AppError::process_exited)?;
        writer
            .write_all(bytes)
            .map_err(|error| AppError::io(error.to_string()))?;
        writer
            .flush()
            .map_err(|error| AppError::io(error.to_string()))
    }

    fn resize(&self, session_id: &str, size: TerminalSize) -> Result<(), AppError> {
        let size = size.validate()?;
        let session = self.session(session_id)?;
        let master = session.master.lock().unwrap();
        let master = master.as_ref().ok_or_else(AppError::process_exited)?;
        master
            .resize(to_pty_size(size.cols, size.rows))
            .map_err(|error| AppError::io(error.to_string()))
    }

    /// 换肤后已经跑起来的程序不会重新查色，但常驻 shell 里的下一个程序会。
    /// 这里不像 spawn 那样容忍坏值：单独一条命令失败没有副作用，静默吞掉只会让问题更难查。
    fn set_palette(&self, session_id: &str, palette: &TerminalPalette) -> Result<(), AppError> {
        let parsed = to_palette(palette).ok_or_else(|| {
            AppError::invalid_argument("terminal palette must be a pair of #rrggbb colors")
        })?;
        let session = self.session(session_id)?;
        *session.palette.write().unwrap() = Some(parsed);
        Ok(())
    }

    /// 立即返回：断开 PTY 让进程收到 SIGHUP，宽限与强杀交给后台线程。
    /// 前端不需要等待，真正的退出通过 Exit 事件异步送达。
    fn close(&self, session_id: &str) -> Result<(), AppError> {
        let session = self.session(session_id)?;
        disconnect(&session);
        if !session.closing.swap(true, Ordering::AcqRel) {
            let session = session.clone();
            thread::spawn(move || reap(&session, CLOSE_GRACE_PERIOD, KILL_GRACE_PERIOD));
        }
        Ok(())
    }

    /// 退出应用时必须同步收尾，否则窗口没了子进程还在。
    /// 先一次性断开全部会话，再共用同一个截止时刻等待，总耗时不随会话数增长。
    fn close_all(&self) {
        let sessions: Vec<_> = self.sessions.lock().unwrap().values().cloned().collect();
        for session in &sessions {
            disconnect(session);
            session.closing.store(true, Ordering::Release);
        }
        let deadline = Instant::now() + SHUTDOWN_GRACE_PERIOD;
        for session in &sessions {
            if wait_until(session, deadline) {
                continue;
            }
            *session.exit_reason.lock().unwrap() = TerminalExitReason::Terminated;
            let _ = session.killer.lock().unwrap().kill();
        }
        let kill_deadline = Instant::now() + KILL_GRACE_PERIOD;
        for session in &sessions {
            wait_until(session, kill_deadline);
        }
    }
}

/// 丢掉 writer 与 master：slave 端读到 EOF，前台进程组收到 SIGHUP。
/// 同时让后续 write 立刻失败，前端拿到的是"已退出"而不是静默丢字节。
fn disconnect(session: &NativeSession) {
    session.writer.lock().unwrap().take();
    session.master.lock().unwrap().take();
}

impl NativePtyBackend {
    fn session(&self, session_id: &str) -> Result<Arc<NativeSession>, AppError> {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .ok_or_else(AppError::process_exited)
    }
}

impl NativeSession {
    /// reader 线程回写 OSC 应答。会话已经断开就悄悄丢掉：这条路径上没有能上报错误的对端，
    /// 而且丢掉一条查不到答案的应答，后果只是子进程回落到它自己的默认色。
    fn reply(&self, bytes: &[u8]) {
        let mut writer = self.writer.lock().unwrap();
        let Some(writer) = writer.as_mut() else {
            return;
        };
        let _ = writer.write_all(bytes);
        let _ = writer.flush();
    }
}

fn spawn_reader(session_id: String, mut reader: Box<dyn Read + Send>, session: Arc<NativeSession>) {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; OUTPUT_CHUNK_SIZE];
        let mut filter = OscColorFilter::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    // 扣在过滤器里的残字节不能跟着 EOF 一起丢掉。
                    let held = filter.flush();
                    if !held.is_empty() {
                        let _ = send_output(&session_id, &session, held, false);
                    }
                    let _ = send_output(&session_id, &session, Vec::new(), true);
                    break;
                }
                Ok(count) => {
                    let palette = *session.palette.read().unwrap();
                    let filtered = filter.feed(&buffer[..count], palette);
                    if !filtered.reply.is_empty() {
                        session.reply(&filtered.reply);
                    }
                    // SSH 密码提示：命中就在本地回写一次密码，不经过前端。
                    if let Some(reply) = session
                        .auto_password
                        .lock()
                        .unwrap()
                        .as_mut()
                        .and_then(|responder| responder.on_output(&buffer[..count]))
                    {
                        session.reply(&reply);
                    }
                    // 整块都是查询时跳过：前端按 sequence 严格校验，少发一次比发个空事件干净。
                    if filtered.forward.is_empty() {
                        continue;
                    }
                    if send_output(&session_id, &session, filtered.forward, false).is_err() {
                        *session.exit_reason.lock().unwrap() = TerminalExitReason::IoFailed;
                        let _ = session.killer.lock().unwrap().kill();
                        break;
                    }
                }
                Err(_) => {
                    *session.exit_reason.lock().unwrap() = TerminalExitReason::IoFailed;
                    let _ = send_output(&session_id, &session, Vec::new(), true);
                    let _ = session.killer.lock().unwrap().kill();
                    break;
                }
            }
        }
        let mut done = session.reader_done.0.lock().unwrap();
        *done = true;
        session.reader_done.1.notify_all();
    });
}

fn to_palette(palette: &TerminalPalette) -> Option<Palette> {
    Palette::parse(&palette.foreground, &palette.background)
}

fn send_output(
    session_id: &str,
    session: &NativeSession,
    bytes: Vec<u8>,
    eof: bool,
) -> Result<(), AppError> {
    let sequence = session.sequence.fetch_add(1, Ordering::Relaxed);
    session.sink.send(TerminalEvent::Output {
        session_id: session_id.to_string(),
        sequence,
        bytes,
        eof,
    })
}

fn to_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}
