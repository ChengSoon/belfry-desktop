use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-logging-{}", ulid::Ulid::generate()));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
    fn store(&self) -> LogStore {
        LogStore::new(self.0.join("logs"))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn entry(message: &str) -> LogEntry {
    LogEntry {
        level: LogLevel::Error,
        source: "frontend.errorBoundary".into(),
        message: message.into(),
        stack: None,
        context: BTreeMap::new(),
    }
}

#[test]
fn records_survive_reload_and_roll_at_utc_midnight() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let day = 1_794_096_000;
    store.write(entry("first"), day).unwrap();
    store.write(entry("second"), day + 86400).unwrap();
    let reloaded = fixture.store();
    let files = reloaded.files().unwrap();
    assert_eq!(files.len(), 2, "跨日必须新建文件，不能只写 stderr");
    let destination = fixture.0.join("diagnostics.json");
    reloaded.export(&destination, day + 86400).unwrap();
    let value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(destination).unwrap()).unwrap();
    assert_eq!(value["logs"][0]["message"], "first");
    assert_eq!(value["logs"][1]["message"], "second");
}

#[test]
fn sustained_logging_and_expired_days_stay_within_disk_budget() {
    let fixture = Fixture::new();
    let store = LogStore {
        file_bytes: 512,
        total_bytes: 1536,
        ..fixture.store()
    };
    let day = 1_794_096_000;
    for index in 0..100 {
        store
            .write(entry(&format!("{index}:{}", "中".repeat(40))), day)
            .unwrap();
    }
    let files = store.files().unwrap();
    assert!(files.len() >= 2);
    assert!(files.iter().all(|(_, size)| *size <= 512));
    assert!(files.iter().map(|(_, size)| size).sum::<u64>() <= 1536);
    store.write(entry("a week later"), day + 9 * 86400).unwrap();
    let files = store.files().unwrap();
    assert_eq!(files.len(), 1, "过期日志应清理");
    assert!(
        fs::read_to_string(&files[0].0)
            .unwrap()
            .contains("a week later")
    );
}

#[test]
fn write_and_export_redact_credentials_without_copying_other_app_files() {
    let fixture = Fixture::new();
    let store = fixture.store();
    fs::write(fixture.0.join("providers.json"), "secret-provider-config").unwrap();
    let mut log = entry(
        "request api_key=api-secret password='中文密码' Authorization: Bearer bearer-secret https://alice:url-password@example.com/?token=query-secret sk-testsecret123",
    );
    log.context
        .insert("accessToken".into(), "context-secret".into());
    log.context.insert("component".into(), "App".into());
    log.stack = Some("stack token=stack-secret\n-----BEGIN PRIVATE KEY-----\nprivate-data\n-----END PRIVATE KEY-----".into());
    store.write(log, now()).unwrap();
    let export = fixture.0.join("diagnostics.json");
    store.export(&export, now()).unwrap();
    let mut outputs = store
        .files()
        .unwrap()
        .into_iter()
        .map(|(path, _)| fs::read_to_string(path).unwrap())
        .collect::<Vec<_>>();
    outputs.push(fs::read_to_string(export).unwrap());
    for output in outputs {
        for secret in [
            "api-secret",
            "中文密码",
            "bearer-secret",
            "url-password",
            "query-secret",
            "sk-testsecret123",
            "context-secret",
            "stack-secret",
            "private-data",
            "secret-provider-config",
        ] {
            assert!(!output.contains(secret), "diagnostic leaked {secret}");
        }
        assert!(output.contains("REDACTED"));
        assert!(output.contains("App"));
    }
}

#[test]
fn oversized_frontend_records_are_rejected_before_the_log_changes() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let log = entry(&"中".repeat(8192 / 3 + 1));
    assert!(log.validate().is_err());
    assert!(store.files().unwrap().is_empty());
    let mut log = entry("bounded");
    log.stack = Some("s".repeat(32769));
    assert!(log.validate().is_err());
}

/// 子进程实际 panic；不要在并行测试进程里替换全局 hook。
#[test]
fn panic_hook_records_crash_location_and_redacted_stack() {
    const CHILD_ROOT: &str = "BELFRY_TEST_PANIC_LOG_ROOT";
    if let Some(root) = std::env::var_os(CHILD_ROOT) {
        let _ = LOGGER.set(AppLogger {
            store: LogStore::new(PathBuf::from(root)),
        });
        install_panic_hook();
        panic!("panic token=panic-secret");
    }
    let fixture = Fixture::new();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "logging::tests::panic_hook_records_crash_location_and_redacted_stack",
            "--nocapture",
        ])
        .env(CHILD_ROOT, fixture.0.join("logs"))
        .output()
        .unwrap();
    assert!(!output.status.success());
    let files = fixture.store().files().unwrap();
    assert_eq!(files.len(), 1, "Rust panic 应写出可导出的崩溃记录");
    let text = fs::read_to_string(&files[0].0).unwrap();
    assert!(text.contains("rust.panic"));
    assert!(text.contains("tests.rs"));
    assert!(!text.contains("panic-secret"));
    assert!(text.contains("stack"));
}
