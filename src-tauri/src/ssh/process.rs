use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{atomic::{AtomicBool, Ordering}, mpsc::{self, Receiver}};
use std::time::{Duration, Instant};
use crate::terminal::AppError;

const OUTPUT_LIMIT: usize = 128 * 1024;
const ERROR_LIMIT: usize = 16 * 1024;
const READ_BUFFER: usize = 8192;
const POLL: Duration = Duration::from_millis(10);
const DRAIN: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub(super) struct Output { pub status: ExitStatus, pub bytes: Vec<u8>, pub error: String }
type Captured = Receiver<std::io::Result<(Vec<u8>, bool)>>;

pub(super) fn run(mut command: Command, cancelled: &AtomicBool, timeout: Duration) -> Result<Output, AppError> {
    if cancelled.load(Ordering::Acquire) { return Err(AppError::io("SSH 请求已取消")); }
    configure(&mut command);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| AppError::io(format!("无法启动 OpenSSH：{error}")))?;
    let stdout = capture(child.stdout.take().expect("piped stdout"), OUTPUT_LIMIT);
    let stderr = capture(child.stderr.take().expect("piped stderr"), ERROR_LIMIT);
    let result = wait(&mut child, cancelled, timeout);
    if result.is_err() { terminate(&mut child); let _ = child.wait(); }
    let status = result?;
    let output = collect(stdout, stderr, status);
    if output.is_err() { terminate(&mut child); }
    output
}

fn wait(child: &mut Child, cancelled: &AtomicBool, timeout: Duration) -> Result<ExitStatus, AppError> {
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::Acquire) { return Err(AppError::io("SSH 请求已取消")); }
        if started.elapsed() >= timeout { return Err(AppError::io("SSH 请求超时，请检查网络、跳板机或主机地址")); }
        if let Some(status) = child.try_wait().map_err(|error| AppError::io(error.to_string()))? { return Ok(status); }
        std::thread::sleep(POLL);
    }
}

fn capture(mut reader: impl Read + Send + 'static, limit: usize) -> Captured {
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| {
            let mut bytes = Vec::new();
            let mut buffer = [0; READ_BUFFER];
            let mut truncated = false;
            loop {
                let count = reader.read(&mut buffer)?;
                if count == 0 { break; }
                let kept = count.min(limit.saturating_sub(bytes.len()));
                bytes.extend_from_slice(&buffer[..kept]); truncated |= kept < count;
            }
            Ok((bytes, truncated))
        })();
        let _ = send.send(result);
    });
    receive
}

fn collect(stdout: Captured, stderr: Captured, status: ExitStatus) -> Result<Output, AppError> {
    let (bytes, truncated) = receive(stdout)?;
    let (error, error_truncated) = receive(stderr)?;
    if truncated { return Err(AppError::io("远端响应超过大小上限，请选择更具体的目录")); }
    let mut error = String::from_utf8_lossy(&error).into_owned();
    if error_truncated { error.push_str("\n（错误输出已截断）"); }
    Ok(Output { status, bytes, error })
}

fn receive(reader: Captured) -> Result<(Vec<u8>, bool), AppError> {
    reader.recv_timeout(DRAIN).map_err(|_| AppError::io("SSH 输出读取未结束，已停止本次请求"))?
        .map_err(|error| AppError::io(format!("SSH 输出读取失败：{error}")))
}

#[cfg(unix)]
fn configure(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(unix)]
fn terminate(child: &mut Child) {
    const SIGKILL: i32 = 9;
    unsafe extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
    // 只终止本次请求创建的进程组，包含 OpenSSH 自行启动的跳板命令。
    unsafe { kill(-(child.id() as i32), SIGKILL); }
}

#[cfg(windows)]
fn terminate(child: &mut Child) {
    let mut command = Command::new("taskkill.exe"); configure(&mut command);
    let _ = command.args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    let _ = child.kill();
}
