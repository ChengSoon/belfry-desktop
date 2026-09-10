use super::*;
use serde_json::json;
use std::{
    fs,
    sync::{Arc, Mutex},
};

struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-broker-{}", ulid::Ulid::generate()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("hello.txt"), "hello").unwrap();
        Self { root }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn setup(declared: &[&str], granted: bool) -> (ReadBroker, Arc<Mutex<Vec<AuditEvent>>>, Fixture) {
    let fixture = Fixture::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let broker = ReadBroker::new(move |event| captured.lock().unwrap().push(event));
    broker
        .register(SessionRegistration {
            session_id: "session".into(),
            worker_id: "worker".into(),
            project_root: fixture.root.to_string_lossy().into(),
            harness_id: "test.harness".into(),
            harness_version: "1.0.0".into(),
            declared_tools: declared.iter().map(|value| (*value).into()).collect(),
            granted_capabilities: if granted {
                vec!["project.read".into()]
            } else {
                vec![]
            },
        })
        .unwrap();
    (broker, events, fixture)
}

fn request(tool: &str, path: &str) -> ToolRequest {
    ToolRequest {
        session_id: "session".into(),
        request_id: "request".into(),
        tool_id: "tool-id".into(),
        tool: tool.into(),
        params: json!({"path":path}),
    }
}

#[test]
fn authorized_list_and_read_emit_one_terminal_event_each() {
    let (broker, events, _fixture) = setup(&["project.list", "project.read"], true);
    assert_eq!(
        broker
            .handle("worker", request("project.read", "hello.txt"))
            .unwrap()["content"],
        "hello"
    );
    assert_eq!(
        broker
            .handle("worker", request("project.list", ""))
            .unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let phases: Vec<_> = events
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.phase)
        .collect();
    assert_eq!(phases, ["requested", "completed", "requested", "completed"]);
}

#[test]
fn permission_checks_follow_stable_order() {
    let (broker, _, _fixture) = setup(&[], false);
    assert_eq!(
        broker
            .handle(
                "worker",
                ToolRequest {
                    session_id: "missing".into(),
                    ..request("bad", "../x")
                }
            )
            .unwrap_err()
            .code,
        "SESSION_NOT_FOUND"
    );
    assert_eq!(
        broker
            .handle("other", request("bad", "../x"))
            .unwrap_err()
            .code,
        "WORKER_MISMATCH"
    );
    assert_eq!(
        broker
            .handle("worker", request("bad", "../x"))
            .unwrap_err()
            .code,
        "TOOL_UNDECLARED"
    );
    let (broker, _, _fixture) = setup(&["project.read"], false);
    assert_eq!(
        broker
            .handle("worker", request("project.read", "../x"))
            .unwrap_err()
            .code,
        "CAPABILITY_DENIED"
    );
}

#[test]
fn revoke_and_cancel_win_immediately_before_execution() {
    let (broker, _, _fixture) = setup(&["project.read"], true);
    let result = broker.handle_with_hook("worker", request("project.read", "hello.txt"), || {
        broker.update_grants("session", vec![]).unwrap()
    });
    assert_eq!(result.unwrap_err().code, "CAPABILITY_DENIED");
    broker
        .update_grants("session", vec!["project.read".into()])
        .unwrap();
    let result = broker.handle_with_hook("worker", request("project.read", "hello.txt"), || {
        broker.cancel("session").unwrap()
    });
    assert_eq!(result.unwrap_err().code, "SESSION_CANCELLED");
    assert_eq!(
        broker
            .handle("worker", request("project.read", "hello.txt"))
            .unwrap_err()
            .code,
        "SESSION_CANCELLED"
    );
}

#[test]
fn paths_and_file_shapes_have_stable_safe_errors() {
    let (broker, _, fixture) = setup(&["project.read"], true);
    for path in ["../outside", "/tmp/outside", "C:\\temp\\x", "bad\0x"] {
        let error = broker
            .handle("worker", request("project.read", path))
            .unwrap_err();
        assert_eq!(error.code, "PATH_OUTSIDE_ROOT");
        assert!(
            !error
                .message
                .contains(&fixture.root.to_string_lossy().to_string())
        );
    }
    assert_eq!(
        broker
            .handle("worker", request("project.read", "missing"))
            .unwrap_err()
            .code,
        "NOT_FOUND"
    );
    assert_eq!(
        broker
            .handle("worker", request("project.read", ""))
            .unwrap_err()
            .code,
        "INVALID_PARAMS"
    );
    fs::write(fixture.root.join("binary"), [0, 1, 2]).unwrap();
    assert_eq!(
        broker
            .handle("worker", request("project.read", "binary"))
            .unwrap()["content"],
        json!(null)
    );
    fs::write(fixture.root.join("large"), vec![b'x'; 512 * 1024 + 1]).unwrap();
    assert_eq!(
        broker
            .handle("worker", request("project.read", "large"))
            .unwrap_err()
            .code,
        "TOO_LARGE"
    );
}

#[cfg(unix)]
#[test]
fn symlink_escape_is_rejected() {
    use std::os::unix::fs::symlink;
    let (broker, _, fixture) = setup(&["project.read"], true);
    let outside = std::env::temp_dir().join(format!("outside-{}", ulid::Ulid::generate()));
    fs::write(&outside, "secret").unwrap();
    symlink(&outside, fixture.root.join("escape")).unwrap();
    assert_eq!(
        broker
            .handle("worker", request("project.read", "escape"))
            .unwrap_err()
            .code,
        "PATH_OUTSIDE_ROOT"
    );
    let _ = fs::remove_file(outside);
}

#[test]
fn concurrency_limit_is_busy_and_permits_are_released() {
    let (broker, events, _fixture) = setup(&["project.read"], true);
    broker.set_inflight_for_test("session", 8);
    assert_eq!(
        broker
            .handle("worker", request("project.read", "hello.txt"))
            .unwrap_err()
            .code,
        "BUSY"
    );
    let terminal = events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| matches!(event.phase, "completed" | "failed"))
        .count();
    assert_eq!(terminal, 1);
}

#[test]
fn list_and_utf8_read_enforce_exact_quotas() {
    let (broker, _, fixture) = setup(&["project.list", "project.read"], true);
    for index in 0..1_001 {
        fs::write(fixture.root.join(format!("entry-{index}")), "").unwrap();
    }
    let listed = broker
        .handle(
            "worker",
            ToolRequest {
                request_id: "list".into(),
                tool_id: "list-tool".into(),
                ..request("project.list", "")
            },
        )
        .unwrap();
    assert_eq!(listed["entries"].as_array().unwrap().len(), 1_000);
    assert_eq!(listed["truncated"], true);
    let boundary = format!("{}é", "a".repeat(512 * 1024 - 2));
    fs::write(fixture.root.join("boundary"), &boundary).unwrap();
    let read = broker
        .handle(
            "worker",
            ToolRequest {
                request_id: "read".into(),
                tool_id: "read-tool".into(),
                ..request("project.read", "boundary")
            },
        )
        .unwrap();
    assert_eq!(read["content"].as_str().unwrap().len(), 512 * 1024);
    assert!(read["content"].as_str().unwrap().ends_with('é'));
}

#[test]
fn session_binding_cannot_be_replaced() {
    let (broker, _, fixture) = setup(&["project.read"], true);
    let duplicate = SessionRegistration {
        session_id: "session".into(),
        worker_id: "other".into(),
        project_root: fixture.root.to_string_lossy().into(),
        harness_id: "other".into(),
        harness_version: "2.0.0".into(),
        declared_tools: vec!["project.read".into()],
        granted_capabilities: vec!["project.read".into()],
    };
    assert_eq!(
        broker.register(duplicate).unwrap_err().code,
        "INVALID_PARAMS"
    );
    assert_eq!(
        broker
            .handle(
                "other",
                ToolRequest {
                    request_id: "other".into(),
                    ..request("project.read", "hello.txt")
                }
            )
            .unwrap_err()
            .code,
        "WORKER_MISMATCH"
    );
}

#[test]
fn duplicate_request_id_has_one_audit_lifecycle() {
    let (broker, events, _fixture) = setup(&["project.read"], true);
    assert!(
        broker
            .handle("worker", request("project.read", "hello.txt"))
            .is_ok()
    );
    assert_eq!(
        broker
            .handle("worker", request("project.read", "hello.txt"))
            .unwrap_err()
            .code,
        "INVALID_PARAMS"
    );
    let phases: Vec<_> = events
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.phase)
        .collect();
    assert_eq!(phases, ["requested", "completed"]);
}
