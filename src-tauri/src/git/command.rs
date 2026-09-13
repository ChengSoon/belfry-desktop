use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::terminal::AppError;

const TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(10);
const STDERR_LIMIT: usize = 32 * 1024;
const READ_BUFFER_BYTES: usize = 8192;
const REPOSITORY_ENV: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT",
];

pub(super) struct Output {
    pub status: ExitStatus,
    pub bytes: Vec<u8>,
    pub error: String,
    pub truncated: bool,
}

type Reader = JoinHandle<std::io::Result<(Vec<u8>, bool)>>;

pub(super) fn run(root: &Path, args: &[&str], limit: usize) -> Result<Output, AppError> {
    let mut command = git_command(root, args);
    configure(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| AppError::io(format!("无法启动 Git：{error}")))?;
    let stdout = capture(child.stdout.take().expect("piped stdout"), limit);
    let stderr = capture(child.stderr.take().expect("piped stderr"), STDERR_LIMIT);
    let result = wait(&mut child);
    if result.is_err() {
        terminate(&mut child);
        let _ = child.wait();
    }
    let (bytes, truncated) = collected(stdout)?;
    let (error, _) = collected(stderr)?;
    Ok(Output {
        status: result?,
        bytes,
        error: String::from_utf8_lossy(&error).into_owned(),
        truncated,
    })
}

fn git_command(root: &Path, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command
        .args([
            "--no-pager",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.quotepath=false",
        ])
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in REPOSITORY_ENV {
        command.env_remove(key);
    }
    if let Some(path) = crate::agent::login_shell_env().get("PATH") {
        command.env("PATH", path);
    }
    command
}

fn wait(child: &mut Child) -> Result<ExitStatus, AppError> {
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| AppError::io(error.to_string()))?
        {
            return Ok(status);
        }
        if started.elapsed() >= TIMEOUT {
            return Err(AppError::io("Git 读取超时，请稍后刷新"));
        }
        thread::sleep(POLL);
    }
}

fn capture(reader: impl Read + Send + 'static, limit: usize) -> Reader {
    thread::spawn(move || bounded_read(reader, limit))
}

fn bounded_read(mut reader: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    let mut buffer = [0; READ_BUFFER_BYTES];
    let mut truncated = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        let kept = count.min(limit.saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..kept]);
        truncated |= kept < count;
    }
    Ok((bytes, truncated))
}

fn collected(reader: Reader) -> Result<(Vec<u8>, bool), AppError> {
    reader
        .join()
        .map_err(|_| AppError::io("Git 输出读取中断"))?
        .map_err(|error| AppError::io(format!("Git 输出读取失败：{error}")))
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
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    // 仅终止本次读取创建的进程组，包含 Git 自己启动的子模块读取。
    unsafe {
        kill(-(child.id() as i32), SIGKILL);
    }
}

#[cfg(windows)]
fn terminate(child: &mut Child) {
    let mut command = Command::new("taskkill.exe");
    configure(&mut command);
    let _ = command
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_retained_output_but_drains_the_pipe() {
        let source = vec![b'x'; READ_BUFFER_BYTES * 3];
        let (output, truncated) = bounded_read(source.as_slice(), 10).unwrap();
        assert_eq!(vec![b'x'; 10], output);
        assert!(truncated);
    }
}
