use super::{
    output_budget::{WINDOW_BATCHES, WINDOW_BYTES},
    protocol::{Command, Endpoint, Reply, Request, VERSION},
    slot::Slot,
    subscription::Subscription,
    transport,
};
use crate::terminal::{
    AppError, TerminalEvent, backend::TerminalEventSink, contracts::TerminalExitReason,
};
use std::{
    net::TcpListener,
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

const CHUNK_BYTES: usize = 64 * 1024;
const STRESS_CHUNKS: u64 = 1024;

struct Sink(mpsc::Sender<TerminalEvent>);
impl TerminalEventSink for Sink {
    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        self.0
            .send(event)
            .map_err(|error| AppError::io(error.to_string()))
    }
}

struct Fixture {
    slot: Arc<Slot>,
    subscription: Arc<Subscription>,
    received: mpsc::Receiver<TerminalEvent>,
    running: Arc<AtomicBool>,
    workers: Vec<thread::JoinHandle<()>>,
}

impl Fixture {
    fn new() -> Self {
        let request = serde_json::from_value(
            serde_json::json!({ "platform": "macos", "profileId": "shell:bash",
            "cols": 80, "rows": 24, "elevation": "normal" }),
        )
        .unwrap();
        let slot = Slot::new(&request, Weak::new());
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = Endpoint {
            version: VERSION,
            port: listener.local_addr().unwrap().port(),
            token: "test".into(),
            instance: "test".into(),
            pid: std::process::id(),
        };
        let running = Arc::new(AtomicBool::new(true));
        let (server_slot, server_running) = (slot.clone(), running.clone());
        let server = thread::spawn(move || serve(listener, server_slot, server_running));
        let subscription = Arc::new(Subscription::new("pty".into(), true));
        let (sent, received) = mpsc::channel();
        let worker_sub = subscription.clone();
        let worker = thread::spawn(move || worker_sub.run(endpoint, &Sink(sent)));
        Self {
            slot,
            subscription,
            received,
            running,
            workers: vec![worker, server],
        }
    }

    fn receive(&self) -> (u64, Vec<TerminalEvent>) {
        match self.received.recv_timeout(Duration::from_secs(5)).unwrap() {
            TerminalEvent::OutputBatch {
                delivery_id,
                events,
                connection_id,
                session_id,
            } => {
                assert_eq!("pty", session_id);
                assert_eq!(self.subscription.connection_id, connection_id);
                (delivery_id, events)
            }
            other => panic!("unexpected terminal event: {other:?}"),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.subscription.cancel();
        self.running.store(false, Ordering::Release);
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}

fn serve(listener: TcpListener, slot: Arc<Slot>, running: Arc<AtomicBool>) {
    while running.load(Ordering::Acquire) {
        let Ok((mut stream, _)) = listener.accept() else {
            thread::sleep(Duration::from_millis(2));
            continue;
        };
        if transport::prepare_peer(&stream).is_err() {
            continue;
        }
        let Ok(Request {
            command: Command::Poll { id, cursor },
            ..
        }) = transport::read::<Request>(&mut stream)
        else {
            continue;
        };
        let reply = match slot.poll(&id, cursor) {
            Ok(page) => Reply::ok(page),
            Err(error) => Reply::error(error),
        };
        let _ = transport::write(&mut stream, &reply);
    }
}

fn output(sequence: u64) -> TerminalEvent {
    TerminalEvent::Output {
        session_id: "pty".into(),
        sequence,
        bytes: vec![(sequence % 256) as u8; CHUNK_BYTES],
        eof: false,
    }
}

fn exit() -> TerminalEvent {
    TerminalEvent::Exit {
        session_id: "pty".into(),
        exit_code: 0,
        reason: TerminalExitReason::Normal,
    }
}

#[derive(Default)]
struct Consumption {
    next: u64,
    bytes: usize,
    gaps: u64,
    peak: usize,
    ended: bool,
}

impl Consumption {
    fn accept(&mut self, fixture: &Fixture, batch: (u64, Vec<TerminalEvent>)) {
        let (bytes, count) = fixture.subscription.budget.outstanding();
        assert!(bytes <= WINDOW_BYTES && count <= WINDOW_BATCHES);
        self.peak = self.peak.max(bytes);
        for event in batch.1 {
            match event {
                TerminalEvent::Output {
                    sequence, bytes, ..
                } => {
                    assert_eq!(self.next, sequence);
                    assert!(bytes.iter().all(|byte| *byte == (sequence % 256) as u8));
                    self.next += 1;
                    self.bytes += bytes.len();
                }
                TerminalEvent::ReplayGap {
                    next_sequence,
                    dropped_events,
                    ..
                } => {
                    assert!(next_sequence > self.next && dropped_events > 0);
                    self.next = next_sequence;
                    self.gaps += dropped_events;
                }
                TerminalEvent::Exit { .. } => self.ended = true,
                other => panic!("unexpected inner event: {other:?}"),
            }
        }
        assert!(fixture.subscription.acknowledge(batch.0));
    }
}

#[test]
fn a_slow_consumer_keeps_all_ordered_bytes_while_the_replay_window_is_sufficient() {
    let fixture = Fixture::new();
    for sequence in 0..12 {
        fixture.slot.push(output(sequence));
    }
    fixture.slot.push(exit());
    let mut consumed = Consumption::default();
    while !consumed.ended {
        let batch = fixture.receive();
        thread::sleep(Duration::from_millis(2));
        consumed.accept(&fixture, batch);
    }
    assert_eq!(12 * CHUNK_BYTES, consumed.bytes);
    assert_eq!(12, consumed.next);
    assert_eq!(0, consumed.gaps);
}

#[test]
fn sixty_four_mebibytes_continue_in_background_and_overflow_is_an_explicit_gap() {
    let fixture = Fixture::new();
    for sequence in 0..4 {
        fixture.slot.push(output(sequence));
    }
    // 3 个 64 KiB 块占满可用预算，第四块必须等待，不能挤入 IPC。
    let held = (0..3).map(|_| fixture.receive()).collect::<Vec<_>>();
    let started = Instant::now();
    let producer_slot = fixture.slot.clone();
    let producer = thread::spawn(move || {
        for sequence in 4..(4 + STRESS_CHUNKS) {
            producer_slot.push(output(sequence));
        }
        producer_slot.push(exit());
    });
    producer.join().unwrap();
    assert!(
        fixture.received.try_recv().is_err(),
        "no more delivery before consumption"
    );
    let mut consumed = Consumption::default();
    for batch in held {
        consumed.accept(&fixture, batch);
    }
    while !consumed.ended {
        consumed.accept(&fixture, fixture.receive());
    }
    assert_eq!(4 + STRESS_CHUNKS, consumed.next);
    assert!(consumed.gaps > 0);
    eprintln!(
        "terminal simulated stress: produced={} MiB, delivered={} bytes, peak={} / {} bytes, dropped_events={}, elapsed={:.2}s",
        STRESS_CHUNKS * CHUNK_BYTES as u64 / 1024 / 1024,
        consumed.bytes,
        consumed.peak,
        WINDOW_BYTES,
        consumed.gaps,
        started.elapsed().as_secs_f64()
    );
}
