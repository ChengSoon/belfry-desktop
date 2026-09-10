use super::manager::{Lifecycle, WorkerEvent, WorkerManager};
use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    time::{Duration, Instant},
};

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/harness/worker.mjs")
}

fn manager() -> (WorkerManager, mpsc::Receiver<WorkerEvent>) {
    let (send, receive) = mpsc::channel();
    (
        WorkerManager::new(fixture(), move |event| {
            let _ = send.send(event);
        }),
        receive,
    )
}

fn wait_for_lifecycle(events: &mpsc::Receiver<WorkerEvent>, expected: Lifecycle) -> bool {
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if events
            .recv_timeout(Duration::from_millis(100))
            .is_ok_and(|event| event.lifecycle == Some(expected.clone()))
        {
            return true;
        }
    }
    false
}

fn wait_for_messages(events: &mpsc::Receiver<WorkerEvent>, count: usize) -> Vec<serde_json::Value> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut messages = Vec::new();
    while messages.len() < count && Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(100)) {
            if let Some(message) = event.message {
                messages.push(message);
            }
        }
    }
    messages
}

#[test]
fn rejects_shells_and_non_fixture_scripts() {
    let (manager, _) = manager();
    assert!(
        manager
            .start("sh", &["-c".into(), "echo bad".into()])
            .is_err()
    );
    assert!(manager.start("node", &["package.json".into()]).is_err());
}

#[test]
fn argv_environment_and_repeated_stop_are_safe() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[
                fixture().to_string_lossy().into_owned(),
                "normal".into(),
                "value with spaces".into(),
            ],
        )
        .unwrap();
    manager
        .send(
            &id,
            &serde_json::json!({"jsonrpc":"2.0","id":"init","method":"initialize"}),
        )
        .unwrap();
    let result = wait_for_messages(&events, 1).remove(0)["result"].clone();
    assert_eq!(result["argv"], serde_json::json!(["value with spaces"]));
    assert!(
        !result["envKeys"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(serde_json::Value::as_str)
            .any(is_sensitive)
    );
    manager.stop(&id).unwrap();
    manager.stop(&id).unwrap();
}

fn is_sensitive(key: &str) -> bool {
    let key = key.to_ascii_uppercase();
    key.contains("TOKEN") || key.contains("SECRET") || key.contains("API_KEY") || key == "HOME"
}

#[test]
fn initialize_session_tool_and_shutdown_round_trip_stays_ordered() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[fixture().to_string_lossy().into_owned(), "chunked".into()],
        )
        .unwrap();
    for request in [
        serde_json::json!({"jsonrpc":"2.0","id":"init","method":"initialize"}),
        serde_json::json!({"jsonrpc":"2.0","id":"start","method":"session/start","sessionId":"s"}),
        serde_json::json!({"jsonrpc":"2.0","id":"tool","method":"tool/request","sessionId":"s"}),
    ] {
        manager.send(&id, &request).unwrap();
    }
    let messages = wait_for_messages(&events, 5);
    let emitted: Vec<_> = messages
        .iter()
        .filter_map(|value| value.get("event"))
        .collect();
    assert_eq!(emitted.len(), 2);
    assert_eq!(
        (emitted[0]["type"].as_str(), emitted[0]["sequence"].as_u64()),
        (Some("session.started"), Some(1))
    );
    assert_eq!(
        (emitted[1]["type"].as_str(), emitted[1]["sequence"].as_u64()),
        (Some("tool.requested"), Some(2))
    );
    manager.stop(&id).unwrap();
}

#[test]
fn every_protocol_fault_is_contained_and_cleaned() {
    for mode in [
        "invalid-json",
        "invalid-utf8",
        "oversized",
        "invalid-envelope",
    ] {
        let (manager, events) = manager();
        let id = manager
            .start(
                "node",
                &[fixture().to_string_lossy().into_owned(), mode.into()],
            )
            .unwrap();
        assert!(
            wait_for_lifecycle(&events, Lifecycle::ProtocolFailed),
            "{mode}"
        );
        assert_eq!(manager.registry_counts_for_test().0, 0);
        manager.stop(&id).unwrap();
    }
}

#[test]
fn shutdown_timeout_forces_termination_and_reaps() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[fixture().to_string_lossy().into_owned(), "stubborn".into()],
        )
        .unwrap();
    manager.stop(&id).unwrap();
    assert!(wait_for_lifecycle(&events, Lifecycle::ForceTerminated));
    assert_eq!(manager.registry_counts_for_test().0, 0);
}

#[test]
fn stderr_is_diagnostic_not_protocol() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[fixture().to_string_lossy().into_owned(), "stderr".into()],
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut found = false;
    while Instant::now() < deadline {
        if events
            .recv_timeout(Duration::from_millis(100))
            .is_ok_and(|event| event.kind == "diagnostic")
        {
            found = true;
            break;
        }
    }
    assert!(found);
    manager.stop(&id).unwrap();
}

#[test]
fn terminal_workers_leave_active_registry_and_keep_idempotent_stop() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[fixture().to_string_lossy().into_owned(), "nonzero".into()],
        )
        .unwrap();
    assert!(wait_for_lifecycle(&events, Lifecycle::UnexpectedExit));
    assert_eq!(manager.registry_counts_for_test(), (0, 1));
    manager.stop(&id).unwrap();
}

#[test]
fn stopped_tombstones_are_bounded() {
    let (manager, _) = manager();
    for index in 0..300 {
        manager.record_stopped_for_test(format!("worker-{index}"));
    }
    assert_eq!(manager.registry_counts_for_test(), (0, 256));
    assert!(manager.stop("worker-299").is_ok());
    assert!(manager.stop("worker-0").is_err());
}

#[test]
fn fake_worker_requests_a_broker_tool_and_accepts_the_result() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[
                fixture().to_string_lossy().into_owned(),
                "broker-request".into(),
            ],
        )
        .unwrap();
    manager
        .send(
            &id,
            &serde_json::json!({"jsonrpc":"2.0","id":"init","method":"initialize"}),
        )
        .unwrap();
    let messages = wait_for_messages(&events, 2);
    let request = messages
        .iter()
        .find(|value| value["method"] == "tool/request")
        .unwrap();
    assert_eq!(request["params"]["tool"], "project.read");
    manager.send(&id, &serde_json::json!({"jsonrpc":"2.0","id":"broker-1","sessionId":"session-a","result":{"content":"hello"}})).unwrap();
    manager.stop(&id).unwrap();
}

#[test]
fn fake_worker_command_request_completes_full_round_trip() {
    let (manager, events) = manager();
    let id = manager
        .start(
            "node",
            &[
                fixture().to_string_lossy().into_owned(),
                "command-roundtrip".into(),
            ],
        )
        .unwrap();
    manager
        .send(
            &id,
            &serde_json::json!({"jsonrpc":"2.0","id":"init","method":"initialize"}),
        )
        .unwrap();
    let messages = wait_for_messages(&events, 2);
    let request = messages
        .iter()
        .find(|value| value["id"] == "command-1")
        .unwrap();
    assert_eq!(
        request["params"]["argv"],
        serde_json::json!(["hello worker"])
    );
    manager.send(&id, &serde_json::json!({"jsonrpc":"2.0","id":"command-1","sessionId":"session-a","result":{"exitCode":0,"stdout":"hello worker\n","stderr":"","terminationReason":"exited"}})).unwrap();
    let completed = wait_for_messages(&events, 1).remove(0);
    assert_eq!(completed["event"]["type"], "command.completed");
    assert_eq!(completed["event"]["data"]["stdout"], "hello worker\n");
    manager.stop(&id).unwrap();
}
