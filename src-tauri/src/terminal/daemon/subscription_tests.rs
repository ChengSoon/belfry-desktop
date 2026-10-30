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
fn two_views_of_one_session_stream_side_by_side_and_each_releases_only_its_own_window() {
    let subscriptions = Subscriptions::default();
    // 工作台那一路先挂上。
    let workbench = Arc::new(Subscription::new("pty".into(), true));
    subscriptions.attach(workbench.clone());
    let workbench_id = workbench.budget.reserve(WINDOW_BYTES).unwrap();
    // 看终端打开同一条会话的第二路：工作台那一路必须还活着。
    //
    // 原先这里按会话登记，第二路会把第一路 cancel 掉——工作台的活动判定随即冻在最后
    // 一帧，房间成员行于是长期显示「空闲」，而成员其实正在回话。
    let room = Arc::new(Subscription::new("pty".into(), true));
    subscriptions.attach(room.clone());
    let room_id = room.budget.reserve(WINDOW_BYTES).unwrap();
    assert!(workbench.budget.is_active());
    assert_eq!((WINDOW_BYTES, 1), workbench.budget.outstanding());
    assert!(room.budget.is_active());
    assert_eq!((WINDOW_BYTES, 1), room.budget.outstanding());
    // 确认只认自己那条连接：会话号对不上、或投递号不是它手上那一个，都不释放额度。
    assert!(!subscriptions.acknowledge("other", &room.connection_id, room_id));
    assert!(!subscriptions.acknowledge("pty", &room.connection_id, room_id + 1));
    // 各按自己的回执释放，互不影响：工作台确认完，看终端那一路的窗口照旧挂着。
    assert!(subscriptions.acknowledge("pty", &workbench.connection_id, workbench_id));
    assert_eq!((0, 0), workbench.budget.outstanding());
    assert_eq!((WINDOW_BYTES, 1), room.budget.outstanding());
    assert!(!subscriptions.acknowledge("pty", &workbench.connection_id, workbench_id));
    // 收起看终端只断它自己那一路，工作台那一路不受影响。
    subscriptions.detach("pty", &room.connection_id);
    assert!(!room.budget.is_active());
    assert!(workbench.budget.is_active());
    subscriptions.detach_all();
    assert!(!workbench.budget.is_active());
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
