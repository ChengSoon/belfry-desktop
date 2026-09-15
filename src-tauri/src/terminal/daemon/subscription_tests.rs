use super::{
    output_budget::WINDOW_BYTES,
    protocol::{Endpoint, Frame, PollResult, Reply, Request, VERSION},
    subscription::Subscription,
    subscriptions::Subscriptions,
    transport,
};
use crate::terminal::{
    AppError, TerminalEvent, backend::TerminalEventSink, contracts::TerminalExitReason,
};
use std::{
    io::Read,
    net::TcpListener,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Duration,
};

#[test]
fn stale_sessions_connections_and_detaches_cannot_release_a_replacement_window() {
    let subscriptions = Subscriptions::default();
    let old = Arc::new(Subscription::new("pty".into(), true));
    subscriptions.replace(old.clone());
    let old_id = old.budget.reserve(WINDOW_BYTES).unwrap();
    let new = Arc::new(Subscription::new("pty".into(), true));
    subscriptions.replace(new.clone());
    let new_id = new.budget.reserve(WINDOW_BYTES).unwrap();
    assert!(!old.budget.is_active());
    assert_eq!((0, 0), old.budget.outstanding());
    assert!(!subscriptions.acknowledge("other", &new.connection_id, new_id));
    assert!(!subscriptions.acknowledge("pty", &old.connection_id, old_id));
    assert!(!subscriptions.acknowledge("pty", &new.connection_id, new_id + 1));
    subscriptions.detach("pty", &old.connection_id);
    assert!(new.budget.is_active());
    assert_eq!((WINDOW_BYTES, 1), new.budget.outstanding());
    assert!(subscriptions.acknowledge("pty", &new.connection_id, new_id));
    assert!(!subscriptions.acknowledge("pty", &new.connection_id, new_id));
    subscriptions.detach_all();
    assert!(!new.budget.is_active());
}

fn endpoint(listener: &TcpListener) -> Endpoint {
    Endpoint {
        version: VERSION,
        port: listener.local_addr().unwrap().port(),
        token: "test".into(),
        instance: "test".into(),
        pid: std::process::id(),
    }
}

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<TerminalEvent>>,
    reject: bool,
}
impl TerminalEventSink for RecordingSink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        self.events.lock().unwrap().push(event);
        if self.reject {
            Err(AppError::io("test channel closed"))
        } else {
            Ok(())
        }
    }
}

#[test]
fn detach_interrupts_an_in_progress_poll_socket_without_waiting_for_the_io_timeout() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let endpoint = endpoint(&listener);
    let (requested, ready) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        transport::prepare_peer(&stream).unwrap();
        transport::read::<Request>(&mut stream).unwrap();
        requested.send(()).unwrap();
        // 不回复，模拟一个卡住的后台轮询。只等待本测试创建的连接关闭。
        let _ = stream.read(&mut [0]);
    });
    let subscription = Arc::new(Subscription::new("pty".into(), true));
    let sink = Arc::new(RecordingSink::default());
    let (finished, done) = mpsc::channel();
    let (worker_sub, worker_sink) = (subscription.clone(), sink.clone());
    let worker = thread::spawn(move || {
        worker_sub.run(endpoint, worker_sink.as_ref());
        finished.send(()).unwrap();
    });
    ready.recv_timeout(Duration::from_secs(1)).unwrap();
    subscription.cancel();
    done.recv_timeout(Duration::from_secs(1))
        .expect("detach must release the blocked poll");
    assert!(sink.events.lock().unwrap().is_empty());
    assert_eq!((0, 0), subscription.budget.outstanding());
    worker.join().unwrap();
    server.join().unwrap();
}

fn final_page() -> PollResult {
    PollResult {
        cursor: 2,
        gap: None,
        frames: vec![
            Frame {
                cursor: 0,
                event: TerminalEvent::Output {
                    session_id: "pty".into(),
                    sequence: 0,
                    bytes: vec![120],
                    eof: false,
                },
            },
            Frame {
                cursor: 1,
                event: TerminalEvent::Exit {
                    session_id: "pty".into(),
                    exit_code: 0,
                    reason: TerminalExitReason::Normal,
                },
            },
        ],
    }
}

fn serve_final_page() -> (Endpoint, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let endpoint = endpoint(&listener);
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        transport::prepare_peer(&stream).unwrap();
        transport::read::<Request>(&mut stream).unwrap();
        transport::write(&mut stream, &Reply::ok(final_page())).unwrap();
    });
    (endpoint, server)
}

#[test]
fn an_exit_keeps_its_last_batch_alive_until_consumed_then_releases_everything() {
    struct Sink(mpsc::Sender<TerminalEvent>);
    impl TerminalEventSink for Sink {
        fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
            self.0
                .send(event)
                .map_err(|error| AppError::io(error.to_string()))
        }
    }
    let (endpoint, server) = serve_final_page();
    let subscription = Arc::new(Subscription::new("pty".into(), true));
    let (sent, received) = mpsc::channel();
    let (finished, done) = mpsc::channel();
    let worker_sub = subscription.clone();
    let worker = thread::spawn(move || {
        worker_sub.run(endpoint, &Sink(sent));
        finished.send(()).unwrap();
    });
    let TerminalEvent::OutputBatch {
        delivery_id,
        events,
        ..
    } = received.recv_timeout(Duration::from_secs(1)).unwrap()
    else {
        panic!("expected one acknowledged batch");
    };
    assert!(matches!(
        events.as_slice(),
        [TerminalEvent::Output { .. }, TerminalEvent::Exit { .. }]
    ));
    assert!(done.recv_timeout(Duration::from_millis(30)).is_err());
    assert!(subscription.acknowledge(delivery_id));
    done.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(!subscription.budget.is_active());
    assert_eq!((0, 0), subscription.budget.outstanding());
    worker.join().unwrap();
    server.join().unwrap();
}

#[test]
fn a_broken_channel_releases_its_reserved_batch() {
    let (endpoint, server) = serve_final_page();
    let subscription = Subscription::new("pty".into(), true);
    subscription.run(
        endpoint,
        &RecordingSink {
            reject: true,
            ..Default::default()
        },
    );
    assert!(!subscription.budget.is_active());
    assert_eq!((0, 0), subscription.budget.outstanding());
    server.join().unwrap();
}

#[test]
fn legacy_sinks_keep_the_original_event_protocol_without_acknowledgements() {
    let (endpoint, server) = serve_final_page();
    let subscription = Subscription::new("pty".into(), false);
    let sink = RecordingSink::default();
    subscription.run(endpoint, &sink);
    assert!(matches!(
        sink.events.lock().unwrap().as_slice(),
        [TerminalEvent::Output { .. }, TerminalEvent::Exit { .. }]
    ));
    assert_eq!((0, 0), subscription.budget.outstanding());
    server.join().unwrap();
}
