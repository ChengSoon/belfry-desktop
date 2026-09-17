//! 后台执行 `npm install -g`，把日志末尾带回前端。
//!
//! npm 自身以非零码退出算 `success: false` 而不是 `Err`——这样前端能把日志摊开
//! 给用户看并给出「在终端中重试」。只有「找不到 npm」「锁冲突」这类才走 `Err`。

use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::agent::detection::{find_agent, find_in_path, find_in_user_environment};
use crate::agent::AgentKind;
use crate::setup::process::{command_for, first_output_line};
use crate::terminal::AppError;

use super::contracts::AgentReleaseInstall;

const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// npm 全局安装慢起来没有上限（ registry 抽风、磁盘满），给十分钟再杀掉。
const TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// 带回前端的日志行数。完整日志经常几千行，前端只需要看尾巴。
const LOG_TAIL_LINES: usize = 24;

/// 进程内只允许一个安装任务，避免两个 npm 抢同一个全局目录互相踩。
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn install(kind: AgentKind, package: &str) -> Result<AgentReleaseInstall, AppError> {
    let _guard = INSTALL_LOCK
        .try_lock()
        .map_err(|_| AppError::unsupported("已有安装任务在进行中"))?;

    let npm = find_npm()
        .ok_or_else(|| AppError::not_found("未找到 npm，请确认 Node.js 已安装并在登录 shell 的 PATH 中"))?;

    let mut command = command_for(&npm);
    command.args(["install", "-g", &format!("{package}@latest"), "--no-fund", "--no-audit"]);
    command.env("NO_COLOR", "1");
    if let Some(path) = crate::agent::login_shell_env().get("PATH") {
        command.env("PATH", path);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| AppError::io(format!("无法启动 npm：{error}")))?;
    // 各起一个 reader 线程读到 EOF：只轮询 try_wait 而不排空管道，
    // 会在缓冲区写满时死锁，npm 安装输出很长时必现。
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            // 进程还没退出，继续等；try_wait 拿不到结果不会阻塞。
            Ok(None) => {}
            Ok(status) => break status,
            Err(error) => {
                let _ = child.kill();
                let _ = stdout.join();
                let _ = stderr.join();
                return Err(AppError::io(format!("等待 npm 退出失败：{error}")));
            }
        }
        if started.elapsed() >= TIMEOUT {
            let _ = child.kill();
            break child.wait().ok();
        }
        std::thread::sleep(POLL_INTERVAL);
    };

    let mut log = String::new();
    if let Ok(bytes) = stdout.join() {
        log.push_str(&String::from_utf8_lossy(&bytes));
    }
    if let Ok(bytes) = stderr.join() {
        log.push_str(&String::from_utf8_lossy(&bytes));
    }
    let success = status.map(|status| status.success()).unwrap_or(false);
    let log = tail(&log, LOG_TAIL_LINES);

    // 安装/升级成功后立刻重测版本，让卡片即时刷新而不是停在旧值上。
    let version = find_agent(kind)
        .and_then(|path| crate::setup::process::run(&path, &["--version"]).ok())
        .and_then(|output| first_output_line(&output));

    Ok(AgentReleaseInstall {
        kind,
        package: package.to_string(),
        success,
        version,
        log,
    })
}

fn find_npm() -> Option<PathBuf> {
    find_in_path("npm").or_else(|| find_in_user_environment("npm"))
}

/// 把子进程的输出读到 EOF 后整体返回，避免管道缓冲区写满导致死锁。
fn drain<S: Read + Send + 'static>(stream: Option<S>) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut stream) = stream {
            let _ = stream.read_to_end(&mut buffer);
        }
        buffer
    })
}

/// 取日志末尾若干行，并裁掉过长的单行（进度条、base64 之类）。
fn tail(log: &str, lines: usize) -> String {
    let mut kept: Vec<&str> = Vec::new();
    for line in log.lines().rev() {
        if kept.len() >= lines {
            break;
        }
        kept.push(line);
    }
    kept.reverse();
    kept.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_keeps_the_last_lines_in_order() {
        let log = "line one\nline two\nline three";
        assert_eq!(tail(log, 2), "line two\nline three");
        assert_eq!(tail(log, 10), log);
    }

    #[test]
    fn tail_handles_empty_log() {
        assert_eq!(tail("", 5), "");
    }

    #[test]
    fn lock_is_reentrant_within_a_single_task() {
        // 同一线程持有锁后再次获取必须成功，否则命令实现自身会自我死锁。
        let guard = INSTALL_LOCK.try_lock();
        assert!(guard.is_ok(), "首次加锁必须成功");
        let second = INSTALL_LOCK.try_lock();
        assert!(second.is_err(), "已有任务在跑时必须拒绝第二个");
        drop(guard);
        assert!(INSTALL_LOCK.try_lock().is_ok(), "释放后必须能再次加锁");
    }
}
