use super::*;
use crate::usage::analytics::fixtures::*;
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll, Waker},
    time::Instant,
};

fn state(fixture: &Fixture) -> UsageAnalyticsState {
    UsageAnalyticsState {
        roots: Some(fixture.roots.clone()),
        ..Default::default()
    }
}

fn poll_pending<F: Future>(future: Pin<&mut F>) {
    assert!(matches!(
        future.poll(&mut Context::from_waker(Waker::noop())),
        Poll::Pending
    ));
}

fn finished(state: &UsageAnalyticsState) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while state.registry.counts().1 != 0 {
        assert!(
            Instant::now() < deadline,
            "cancelled worker did not leave the cache queue"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn simultaneous_queries_share_one_actual_scan_and_completed_requests_are_cleaned_up() {
    let fixture = Fixture::new();
    let path = fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let state = state(&fixture);
    let held = state.cache.lock().unwrap();
    let mut first = Box::pin(state.query(UsageQuery::default(), Some("one".into())));
    let mut second = Box::pin(state.query(UsageQuery::default(), Some("two".into())));
    poll_pending(first.as_mut());
    poll_pending(second.as_mut());
    assert_eq!((2, 1), state.registry.counts());
    drop(held);
    let one = tauri::async_runtime::block_on(first).unwrap();
    let two = tauri::async_runtime::block_on(second).unwrap();
    assert_eq!(
        std::fs::metadata(path).unwrap().len(),
        one.diagnostics.read_bytes
    );
    assert_eq!(one.diagnostics.read_bytes, two.diagnostics.read_bytes);
    assert_eq!(semantic(&one), semantic(&two));
    finished(&state);
    assert_eq!((0, 0), state.registry.counts());
}

#[test]
fn cancelling_one_consumer_keeps_the_shared_scan_alive_for_the_other() {
    let fixture = Fixture::new();
    fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let state = state(&fixture);
    let held = state.cache.lock().unwrap();
    let mut old = Box::pin(state.query(UsageQuery::default(), Some("old".into())));
    let mut active = Box::pin(state.query(UsageQuery::default(), Some("active".into())));
    poll_pending(old.as_mut());
    poll_pending(active.as_mut());
    state.cancel("old").unwrap();
    assert!(tauri::async_runtime::block_on(old).is_err());
    assert_eq!((1, 1), state.registry.counts());
    drop(held);
    assert_eq!(100, total(&tauri::async_runtime::block_on(active).unwrap()));
    finished(&state);
}

#[test]
fn cancelled_waiter_exits_before_the_cache_lock_becomes_available() {
    let fixture = Fixture::new();
    let state = state(&fixture);
    let held = state.cache.lock().unwrap();
    let mut request = Box::pin(state.query(UsageQuery::default(), Some("waiting".into())));
    poll_pending(request.as_mut());
    state.cancel("waiting").unwrap();
    assert!(tauri::async_runtime::block_on(request).is_err());
    finished(&state);
    assert_eq!((0, 0), state.registry.counts());
    assert_eq!(0, held.len());
}

#[test]
fn dropping_a_pending_request_cancels_work_and_old_callers_without_ids_still_work() {
    let fixture = Fixture::new();
    fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let state = state(&fixture);
    let held = state.cache.lock().unwrap();
    let mut request = Box::pin(state.query(UsageQuery::default(), Some("disconnected".into())));
    poll_pending(request.as_mut());
    drop(request);
    finished(&state);
    assert_eq!((0, 0), state.registry.counts());
    drop(held);
    let report = tauri::async_runtime::block_on(state.query(UsageQuery::default(), None)).unwrap();
    assert_eq!(100, total(&report));
}

#[test]
fn cancellation_before_query_does_not_start_io() {
    let fixture = Fixture::new();
    fixture.write("claude/one.jsonl", &[claude("one", 40)]);
    let state = state(&fixture);
    state.cancel("early").unwrap();
    assert!(
        tauri::async_runtime::block_on(state.query(UsageQuery::default(), Some("early".into())))
            .is_err()
    );
    assert_eq!((0, 0), state.registry.counts());
    assert_eq!(0, state.cache.lock().unwrap().len());
}

#[test]
fn oversized_project_keys_are_rejected_before_allocating_a_worker() {
    let fixture = Fixture::new();
    let state = state(&fixture);
    let query = UsageQuery {
        window_days: None,
        project_root: Some("x".repeat(MAX_QUERY_PATH_BYTES + 1)),
    };
    assert!(tauri::async_runtime::block_on(state.query(query, None)).is_err());
    assert_eq!((0, 0), state.registry.counts());
}
