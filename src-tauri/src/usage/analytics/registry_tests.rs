use super::*;
use crate::usage::contracts::UsageQuery;

fn key() -> QueryKey {
    QueryKey::new(&UsageQuery::default())
}

#[test]
fn equivalent_queries_share_work_but_cancellation_is_per_consumer() {
    let registry = Arc::new(Registry::default());
    let first = registry.begin("first".into(), key()).unwrap();
    let second = registry
        .begin(
            "second".into(),
            QueryKey::new(&UsageQuery {
                window_days: Some(0),
                project_root: Some("  ".into()),
            }),
        )
        .unwrap();
    assert!(first.leader && !second.leader);
    assert!(Arc::ptr_eq(&first.job, &second.job));
    registry.cancel("first").unwrap();
    assert!(tauri::async_runtime::block_on(first.wait()).is_err());
    assert!(second.job.cancel.check().is_ok());
    drop(first);
    assert!(second.job.cancel.check().is_ok());
    registry.cancel("second").unwrap();
    assert!(second.job.cancel.check().is_err());
    registry.finished(&second.job);
    assert_eq!(0, registry.entries.lock().unwrap().active.len());
}

#[test]
fn cancellation_before_registration_is_remembered_with_bounded_expiring_ids() {
    let registry = Arc::new(Registry::default());
    registry.cancel("not-started").unwrap();
    assert!(registry.begin("not-started".into(), key()).is_err());
    for index in 0..MAX_CANCELLED_IDS + 10 {
        registry.cancel(&format!("cancel-{index}")).unwrap();
    }
    let mut entries = registry.entries.lock().unwrap();
    assert_eq!(MAX_CANCELLED_IDS, entries.cancelled.len());
    for (_, at) in &mut entries.cancelled {
        *at = Instant::now() - CANCEL_TTL;
    }
    drop(entries);
    let ticket = registry.begin("new".into(), key()).unwrap();
    assert!(registry.entries.lock().unwrap().cancelled.is_empty());
    registry.finished(&ticket.job);
}

#[test]
fn cancelled_workers_keep_their_slot_until_finished_and_cannot_build_an_unbounded_queue() {
    let registry = Arc::new(Registry::default());
    let mut tickets = Vec::new();
    for index in 0..MAX_RUNNING_JOBS {
        let id = format!("old-{index}");
        tickets.push(registry.begin(id.clone(), key()).unwrap());
        registry.cancel(&id).unwrap();
    }
    assert!(registry.begin("overflow".into(), key()).is_err());
    for ticket in tickets {
        registry.finished(&ticket.job);
    }
    let latest = registry.begin("latest".into(), key()).unwrap();
    assert_eq!(1, registry.entries.lock().unwrap().running);
    registry.finished(&latest.job);
}

#[test]
fn old_completion_and_late_cancel_cannot_remove_replacement_work() {
    let registry = Arc::new(Registry::default());
    let old = registry.begin("old".into(), key()).unwrap();
    registry.cancel("old").unwrap();
    let latest = registry.begin("new".into(), key()).unwrap();
    registry.finished(&old.job);
    registry.cancel("old").unwrap();
    assert!(latest.job.cancel.check().is_ok());
    assert!(Arc::ptr_eq(
        &latest.job,
        registry.entries.lock().unwrap().jobs.get(&key()).unwrap()
    ));
    registry.finished(&latest.job);
}

#[test]
fn subscriber_limits_and_drop_cleanup_bound_disconnected_requests() {
    let registry = Arc::new(Registry::default());
    let tickets = (0..MAX_REQUESTS)
        .map(|index| registry.begin(format!("request-{index}"), key()).unwrap())
        .collect::<Vec<_>>();
    assert!(registry.begin("overflow".into(), key()).is_err());
    let job = tickets[0].job.clone();
    drop(tickets);
    assert!(job.cancel.check().is_err());
    assert!(registry.entries.lock().unwrap().active.is_empty());
    registry.finished(&job);
    assert_eq!(0, registry.entries.lock().unwrap().running);
}

#[test]
fn duplicate_or_oversized_ids_do_not_replace_another_consumer() {
    let registry = Arc::new(Registry::default());
    let ticket = registry.begin("one".into(), key()).unwrap();
    assert!(registry.begin("one".into(), key()).is_err());
    assert!(registry.begin("x".repeat(MAX_ID_BYTES + 1), key()).is_err());
    assert!(registry.cancel(" ").is_err());
    assert!(ticket.job.cancel.check().is_ok());
    registry.finished(&ticket.job);
}
