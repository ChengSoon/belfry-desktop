//! Real PTY evidence for a room whose selected project differs from the active project.
use std::fs;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::{RecordingSink, default_request, lock_native_test, output_bytes, wait_for_terminal};
use crate::project::commands::project_open;
use crate::resource::{canonicalize, path_to_file_uri};
use crate::rooms::{RoomStore, test_support};
use crate::terminal::{TerminalEvent, backend::PtyBackend, native::NativePtyBackend};

const PROBE_REPORT: &str = "BELFRY_ROOM_NATIVE_PROBE_REPORT";
const OUTPUT_MARKER: &str = "__BELFRY_ROOM_NATIVE__";

struct Fixture {
    root: PathBuf,
    backend: NativePtyBackend,
    pids: Vec<u32>,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("belfry-room-native-{}", ulid::Ulid::generate()));
        for directory in [
            "app-data/rooms",
            "app-data/probes",
            "app-data/shell",
            "当前 项目 A",
            "房间 项目 B/选择 子目录",
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        Self {
            root,
            backend: NativePtyBackend::default(),
            pids: Vec::new(),
        }
    }

    fn store(&self) -> RoomStore {
        RoomStore::load(Some(self.root.join("app-data/rooms")))
    }

    fn launch(&mut self, project_root: &str, member: &str) -> Value {
        let report_path = self
            .root
            .join("app-data/probes")
            .join(format!("{member}.json"));
        let mut request = default_request();
        request.tab_id = Some(member.into());
        request.cwd = Some(path_to_file_uri(Path::new(project_root)));
        // Keep the JSON record on one ConPTY line, including long Windows temporary paths.
        request.cols = 1024;
        request.launch_overlay.unset = std::env::vars_os()
            .filter_map(|(key, _)| key.into_string().ok())
            .filter(|key| key.starts_with("BELFRY_") || key == "BASH_ENV" || key == "ENV")
            .collect();
        request.launch_overlay.environment.extend([
            (
                PROBE_REPORT.into(),
                report_path.to_string_lossy().into_owned(),
            ),
            (
                "BELFRY_ROOM_NATIVE_PROBE_EXE".into(),
                std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            ),
            ("BELFRY_ROOM_NATIVE_MEMBER".into(), member.into()),
            (
                "ZDOTDIR".into(),
                self.root
                    .join("app-data/shell")
                    .to_string_lossy()
                    .into_owned(),
            ),
        ]);
        #[cfg(target_os = "macos")]
        {
            request.profile_id = "shell:zsh".into();
            request.launch_overlay.arguments = vec!["-f".into(), "-c".into(),
                "export BELFRY_ROOM_NATIVE_SHELL_PID=$$; exec \"$BELFRY_ROOM_NATIVE_PROBE_EXE\" --exact terminal::native_tests::room_project::probe_process --nocapture".into()];
        }
        #[cfg(target_os = "windows")]
        {
            request.profile_id = "shell:powershell".into();
            request.launch_overlay.arguments = vec!["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(),
                "$env:BELFRY_ROOM_NATIVE_SHELL_PID=[string]$PID; & $env:BELFRY_ROOM_NATIVE_PROBE_EXE --exact terminal::native_tests::room_project::probe_process --nocapture; exit $LASTEXITCODE".into()];
        }
        let sink = Arc::new(RecordingSink::default());
        let session = self.backend.spawn(request, sink.clone()).unwrap();
        assert_eq!(session.cwd, path_to_file_uri(Path::new(project_root)));
        assert!(
            wait_for_terminal(
                &self.backend,
                &session.id,
                &sink,
                Duration::from_secs(20),
                |events| {
                    events
                        .iter()
                        .any(|event| matches!(event, TerminalEvent::Exit { .. }))
                }
            ),
            "member {member} did not exit"
        );
        let events = sink.events.lock().unwrap();
        let exits: Vec<_> = events
            .iter()
            .filter_map(|event| match event {
                TerminalEvent::Exit { exit_code, .. } => Some(*exit_code),
                _ => None,
            })
            .collect();
        let bytes = output_bytes(&events);
        let output = String::from_utf8_lossy(&bytes);
        assert_eq!(exits, [0], "{member}: {output}");
        let output = regex::Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]")
            .unwrap()
            .replace_all(&output, "");
        let record = output
            .split_once(OUTPUT_MARKER)
            .unwrap_or_else(|| panic!("missing PTY evidence: {output}"))
            .1;
        let observed: Value = serde_json::Deserializer::from_str(record)
            .into_iter()
            .next()
            .unwrap()
            .unwrap();
        let file: Value = serde_json::from_slice(&fs::read(&report_path).unwrap()).unwrap();
        assert_eq!(
            observed, file,
            "PTY output must match the child-written report"
        );
        for field in ["pid", "shellPid"] {
            let pid = u32::try_from(observed[field].as_u64().unwrap()).unwrap();
            assert!(pid > 0 && pid != std::process::id());
            if !self.pids.contains(&pid) {
                self.pids.push(pid);
                wait_for_pid_exit(pid);
            }
        }
        assert_eq!(observed["member"], member);
        assert_eq!(
            canonicalize(Path::new(observed["cwd"].as_str().unwrap())).unwrap(),
            Path::new(project_root)
        );
        assert_eq!(observed["stdinTerminal"], true);
        assert_eq!(observed["stdoutTerminal"], true);
        eprintln!(
            "room project native member: {}",
            json!({
                "sessionId": session.id, "expectedCwd": project_root, "observed": observed,
                "exitCode": 0, "processesExited": true,
            })
        );
        observed
    }

    fn cleanup(&mut self) {
        self.backend.close_all();
        for &pid in &self.pids {
            wait_for_pid_exit(pid);
        }
        remove_fixture(&self.root).unwrap();
        assert!(!self.root.exists());
        eprintln!(
            "room project native cleanup: {}",
            json!({
                "root": self.root, "pids": self.pids, "processesExited": true, "removed": true,
            })
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.backend.close_all();
        if let Err(error) = remove_fixture(&self.root) {
            eprintln!(
                "native room fixture cleanup failed at {}: {error}",
                self.root.display()
            );
        }
    }
}

#[test]
fn room_project_native_members_use_persisted_selected_project() {
    let _guard = lock_native_test();
    // Positive control for the OS process lookup used to verify cleanup.
    assert!(pid_exists(std::process::id()));
    let mut fixture = Fixture::new();
    let active = project_open(Some(
        fixture
            .root
            .join("当前 项目 A")
            .to_string_lossy()
            .into_owned(),
    ))
    .unwrap();
    let selected_path = fixture.root.join("房间 项目 B/选择 子目录/..");
    let selected = project_open(Some(selected_path.to_string_lossy().into_owned())).unwrap();
    assert_eq!(
        Path::new(&selected.root_path),
        canonicalize(&fixture.root.join("房间 项目 B")).unwrap()
    );
    assert_ne!(active.root_path, selected.root_path);
    let active_process = fixture.launch(&active.root_path, "active-project-control");
    let store = fixture.store();
    let room = store
        .create(
            "跨项目原生成员",
            &selected.root_path,
            "Record actual process cwd",
        )
        .unwrap();
    // Launch from the reloaded room, exercising the persisted path used by launchInto.
    let persisted = fixture.store().get(&room.id).unwrap();
    assert_eq!(persisted.project_root, selected.root_path);
    assert_ne!(persisted.project_root, active.root_path);
    for index in 0..3 {
        let member = format!("native-member-{index}");
        let observed = fixture.launch(&persisted.project_root, &member);
        assert_ne!(observed["cwd"], active_process["cwd"]);
        store
            .mutate(&room.id, |room| {
                test_support::add(room, &member, &format!("成员{index}"), "cwd probe")
            })
            .unwrap();
    }
    let reloaded = fixture.store().get(&room.id).unwrap();
    assert_eq!(reloaded.active_members().count(), 3);
    assert_eq!(reloaded.project_root, selected.root_path);
    eprintln!(
        "room project native persisted: {}",
        json!({
            "platform": std::env::consts::OS, "appData": fixture.root.join("app-data"),
            "activeProject": active.root_path, "selectedInput": selected_path,
            "roomProject": reloaded.project_root, "memberCount": reloaded.active_members().count(),
        })
    );
    fixture.cleanup();
}

#[test]
fn room_project_native_rejects_a_directory_removed_after_selection() {
    let mut fixture = Fixture::new();
    let project = fixture.root.join("房间 项目 B");
    let selected = project_open(Some(project.to_string_lossy().into_owned())).unwrap();
    fs::remove_dir_all(&project).unwrap();
    let store = fixture.store();
    let error = store
        .create("Disappeared project", &selected.root_path, "")
        .unwrap_err();
    assert_eq!(error.code.0, "ROOM_PROJECT_NOT_FOUND");
    assert!(store.list().unwrap().rooms.is_empty());
    assert!(!fixture.root.join("app-data/rooms/rooms.json").exists());
    eprintln!(
        "room project native stale selection: {}",
        json!({
            "selectedProject": selected.root_path, "error": error.code.0, "persisted": false,
        })
    );
    fixture.cleanup();
}

// Invoked with --exact inside each real PTY; the ordinary suite does no child work here.
#[test]
fn probe_process() {
    let Some(path) = std::env::var_os(PROBE_REPORT) else {
        return;
    };
    assert!(std::env::var_os("BELFRY_ENDPOINT").is_none());
    assert!(std::env::var_os("BELFRY_TOKEN").is_none());
    let report = json!({
        "member": std::env::var("BELFRY_ROOM_NATIVE_MEMBER").unwrap(),
        "pid": std::process::id(),
        "shellPid": std::env::var("BELFRY_ROOM_NATIVE_SHELL_PID").unwrap().parse::<u32>().unwrap(),
        "cwd": std::env::current_dir().unwrap(),
        "stdinTerminal": std::io::stdin().is_terminal(),
        "stdoutTerminal": std::io::stdout().is_terminal(),
    });
    fs::write(path, serde_json::to_vec(&report).unwrap()).unwrap();
    println!("{OUTPUT_MARKER}{report}");
}

fn wait_for_pid_exit(pid: u32) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while pid_exists(pid) {
        assert!(
            Instant::now() < deadline,
            "native room process {pid} remains alive"
        );
        thread::sleep(Duration::from_millis(50));
    }
}

fn pid_exists(pid: u32) -> bool {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "pid="])
            .output()
            .unwrap();
        assert!(output.status.success() || output.status.code() == Some(1));
        String::from_utf8_lossy(&output.stdout)
            .split_whitespace()
            .any(|value| value == pid.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new("tasklist.exe")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success(), "tasklist failed: {output:?}");
        String::from_utf8_lossy(&output.stdout).lines().any(|line| {
            line.split(',')
                .nth(1)
                .is_some_and(|value| value.trim_matches('"') == pid.to_string())
        })
    }
}

fn remove_fixture(root: &Path) -> std::io::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match fs::remove_dir_all(root) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) if Instant::now() >= deadline => return Err(error),
            Err(_) => thread::sleep(Duration::from_millis(100)),
        }
    }
}
