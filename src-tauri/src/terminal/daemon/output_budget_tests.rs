use super::output_budget::{OutputBudget, WINDOW_BATCHES, WINDOW_BYTES};
use std::{
    sync::{Arc, mpsc},
    thread,
    time::Duration,
};

#[test]
fn a_slow_consumer_stops_delivery_until_the_oldest_batch_is_parsed() {
    let budget = Arc::new(OutputBudget::default());
    let first = budget.reserve(WINDOW_BYTES).unwrap();
    let (sent, received) = mpsc::channel();
    let worker_budget = budget.clone();
    let worker = thread::spawn(move || sent.send(worker_budget.reserve(1)).unwrap());
    assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
    assert!(!budget.acknowledge(first + 1));
    assert!(budget.acknowledge(first));
    let second = received
        .recv_timeout(Duration::from_secs(1))
        .unwrap()
        .unwrap();
    assert_eq!(first + 1, second);
    assert!(!budget.acknowledge(first));
    assert!(budget.acknowledge(second));
    worker.join().unwrap();
}

#[test]
fn duplicate_and_out_of_order_acknowledgements_never_return_credit() {
    let budget = OutputBudget::default();
    let first = budget.reserve(WINDOW_BYTES / 2).unwrap();
    let second = budget.reserve(WINDOW_BYTES / 2).unwrap();
    assert!(!budget.acknowledge(second));
    assert_eq!((WINDOW_BYTES, 2), budget.outstanding());
    assert!(budget.acknowledge(first));
    assert!(!budget.acknowledge(first));
    assert_eq!((WINDOW_BYTES / 2, 1), budget.outstanding());
    assert!(budget.acknowledge(second));
    assert_eq!((0, 0), budget.outstanding());
}

#[test]
fn tiny_events_cannot_create_an_unbounded_ipc_queue() {
    let budget = Arc::new(OutputBudget::default());
    for _ in 0..WINDOW_BATCHES {
        budget.reserve(1).unwrap();
    }
    let (sent, received) = mpsc::channel();
    let worker_budget = budget.clone();
    let worker = thread::spawn(move || sent.send(worker_budget.reserve(1)).unwrap());
    assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
    budget.cancel();
    assert!(
        received
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .is_err()
    );
    assert_eq!((0, 0), budget.outstanding());
    worker.join().unwrap();
}

#[test]
fn detach_releases_waiters_and_rejects_late_acknowledgements() {
    let budget = Arc::new(OutputBudget::default());
    let first = budget.reserve(WINDOW_BYTES).unwrap();
    let (sent, received) = mpsc::channel();
    let worker_budget = budget.clone();
    let worker = thread::spawn(move || sent.send(worker_budget.wait_drained()).unwrap());
    assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
    budget.cancel();
    assert!(
        received
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .is_err()
    );
    assert!(!budget.acknowledge(first));
    assert!(!budget.is_active());
    worker.join().unwrap();
}

#[test]
fn an_unresponsive_consumer_times_out_without_holding_a_waiter_forever() {
    let budget = OutputBudget::with_timeout(Duration::from_millis(10));
    budget.reserve(WINDOW_BYTES).unwrap();
    assert!(budget.reserve(1).unwrap_err().contains("消费确认"));
    budget.cancel();
    assert_eq!((0, 0), budget.outstanding());
}

#[test]
fn an_oversized_batch_fails_instead_of_waiting_for_impossible_credit() {
    let budget = OutputBudget::default();
    assert!(budget.reserve(WINDOW_BYTES + 1).is_err());
    assert_eq!((0, 0), budget.outstanding());
    assert!(budget.reserve(WINDOW_BYTES).is_ok());
}
