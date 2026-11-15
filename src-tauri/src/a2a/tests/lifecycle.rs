use std::{
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

use tauri::async_runtime::block_on;

use super::super::requests::{Owner, Requests};
use super::fixture::*;

#[test]
fn a2a_request_cancel_can_arrive_before_registration_without_starting_http() {
    let server = Server::standard();
    let fixture = Fixture::new();
    let info = fixture.save(&draft(&server.base, "none", None));
    let id = request_id();
    assert!(!fixture.runtime.cancel_request(&fixture.owner, &id).unwrap());
    let failure = block_on(fixture.runtime.send_message(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &id,
        "working",
        None,
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_REQUEST_CANCELED");
    assert!(server.requests.lock().unwrap().is_empty());
    let registry = Requests::default();
    let lease = registry.begin(&fixture.owner, "one").unwrap();
    assert_eq!(
        code(&registry.begin(&fixture.owner, "one").err().unwrap()),
        "A2A_REQUEST_CONFLICT"
    );
    assert!(
        !registry
            .cancel(
                &Owner::agent(fixture.owner.root.clone(), "different-owner".into()),
                "one"
            )
            .unwrap()
    );
    lease.signal.check().unwrap();
    drop(lease);
    assert_eq!(
        code(&registry.begin(&fixture.owner, "one").err().unwrap()),
        "A2A_REQUEST_CANCELED"
    );
}

#[test]
fn a2a_cancellation_revocation_connection_updates_and_exit_drop_inflight_http() {
    for action in ["request", "session", "connection", "exit"] {
        let server = Server::standard();
        let fixture = Fixture::new();
        let info = fixture.save(&draft(&server.base, "none", None));
        let id = request_id();
        let (runtime, store, owner, connection, request) = (
            fixture.runtime.clone(),
            fixture.store.clone(),
            fixture.owner.clone(),
            info.id.clone(),
            id.clone(),
        );
        let pending = thread::spawn(move || {
            block_on(runtime.send_message(&store, &owner, &connection, &request, "slow", None))
        });
        server.wait_for("SendMessage");
        let start = Instant::now();
        match action {
            "request" => assert!(fixture.runtime.cancel_request(&fixture.owner, &id).unwrap()),
            "session" => fixture
                .runtime
                .invalidate_session(fixture.owner.ticket.as_deref().unwrap()),
            "connection" => {
                let mut config = draft(&server.base, "none", None);
                config.id = Some(info.id.clone());
                config.name = "Updated".into();
                fixture.save(&config);
            }
            "exit" => fixture.runtime.stop(),
            _ => unreachable!(),
        }
        let failure = pending.join().unwrap().err().unwrap();
        assert_eq!(code(&failure), "A2A_REQUEST_CANCELED");
        assert_eq!(failure.details.unwrap()["outcomeUnknown"], true);
        assert!(start.elapsed() < Duration::from_secs(1));
        for _ in 0..200 {
            if server.disconnects.load(Ordering::Acquire) == 1 {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            server.disconnects.load(Ordering::Acquire),
            1,
            "the client must close the hanging HTTP connection"
        );
        let methods: Vec<_> = server
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter_map(|r| r.body["method"].as_str().map(str::to_owned))
            .collect();
        assert_eq!(
            methods,
            ["SendMessage"],
            "local cancellation must not issue CancelTask"
        );
    }
}

#[test]
fn a2a_send_timeout_has_an_unknown_outcome_and_is_never_retried() {
    let server = Server::standard();
    let fixture = Fixture::with_timeout(Duration::from_millis(150));
    let info = fixture.save(&draft(&server.base, "none", None));
    let failure = block_on(fixture.runtime.send_message(
        &fixture.store,
        &fixture.owner,
        &info.id,
        &request_id(),
        "slow",
        None,
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_TIMEOUT");
    assert!(!failure.retryable);
    assert_eq!(failure.details.unwrap()["outcomeUnknown"], true);
    assert_eq!(
        server
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.body["method"] == "SendMessage")
            .count(),
        1
    );
}

#[test]
fn a2a_task_handles_isolate_projects_sessions_connections_and_revisions() {
    let server = Server::standard();
    let fixture = Fixture::new();
    let first = fixture.save(&draft(&server.base, "none", None));
    let second = fixture.save(&draft(&server.base, "none", None));
    let other_project = fixture.other_project();
    let other_info = fixture
        .runtime
        .save(
            &fixture.store,
            &other_project.root,
            &draft(&server.base, "none", None),
        )
        .unwrap();
    assert_eq!(
        fixture
            .runtime
            .list(&fixture.store, &other_project.root)
            .unwrap(),
        vec![other_info]
    );
    let created = reply_value(
        block_on(fixture.runtime.send_message(
            &fixture.store,
            &fixture.owner,
            &first.id,
            &request_id(),
            "working",
            None,
        ))
        .unwrap(),
    );
    let handle = created["taskHandle"].as_str().unwrap();
    let other_session = Owner::agent(fixture.owner.root.clone(), "another-ticket".into());
    for owner in [&other_session, &other_project] {
        let failure =
            block_on(
                fixture
                    .runtime
                    .task(&fixture.store, owner, handle, &request_id(), true, 0),
            )
            .err()
            .unwrap();
        assert_eq!(code(&failure), "A2A_TASK_HANDLE_INVALID");
    }
    let failure = block_on(fixture.runtime.send_message(
        &fixture.store,
        &fixture.owner,
        &second.id,
        &request_id(),
        "follow-up",
        Some(handle),
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_TASK_HANDLE_INVALID");
    let own_second = reply_value(
        block_on(fixture.runtime.send_message(
            &fixture.store,
            &fixture.owner,
            &second.id,
            &request_id(),
            "working",
            None,
        ))
        .unwrap(),
    );
    assert_eq!(own_second["task"]["id"], created["task"]["id"]);
    assert_ne!(own_second["taskHandle"], created["taskHandle"]);
    let mut changed = draft(&server.base, "none", None);
    changed.id = Some(first.id.clone());
    let updated = fixture.save(&changed);
    assert_ne!(updated.revision, first.revision);
    let failure = block_on(fixture.runtime.task(
        &fixture.store,
        &fixture.owner,
        handle,
        &request_id(),
        false,
        0,
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_TASK_HANDLE_INVALID");
    block_on(fixture.runtime.task(
        &fixture.store,
        &fixture.owner,
        own_second["taskHandle"].as_str().unwrap(),
        &request_id(),
        false,
        0,
    ))
    .unwrap();
    fixture
        .runtime
        .invalidate_session(fixture.owner.ticket.as_deref().unwrap());
    let failure = block_on(fixture.runtime.task(
        &fixture.store,
        &other_session,
        own_second["taskHandle"].as_str().unwrap(),
        &request_id(),
        false,
        0,
    ))
    .err()
    .unwrap();
    assert_eq!(code(&failure), "A2A_TASK_HANDLE_INVALID");
    let failure = block_on(fixture.runtime.agent_card(
        &fixture.store,
        &fixture.owner,
        &second.id,
        &request_id(),
    ))
    .unwrap_err();
    assert_eq!(code(&failure), "A2A_REQUEST_CANCELED");
}

#[test]
fn a2a_request_limits_keep_owners_separate_and_cancel_wakes_pending_futures() {
    let fixture = Fixture::new();
    let registry = Requests::default();
    let leases: Vec<_> = (0..8)
        .map(|n| {
            registry
                .begin(&fixture.owner, &format!("request-{n}"))
                .unwrap()
        })
        .collect();
    assert_eq!(
        code(&registry.begin(&fixture.owner, "overflow").err().unwrap()),
        "A2A_REQUEST_LIMIT"
    );
    let other = Owner::agent(fixture.owner.root.clone(), "other-ticket".into());
    registry.begin(&other, "separate").unwrap();
    registry.cancel(&fixture.owner, "request-0").unwrap();
    assert_eq!(
        code(&leases[0].signal.check().err().unwrap()),
        "A2A_REQUEST_CANCELED"
    );
    for lease in &leases[1..] {
        lease.signal.check().unwrap();
    }
}
