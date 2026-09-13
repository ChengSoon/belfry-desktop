use super::*;
use crate::terminal::SshTarget;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn target(path: Option<&str>) -> SshTarget {
    SshTarget { host: "jump-alias".into(), user: Some("dev".into()), port: Some(2222),
        password: None, remember_password: None, remote_path: path.map(str::to_string) }
}

#[test]
fn keeps_remote_directory_separate_and_quotes_shell_metacharacters() {
    let path = "/项目/John's folder/$(touch should-not-run)";
    let args = remote::launch_arguments(&target(Some(path)));
    assert_eq!(&["-p", "2222", "-t", "dev@jump-alias"], &args[..4]);
    assert!(args[4].contains("'\"'\"'"));
    let script = remote::directory_script(Some(path), false);
    assert!(script.contains("'\"'\"'"));
    for bad in ["relative", "~/work", "/line\nnext", "/x\0y"] {
        assert!(remote::validate_remote_path(Some(bad)).is_err());
    }
}

#[test]
fn empty_remote_path_preserves_original_ssh_arguments() {
    assert_eq!(vec!["-p", "2222", "dev@jump-alias"], remote::launch_arguments(&target(None)));
}

#[test]
fn diagnostic_is_noninteractive_and_keeps_strict_host_verification() {
    let args = remote::probe_arguments(&target(None), false);
    for flag in ["BatchMode=yes", "StrictHostKeyChecking=yes", "ConnectTimeout=8", "ControlPath=none"] {
        assert!(args.iter().any(|value| value == flag));
    }
    assert!(!args.iter().any(|value| value.contains("password")));
}

#[test]
fn parses_framed_unicode_directory_output_and_reports_truncation() {
    let result = remote::parse_output(b"BELFRY_SSH_1\0/home/dev\0d\0one space\0d\0other\0t\0").unwrap();
    assert_eq!("/home/dev", result.path);
    assert_eq!(vec!["one space", "other"], result.directories);
    assert!(result.truncated);
    for bad in [b"banner\n".as_slice(), b"BELFRY_SSH_1\0relative\0", b"BELFRY_SSH_1\0/work\0d\0../outside\0"] {
        assert!(remote::parse_output(bad).is_err());
    }
}

#[cfg(unix)]
#[test]
fn directory_listing_does_not_execute_path_contents() {
    use std::fs;
    use std::process::Command;
    let base = std::env::temp_dir().join(format!("belfry-ssh-{}", ulid::Ulid::generate()));
    let root = base.join("项目 John's $(touch owned)");
    fs::create_dir_all(root.join("child 空格")).unwrap();
    fs::create_dir(root.join(".hidden")).unwrap();
    let script = remote::directory_script(root.to_str(), true);
    let output = Command::new("/bin/sh").arg("-c").arg(script).current_dir(&base).output().unwrap();
    assert!(output.status.success());
    let report = remote::parse_output(&output.stdout).unwrap();
    assert_eq!(vec![".hidden", "child 空格"], report.directories);
    assert!(!base.join("owned").exists());
    fs::remove_dir_all(base).unwrap();
}

#[cfg(unix)]
#[test]
fn cancellation_and_timeout_terminate_only_the_managed_process_group() {
    for cancelled in [true, false] {
        let flag = Arc::new(AtomicBool::new(false));
        let signal = flag.clone();
        if cancelled {
            std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(40)); signal.store(true, Ordering::Release); });
        }
        let mut command = std::process::Command::new("/bin/sh");
        command.args(["-c", "sleep 30 & wait"]);
        let started = Instant::now();
        let result = process::run(command, &flag, Duration::from_millis(150));
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(result.unwrap_err().message.contains(if cancelled { "取消" } else { "超时" }));
    }
}

#[test]
fn cancellation_marks_exact_request_and_rejects_duplicate_ids() {
    let requests = SshRequests::default();
    let first = requests.begin("first").unwrap();
    let second = requests.begin("second").unwrap();
    assert!(requests.begin("first").is_err());
    requests.cancel("first");
    assert!(first.load(Ordering::Acquire));
    assert!(!second.load(Ordering::Acquire));
    requests.finish("first");
    assert!(requests.begin("first").is_ok());
    requests.cancel("early");
    assert!(requests.begin("early").unwrap_err().message.contains("取消"));
}
