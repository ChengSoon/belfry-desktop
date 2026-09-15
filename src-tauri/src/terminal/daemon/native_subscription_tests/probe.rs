use super::super::{
    DaemonClient,
    output_budget::{WINDOW_BATCHES, WINDOW_BYTES},
    replay::event_size,
};
use super::fixture::wait_for;
use crate::terminal::{
    AppError, CreateTerminalRequest, TerminalEvent,
    backend::{PtyBackend, TerminalEventSink},
    contracts::{TerminalExitReason, TerminalSession},
};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, Weak, mpsc},
    time::Duration,
};

#[derive(Clone, Default, Debug)]
pub(super) struct Ledger {
    pub pending: VecDeque<(u64, usize)>,
    pub bytes: usize,
    pub peak_bytes: usize,
    pub peak_batches: usize,
}

struct AckSink {
    sender: mpsc::Sender<TerminalEvent>,
    ledger: Arc<Mutex<Ledger>>,
}

impl TerminalEventSink for AckSink {
    fn uses_output_acknowledgements(&self) -> bool {
        true
    }

    fn send(&self, event: TerminalEvent) -> Result<(), AppError> {
        if let TerminalEvent::OutputBatch {
            delivery_id,
            events,
            ..
        } = &event
        {
            let bytes = events.iter().map(event_size).sum::<usize>();
            let mut ledger = self.ledger.lock().unwrap();
            ledger.pending.push_back((*delivery_id, bytes));
            ledger.bytes += bytes;
            ledger.peak_bytes = ledger.peak_bytes.max(ledger.bytes);
            ledger.peak_batches = ledger.peak_batches.max(ledger.pending.len());
            assert!(ledger.bytes <= WINDOW_BYTES, "{ledger:?}");
            assert!(ledger.pending.len() <= WINDOW_BATCHES, "{ledger:?}");
        }
        self.sender
            .send(event)
            .map_err(|error| AppError::io(error.to_string()))
    }
}

pub(super) struct Batch {
    pub id: u64,
    pub events: Vec<TerminalEvent>,
}

pub(super) struct Probe {
    pub session: TerminalSession,
    receiver: mpsc::Receiver<TerminalEvent>,
    ledger: Arc<Mutex<Ledger>>,
    lifetime: Weak<AckSink>,
    next_delivery: u64,
}

impl Probe {
    pub fn spawn(client: &DaemonClient, request: CreateTerminalRequest) -> Self {
        let (sender, receiver) = mpsc::channel();
        let ledger = Arc::new(Mutex::new(Ledger::default()));
        let sink = Arc::new(AckSink {
            sender,
            ledger: ledger.clone(),
        });
        let lifetime = Arc::downgrade(&sink);
        let session = client.spawn(request, sink).unwrap();
        Self {
            session,
            receiver,
            ledger,
            lifetime,
            next_delivery: 1,
        }
    }

    pub fn connection(&self) -> &str {
        self.session.connection_id.as_deref().unwrap()
    }

    pub fn snapshot(&self) -> Ledger {
        self.ledger.lock().unwrap().clone()
    }

    pub fn receive(&mut self) -> Batch {
        let event = self.receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        let TerminalEvent::OutputBatch {
            session_id,
            connection_id,
            delivery_id,
            events,
        } = event
        else {
            panic!("unexpected subscription event: {event:?}");
        };
        assert_eq!(self.session.id, session_id);
        assert_eq!(self.connection(), connection_id);
        assert_eq!(self.next_delivery, delivery_id);
        self.next_delivery += 1;
        Batch {
            id: delivery_id,
            events,
        }
    }

    pub fn acknowledge(&self, client: &DaemonClient, delivery: u64) {
        // ACK 与账本扣减共用此锁，防止新 send 抢先记账而产生虚假的峰值。
        let mut ledger = self.ledger.lock().unwrap();
        let (expected, bytes) = ledger.pending.pop_front().unwrap();
        assert_eq!(expected, delivery);
        assert!(client.acknowledge(&self.session.id, self.connection(), delivery));
        ledger.bytes -= bytes;
    }

    pub fn wait_detached(&self) {
        wait_for("subscription sink release", || {
            self.lifetime.strong_count() == 0
        });
    }

    pub fn resume_with_isolated_ack(&mut self, client: &DaemonClient, old: &Self) -> Stream {
        let first = self.receive();
        wait_for("multiple pending native batches", || {
            self.snapshot().pending.len() >= 2
        });
        let later = self.snapshot().pending.back().unwrap().0;
        let stale = old.next_delivery - 1;
        assert!(!client.acknowledge(&old.session.id, old.connection(), stale));
        client.detach(&old.session.id, old.connection());
        assert!(!client.acknowledge(&self.session.id, self.connection(), later));
        let mut stream = Stream::default();
        stream.record(&self.session.id, first.events);
        self.acknowledge(client, first.id);
        assert!(!client.acknowledge(&self.session.id, self.connection(), first.id));
        eprintln!(
            "native ACK isolation: rejected_old_delivery={stale}, rejected_pending_delivery={later}, duplicate_rejected=true"
        );
        stream
    }

    pub fn drain(&mut self, client: &DaemonClient, mut stream: Stream) -> Stream {
        loop {
            let batch = self.receive();
            stream.record(&self.session.id, batch.events);
            if stream.exits == 0 {
                self.acknowledge(client, batch.id);
                continue;
            }
            // Exit 已到达，但订阅必须继续等待最后一次消费确认。
            assert!(matches!(
                self.receiver.recv_timeout(Duration::from_millis(40)),
                Err(mpsc::RecvTimeoutError::Timeout)
            ));
            assert!(self.lifetime.strong_count() > 0);
            self.acknowledge(client, batch.id);
            assert!(!client.acknowledge(&self.session.id, self.connection(), batch.id));
            self.wait_detached();
            assert!(matches!(
                self.receiver.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
            assert_eq!(0, self.snapshot().bytes);
            assert!(self.snapshot().pending.is_empty());
            assert_eq!((1, 1), (stream.eofs, stream.exits));
            stream.deliveries = self.next_delivery - 1;
            return stream;
        }
    }
}

#[derive(Default)]
pub(super) struct Stream {
    pub bytes: Vec<u8>,
    pub tail_start: usize,
    pub gaps: usize,
    pub dropped_events: u64,
    pub deliveries: u64,
    next_sequence: u64,
    eofs: usize,
    exits: usize,
}

impl Stream {
    pub fn record(&mut self, session: &str, events: Vec<TerminalEvent>) {
        for event in events {
            assert_eq!(0, self.exits, "event delivered after Exit");
            match event {
                TerminalEvent::Output {
                    session_id,
                    sequence,
                    bytes,
                    eof,
                } => {
                    assert_eq!(session, session_id);
                    assert_eq!(0, self.eofs, "output delivered after EOF");
                    assert_eq!(self.next_sequence, sequence);
                    self.next_sequence += 1;
                    self.bytes.extend(bytes);
                    self.eofs += usize::from(eof);
                }
                TerminalEvent::ReplayGap {
                    session_id,
                    next_sequence,
                    dropped_events,
                } => {
                    assert_eq!(session, session_id);
                    assert!(next_sequence > self.next_sequence && dropped_events > 0);
                    self.next_sequence = next_sequence;
                    self.gaps += 1;
                    self.dropped_events += dropped_events;
                    self.tail_start = self.bytes.len();
                }
                TerminalEvent::Exit {
                    session_id,
                    exit_code,
                    reason,
                } => {
                    assert_eq!(session, session_id);
                    assert_eq!(1, self.eofs);
                    assert_eq!(0, exit_code);
                    assert_eq!(TerminalExitReason::Normal, reason);
                    self.exits += 1;
                }
                other => panic!("unexpected native event: {other:?}"),
            }
        }
    }

    pub fn report(&self, name: &str, ledger: &Ledger) {
        eprintln!(
            "native ACK {name}: delivered_bytes={}, batches={}, gaps={}, dropped_events={}, peak_bytes={}, peak_batches={}, EOF={}, Exit={}",
            self.bytes.len(),
            self.deliveries,
            self.gaps,
            self.dropped_events,
            ledger.peak_bytes,
            ledger.peak_batches,
            self.eofs,
            self.exits
        );
    }
}
