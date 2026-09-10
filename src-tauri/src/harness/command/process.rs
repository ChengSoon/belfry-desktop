use super::{CommandError, CommandResult, ExecResult};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const OUTPUT_LIMIT: usize = 1024 * 1024;
type Reader = JoinHandle<(String, bool)>;

pub(super) fn run(
    executable: &Path,
    argv: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
    timeout_ms: u64,
    cancelled: Arc<AtomicBool>,
    slot: Arc<Mutex<Option<Child>>>,
) -> CommandResult<ExecResult> {
    let started = Instant::now();
    let (child, out, err) = spawn(executable, argv, cwd, env)?;
    *slot.lock().unwrap() = Some(child);
    let reason = wait(&slot, &cancelled, timeout_ms, started)?;
    let status = slot
        .lock()
        .unwrap()
        .take()
        .unwrap()
        .wait()
        .map_err(|_| CommandError::new("WAIT_FAILED", "command wait failed"))?;
    let (stdout, stdout_truncated) = out.join().unwrap_or_default();
    let (stderr, stderr_truncated) = err.join().unwrap_or_default();
    Ok(ExecResult {
        exit_code: status.code(),
        signal: signal(&status),
        termination_reason: reason,
        duration_ms: elapsed(started),
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    })
}

fn spawn(
    executable: &Path,
    argv: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
) -> CommandResult<(Child, Reader, Reader)> {
    let mut command = Command::new(executable);
    command
        .args(argv)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| CommandError::new("SPAWN_FAILED", "command could not start"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::new("SPAWN_FAILED", "stdout unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CommandError::new("SPAWN_FAILED", "stderr unavailable"))?;
    Ok((
        child,
        thread::spawn(move || read_bounded(stdout)),
        thread::spawn(move || read_bounded(stderr)),
    ))
}

fn wait(
    slot: &Arc<Mutex<Option<Child>>>,
    cancelled: &AtomicBool,
    timeout_ms: u64,
    started: Instant,
) -> CommandResult<String> {
    loop {
        if cancelled.load(Ordering::SeqCst) {
            terminate(slot);
            return Ok("cancelled".into());
        }
        let finished = slot
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .try_wait()
            .map_err(|_| CommandError::new("WAIT_FAILED", "command wait failed"))?
            .is_some();
        if finished {
            return Ok("exited".into());
        }
        if elapsed(started) >= timeout_ms {
            terminate(slot);
            return Ok("timeout".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub(super) fn terminate(slot: &Arc<Mutex<Option<Child>>>) {
    if let Some(child) = slot.lock().unwrap().as_mut() {
        kill_tree(child);
    }
}

fn read_bounded(mut reader: impl Read) -> (String, bool) {
    let mut kept = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let room = OUTPUT_LIMIT.saturating_sub(kept.len());
                kept.extend_from_slice(&buffer[..count.min(room)]);
                truncated |= count > room;
            }
        }
    }
    (String::from_utf8_lossy(&kept).into_owned(), truncated)
}

fn elapsed(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(unix)]
fn configure_tree(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
}
#[cfg(windows)]
fn configure_tree(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0000_0200);
}
#[cfg(unix)]
fn kill_tree(child: &mut Child) {
    unsafe {
        kill(-(child.id() as i32), 9);
    }
}
#[cfg(windows)]
fn kill_tree(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .env_clear()
        .status();
}
#[cfg(unix)]
fn signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}
#[cfg(not(unix))]
fn signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}
#[cfg(unix)]
unsafe extern "C" {
    fn setpgid(pid: i32, pgid: i32) -> i32;
    fn kill(pid: i32, signal: i32) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[test]
    fn output_is_utf8_safe_and_bounded() {
        let input = vec![b'x'; OUTPUT_LIMIT + 7];
        let (value, truncated) = read_bounded(input.as_slice());
        assert_eq!(value.len(), OUTPUT_LIMIT);
        assert!(truncated);
        let (value, _) = read_bounded(&[0xff, b'a'][..]);
        assert!(value.ends_with('a'));
    }

    #[cfg(unix)]
    #[test]
    fn capture_separates_streams_and_clears_environment() {
        let result = run(
            Path::new("/bin/sh"),
            &["-c".into(), "printf out; printf err >&2; env".into()],
            Path::new("/tmp"),
            &HashMap::from([("TZ".into(), "UTC".into())]),
            1000,
            Arc::new(AtomicBool::new(false)),
            Arc::new(Mutex::new(None)),
        )
        .unwrap();
        assert!(result.stdout.starts_with("out"));
        assert_eq!(result.stderr, "err");
        assert!(!result.stdout.contains("HOME="));
        assert!(!result.stdout.to_ascii_uppercase().contains("TOKEN="));
    }

    #[cfg(unix)]
    #[test]
    fn timeout_kills_the_entire_process_group() {
        let marker = std::env::temp_dir().join(format!("belfry-tree-{}", ulid::Ulid::generate()));
        let script = format!("(sleep 0.2; touch '{}') & wait", marker.display());
        let result = run(
            Path::new("/bin/sh"),
            &["-c".into(), script],
            Path::new("/tmp"),
            &HashMap::new(),
            20,
            Arc::new(AtomicBool::new(false)),
            Arc::new(Mutex::new(None)),
        )
        .unwrap();
        assert_eq!(result.termination_reason, "timeout");
        thread::sleep(Duration::from_millis(300));
        assert!(!marker.exists());
    }
}
