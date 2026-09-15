use super::super::{
    DaemonClient, endpoint,
    protocol::{Command, Endpoint},
    server, transport,
};
use super::probe::Probe;
use crate::terminal::{CreateTerminalRequest, backend::PtyBackend, contracts::TerminalStatus};
use std::{
    fs,
    path::PathBuf,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const WAIT_LIMIT: Duration = Duration::from_secs(10);
const WAIT_STEP: Duration = Duration::from_millis(10);
const SCRIPT_HEADER: &str = "set -eu\ntest -t 0\ntest -t 1\nstty -echo -onlcr\n\
    printf '%s' \"$$\" > pid\nprintf 'start\\n' >> starts\n";

pub(super) struct Fixture {
    pub client: DaemonClient,
    root: PathBuf,
    worker: Option<JoinHandle<Result<(), String>>>,
}

impl Fixture {
    pub fn new(script: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("belfry-native-ack-{}", ulid::Ulid::generate()));
        endpoint::private_directory(&root).unwrap();
        fs::write(root.join("qa.sh"), format!("{SCRIPT_HEADER}{script}")).unwrap();
        let server_root = root.clone();
        let fixture = Self {
            client: DaemonClient::new(root.clone()),
            root,
            worker: Some(thread::spawn(move || server::run(&server_root))),
        };
        // 先启动本 fixture 的生产 server，禁止 client 回退启动当前测试二进制。
        wait_for("private daemon readiness", || {
            endpoint::read(&fixture.root).is_ok_and(|endpoint| {
                transport::call::<serde_json::Value>(&endpoint, Command::Ping).is_ok()
            })
        });
        fixture
    }

    pub fn open(&self, attachment: Option<&str>) -> Probe {
        let mut request: CreateTerminalRequest = serde_json::from_value(serde_json::json!({
            "platform": "macos", "profileId": "shell:zsh", "tabId": "native-ack-qa",
            "cwd": crate::resource::path_to_file_uri(&self.root),
            "cols": 100, "rows": 30, "elevation": "normal"
        }))
        .unwrap();
        // -f 跳过用户 zsh 配置，再 exec 无启动配置的 bash；不写用户 shell 历史。
        request.launch_overlay.arguments = vec![
            "-f".into(),
            "-c".into(),
            "exec /bin/bash --noprofile --norc \"$1\"".into(),
            "native-ack-qa".into(),
            self.root.join("qa.sh").to_string_lossy().into_owned(),
        ];
        request.launch_overlay.unset = std::env::vars_os()
            .filter_map(|(key, _)| key.into_string().ok())
            .filter(|key| key.starts_with("BELFRY_") || key == "BASH_ENV" || key == "ENV")
            .collect();
        request.launch_overlay.attachment = attachment.map(str::to_owned);
        Probe::spawn(&self.client, request)
    }

    pub fn put(&self, name: &str, bytes: &[u8]) {
        fs::write(self.root.join(name), bytes).unwrap();
    }

    pub fn read(&self, name: &str) -> Vec<u8> {
        fs::read(self.root.join(name)).unwrap()
    }

    pub fn send_line(&self, id: &str, line: &str) {
        self.client
            .write(id, format!("{line}\r").as_bytes())
            .unwrap();
    }

    pub fn wait_file(&self, name: &str, expected: &[u8]) {
        wait_for(name, || {
            fs::read(self.root.join(name)).is_ok_and(|bytes| bytes == expected)
        });
    }

    pub fn wait_status(&self, id: &str, status: TerminalStatus) {
        wait_for("native process status", || {
            self.client
                .attachment(id)
                .is_ok_and(|info| info.session.status == status)
        });
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.client.detach_all();
        let endpoint: Result<Endpoint, _> = endpoint::read(&self.root);
        let stopped = endpoint.is_ok_and(|endpoint| {
            transport::call::<serde_json::Value>(&endpoint, Command::Shutdown).is_ok()
        });
        let worker = self.worker.take().unwrap();
        if stopped || worker.is_finished() {
            let result = worker.join();
            let _ = fs::remove_dir_all(&self.root);
            if !thread::panicking() {
                assert!(
                    matches!(result, Ok(Ok(()))),
                    "private daemon shutdown failed"
                );
            }
        } else if !thread::panicking() {
            panic!("private daemon shutdown failed: {}", self.root.display());
        }
    }
}

pub(super) fn wait_for(label: &str, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT_LIMIT;
    while !ready() {
        assert!(Instant::now() < deadline, "timed out: {label}");
        thread::sleep(WAIT_STEP);
    }
}

pub(super) fn payload() -> Vec<u8> {
    const LINES: usize = 12_000;
    (0..LINES)
        .flat_map(|line| format!("{line:05}|状态怀念𠀁|{:064}\n", line % 10).into_bytes())
        .collect()
}
