//! A release gets its own daemon; a live PTY always stays with the process that owns it.
use super::{
    endpoint,
    protocol::{Command, Endpoint, FLAG},
    transport,
};
use std::{
    path::{Path, PathBuf},
    process::{Command as Process, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(super) fn compatible(reply: &serde_json::Value, version: &str) -> bool {
    reply["appVersion"].as_str() == Some(version)
        && reply["retiring"] != true
        && reply["capabilities"].as_array().is_some_and(|items| {
            ["terminal_program_status_v1", "terminal_input_continuity_v1", "rolling_upgrade_v1"]
                .iter()
                .all(|required| items.iter().any(|item| item == required))
        })
}

pub(super) fn supersedes(reply: &serde_json::Value, version: &str) -> bool {
    fn stable(value: &str) -> Option<[u64; 3]> {
        let parts: Vec<u64> = value
            .split('.')
            .map(str::parse)
            .collect::<Result<_, _>>()
            .ok()?;
        parts.try_into().ok()
    }
    // A still-open older app must never retire the newer daemon. Unknown/custom builds stay alive.
    matches!((reply["appVersion"].as_str().and_then(stable), stable(version)),
        (Some(old), Some(current)) if old < current)
}

fn roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![root.to_owned()]; // Includes the daemon used before rolling upgrades.
    if let Ok(entries) = std::fs::read_dir(root.join("versions")) {
        roots.extend(
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path()),
        );
    }
    roots
}

pub(super) fn online(root: &Path) -> Vec<(Endpoint, serde_json::Value)> {
    if root.as_os_str().is_empty() {
        return Vec::new();
    }
    roots(root)
        .into_iter()
        .filter_map(|root| {
            let endpoint = endpoint::read(&root).ok()?;
            let reply = transport::call(&endpoint, Command::Ping).ok()?;
            Some((endpoint, reply))
        })
        .collect()
}

pub(super) fn connect_or_start(root: &Path) -> Result<Endpoint, String> {
    connect(root, env!("CARGO_PKG_VERSION"), start)
}

fn connect(
    root: &Path,
    version: &str,
    start: impl FnOnce(&Path) -> Result<Endpoint, String>,
) -> Result<Endpoint, String> {
    // Prefer this release's directory even after the legacy daemon has exited.
    let mut current = root.join("versions").join(version);
    let mut candidates = vec![current.clone(), root.to_owned()];
    candidates.extend(
        roots(root)
            .into_iter()
            .skip(1)
            .filter(|path| path != &current),
    );
    for candidate in &candidates {
        if let Ok(endpoint) = endpoint::read(candidate) {
            if let Ok(reply) = transport::call::<serde_json::Value>(&endpoint, Command::Ping) {
                if compatible(&reply, version) {
                    return Ok(endpoint);
                }
                if candidate == &current {
                    // A rollback or same-version incompatible build can still own this directory.
                    current = root
                        .join("versions")
                        .join(format!("{version}-{}", ulid::Ulid::generate()));
                }
            }
        }
    }
    endpoint::private_directory(root)?;
    endpoint::private_directory(&root.join("versions"))?;
    endpoint::private_directory(&current)?;
    start(&current)
}

fn start(root: &Path) -> Result<Endpoint, String> {
    let mut command = Process::new(std::env::current_exe().map_err(|error| error.to_string())?);
    command
        .arg(FLAG)
        .arg(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动终端后台：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Ok(endpoint) = endpoint::read(root) {
            if let Ok(reply) = transport::call::<serde_json::Value>(&endpoint, Command::Ping) {
                if compatible(&reply, env!("CARGO_PKG_VERSION")) {
                    thread::spawn(move || {
                        let _ = child.wait();
                    });
                    return Ok(endpoint);
                }
            }
        }
        if Instant::now() >= deadline {
            break;
        }
        let _ = child.try_wait();
        thread::sleep(Duration::from_millis(40));
    }
    // Do not kill either daemon or fall back to an incompatible one.
    thread::spawn(move || {
        let _ = child.wait();
    });
    Err("终端后台未就绪，可能有不兼容的旧后台仍在运行。原任务已保留。".into())
}

fn detach_process(command: &mut Process) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe extern "C" {
            fn setsid() -> i32;
        }
        unsafe {
            command.pre_exec(|| {
                if setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008 | 0x0000_0200); // Detached, new process group.
    }
}

#[cfg(test)]
#[path = "generations_tests.rs"]
mod tests;
