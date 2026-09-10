use super::*;
use crate::harness::registry::{PluginDefinition, SystemRegistry};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

struct Fixture {
    root: PathBuf,
    store: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-command-{}", ulid::Ulid::generate()));
        fs::create_dir(&root).unwrap();
        let store = root.join("registry.json");
        Self { root, store }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn setup(
    granted: bool,
) -> (
    Fixture,
    SystemRegistry,
    Arc<CommandBroker>,
    Arc<Mutex<Vec<CommandAudit>>>,
) {
    let fixture = Fixture::new();
    let registry = SystemRegistry::new(fixture.store.clone(), |_| {});
    registry
        .install(
            "0",
            PluginDefinition {
                plugin_id: "test.command".into(),
                version: "1.0.0".into(),
                manifest_digest: "digest".into(),
                harness_api: 1,
                min_app_version: "0.19.0".into(),
                trusted: true,
                enabled: true,
                source: "test".into(),
                tools: vec!["command.exec".into()],
                capabilities: vec!["command.exec".into()],
            },
        )
        .unwrap();
    registry
        .snapshot(
            "s".into(),
            "agent".into(),
            "test.command",
            "w".into(),
            fixture.root.to_string_lossy().into(),
        )
        .unwrap();
    if granted {
        registry
            .authorize("s", vec!["command.exec".into()])
            .unwrap();
    }
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    (
        fixture,
        registry,
        Arc::new(CommandBroker::new(move |event| {
            captured.lock().unwrap().push(event)
        })),
        events,
    )
}
fn request(executable: &str, argv: &[&str]) -> ExecRequest {
    ExecRequest {
        session_id: "s".into(),
        worker_id: "w".into(),
        request_id: ulid::Ulid::generate().to_string(),
        tool_id: "tool".into(),
        executable: executable.into(),
        argv: argv.iter().map(|v| (*v).into()).collect(),
        cwd: "".into(),
        timeout_ms: Some(1000),
        env: HashMap::new(),
    }
}
fn execute(
    registry: &SystemRegistry,
    broker: &CommandBroker,
    request: ExecRequest,
) -> CommandResult<ExecResult> {
    let approval = broker.request(registry, request).unwrap();
    let token = broker.approve(&approval.approval_id).unwrap();
    broker.execute(registry, &approval.approval_id, &token)
}

#[test]
fn argv_is_not_shell_and_streams_are_separate() {
    let (_fixture, registry, broker, events) = setup(true);
    let value = execute(
        &registry,
        &broker,
        request("printf", &["%s", "a b;$(nope)"]),
    )
    .unwrap();
    assert_eq!(value.stdout, "a b;$(nope)");
    assert_eq!(value.stderr, "");
    assert_eq!(value.exit_code, Some(0));
    assert_eq!(
        events
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.phase)
            .collect::<Vec<_>>(),
        [
            "requested",
            "approval.required",
            "started",
            "output",
            "completed"
        ]
    );
}

#[test]
fn declaration_grant_worker_path_env_and_shell_are_enforced() {
    let (fixture, registry, broker, _) = setup(false);
    assert_eq!(
        broker
            .request(&registry, request("echo", &["x"]))
            .unwrap_err()
            .code,
        "CAPABILITY_DENIED"
    );
    registry
        .authorize("s", vec!["command.exec".into()])
        .unwrap();
    let mut wrong = request("echo", &["x"]);
    wrong.worker_id = "other".into();
    assert_eq!(
        broker.request(&registry, wrong).unwrap_err().code,
        "WORKER_MISMATCH"
    );
    let mut outside = request("echo", &["x"]);
    outside.cwd = "../outside".into();
    assert_eq!(
        broker.request(&registry, outside).unwrap_err().code,
        "PATH_OUTSIDE_ROOT"
    );
    let mut env = request("echo", &["x"]);
    env.env
        .insert("HOME".into(), fixture.root.to_string_lossy().into());
    assert_eq!(
        broker.request(&registry, env).unwrap_err().code,
        "ENV_DENIED"
    );
    assert_eq!(
        broker
            .request(&registry, request("sh", &["-c", "echo x"]))
            .unwrap_err()
            .code,
        "EXECUTABLE_DENIED"
    );
}

#[cfg(unix)]
#[test]
fn symlink_cwd_escape_is_rejected() {
    use std::os::unix::fs::symlink;
    let (fixture, registry, broker, _) = setup(true);
    symlink(std::env::temp_dir(), fixture.root.join("escape")).unwrap();
    let mut value = request("echo", &["x"]);
    value.cwd = "escape".into();
    assert_eq!(
        broker.request(&registry, value).unwrap_err().code,
        "PATH_OUTSIDE_ROOT"
    );
}

#[test]
fn tokens_are_one_time_bound_and_revocation_is_rechecked() {
    let (_fixture, registry, broker, _) = setup(true);
    let first = request("echo", &["one"]);
    let approval = broker.request(&registry, first).unwrap();
    let token = broker.approve(&approval.approval_id).unwrap();
    assert_eq!(
        broker
            .execute(&registry, &approval.approval_id, "wrong")
            .unwrap_err()
            .code,
        "APPROVAL_DENIED"
    );
    assert_eq!(
        broker
            .execute(&registry, &approval.approval_id, &token)
            .unwrap_err()
            .code,
        "APPROVAL_EXPIRED"
    );
    let second = broker
        .request(&registry, request("echo", &["two"]))
        .unwrap();
    let token = broker.approve(&second.approval_id).unwrap();
    registry.authorize("s", vec![]).unwrap();
    assert_eq!(
        broker
            .execute(&registry, &second.approval_id, &token)
            .unwrap_err()
            .code,
        "CAPABILITY_DENIED"
    );
}

#[test]
fn timeout_cancel_and_session_isolation_work() {
    let (_fixture, registry, broker, _) = setup(true);
    let approval = broker.request(&registry, request("sleep", &["2"])).unwrap();
    let token = broker.approve(&approval.approval_id).unwrap();
    let running = broker.clone();
    let handle = thread::spawn(move || running.execute(&registry, &approval.approval_id, &token));
    thread::sleep(Duration::from_millis(50));
    broker.cancel_session("other");
    thread::sleep(Duration::from_millis(30));
    broker.cancel_session("s");
    broker.cancel_session("s");
    assert_eq!(
        handle.join().unwrap().unwrap().termination_reason,
        "cancelled"
    );
}

#[test]
fn nonzero_and_timeout_have_structured_results() {
    let (_fixture, registry, broker, _) = setup(true);
    let nonzero = execute(&registry, &broker, request("false", &[])).unwrap();
    assert_eq!(nonzero.exit_code, Some(1));
    let mut slow = request("sleep", &["1"]);
    slow.timeout_ms = Some(20);
    assert_eq!(
        execute(&registry, &broker, slow)
            .unwrap()
            .termination_reason,
        "timeout"
    );
}

#[test]
fn approval_store_and_session_concurrency_are_bounded() {
    let (_fixture, registry, broker, _) = setup(true);
    let mut first = None;
    for index in 0..101 {
        let mut value = request("echo", &["x"]);
        value.request_id = format!("r-{index}");
        let approval = broker.request(&registry, value).unwrap();
        if first.is_none() {
            first = Some(approval.approval_id);
        }
    }
    assert_eq!(
        broker.approve(&first.unwrap()).unwrap_err().code,
        "APPROVAL_EXPIRED"
    );
    let latest = broker
        .request(&registry, request("echo", &["late"]))
        .unwrap();
    broker
        .state
        .lock()
        .unwrap()
        .approvals
        .get_mut(&latest.approval_id)
        .unwrap()
        .expires_at = 0;
    assert_eq!(
        broker.approve(&latest.approval_id).unwrap_err().code,
        "APPROVAL_EXPIRED"
    );
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let child = Arc::new(Mutex::new(None));
    let mut state = broker.state.lock().unwrap();
    for index in 0..2 {
        state.running.insert(
            format!("s-{index}"),
            Running {
                session_id: "s".into(),
                worker_id: "w".into(),
                cancelled: cancelled.clone(),
                child: child.clone(),
            },
        );
    }
    drop(state);
    assert_eq!(
        broker
            .start_running(&request("echo", &["x"]))
            .unwrap_err()
            .code,
        "BUSY"
    );
    let mut state = broker.state.lock().unwrap();
    state.running.insert(
        "x-1".into(),
        Running {
            session_id: "x".into(),
            worker_id: "x".into(),
            cancelled: cancelled.clone(),
            child: child.clone(),
        },
    );
    state.running.insert(
        "x-2".into(),
        Running {
            session_id: "y".into(),
            worker_id: "y".into(),
            cancelled,
            child,
        },
    );
    drop(state);
    let mut other = request("echo", &["x"]);
    other.session_id = "new".into();
    assert_eq!(broker.start_running(&other).unwrap_err().code, "BUSY");
}

#[test]
fn worker_crash_cancels_only_owned_processes() {
    let (_fixture, _registry, broker, _) = setup(true);
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    broker.state.lock().unwrap().running.insert(
        "r".into(),
        Running {
            session_id: "s".into(),
            worker_id: "w".into(),
            cancelled: cancelled.clone(),
            child: Arc::new(Mutex::new(None)),
        },
    );
    broker.cancel_worker("other");
    assert!(!cancelled.load(std::sync::atomic::Ordering::SeqCst));
    broker.cancel_worker("w");
    assert!(cancelled.load(std::sync::atomic::Ordering::SeqCst));
}
