use super::*;
use crate::usage::analytics::{cache::FileCache, fixtures::*, service};
use crate::usage::contracts::UsageQuery;
use std::{
    future::Future,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    task::{Context, Poll, Wake, Waker},
    thread,
};

const HANDOFF_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub(super) struct Hooks {
    pub(super) before_attach: Hook,
    pub(super) before_wake: Hook,
}

#[derive(Default)]
pub(super) struct Hook(Mutex<Option<Box<dyn FnOnce() + Send>>>);

impl Hook {
    pub(super) fn run(&self) {
        let hook = self.0.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
    }

    fn pause(&self) -> Pause {
        let (reached, arrived) = mpsc::channel();
        let (resume, continued) = mpsc::channel();
        *self.0.lock().unwrap() = Some(Box::new(move || {
            reached.send(()).unwrap();
            continued.recv_timeout(HANDOFF_TIMEOUT).unwrap();
        }));
        Pause { arrived, resume }
    }
}

struct Pause {
    arrived: Receiver<()>,
    resume: Sender<()>,
}

impl Pause {
    fn reached(&self) {
        self.arrived.recv_timeout(HANDOFF_TIMEOUT).unwrap();
    }

    fn resume(self) {
        self.resume.send(()).unwrap();
    }
}

#[derive(Clone, Copy)]
enum Departure {
    Cancel,
    Drop,
}

fn key() -> QueryKey {
    QueryKey::new(&UsageQuery::default())
}

fn handoff(registry: &Arc<Registry>, old: Ticket, departure: Departure) -> Ticket {
    let leaving = registry.handoff.before_wake.pause();
    let joining = registry.handoff.before_attach.pause();
    let (released, finished) = mpsc::channel();
    let departing_registry = registry.clone();
    let departing = thread::spawn(move || match departure {
        Departure::Cancel => {
            departing_registry.cancel("old").unwrap();
            // Ticket 随后 drop 可能等待新请求持有的 Registry 锁，先报告 cancel 已完成。
            released.send(()).unwrap();
            drop(old);
        }
        Departure::Drop => {
            drop(old);
            released.send(()).unwrap();
        }
    });
    leaving.reached();
    let joining_registry = registry.clone();
    let next = thread::spawn(move || joining_registry.begin("new".into(), key()).unwrap());
    joining.reached();
    // 旧实现会在 pending 成功、attach 之前完成最后一次 release，取消新请求选中的 Job。
    leaving.resume();
    finished.recv_timeout(HANDOFF_TIMEOUT).unwrap();
    joining.resume();
    let next = next.join().unwrap();
    departing.join().unwrap();
    next
}

fn complete_job(registry: &Registry, job: &Arc<Job>, fixture: &Fixture) {
    let result = service::refresh(
        &mut FileCache::default(),
        service::ScanRequest {
            query: &UsageQuery::default(),
            now: now(),
            roots: &fixture.roots,
            check: &|| job.cancel.check(),
        },
    );
    job.complete(result);
    registry.finished(job);
}

fn assert_complete_handoff(departure: Departure) {
    let fixture = Fixture::new();
    fixture.write(
        "claude/usage.jsonl",
        &[claude("one", 40), claude("two", 50)],
    );
    let expected = fixture.query(&mut FileCache::default(), &UsageQuery::default());
    let registry = Arc::new(Registry::default());
    let old = registry.begin("old".into(), key()).unwrap();
    let old_job = old.job.clone();
    let next = handoff(&registry, old, departure);
    complete_job(&registry, &old_job, &fixture);
    if next.leader {
        complete_job(&registry, &next.job, &fixture);
    }
    let actual = tauri::async_runtime::block_on(next.wait())
        .expect("new consumer must receive the complete report, not the old cancellation");
    assert_eq!(210, total(&actual));
    assert_eq!(semantic(&expected), semantic(&actual));
    drop(next);
    assert_eq!((0, 0), registry.counts());
}

#[test]
fn explicit_cancel_handoff_keeps_the_new_consumers_complete_result() {
    assert_complete_handoff(Departure::Cancel);
}

#[test]
fn ticket_drop_handoff_keeps_the_new_consumers_complete_result() {
    assert_complete_handoff(Departure::Drop);
}

struct ReentrantWake {
    registry: Arc<Registry>,
    calls: AtomicUsize,
}

impl Wake for ReentrantWake {
    fn wake(self: Arc<Self>) {
        assert!(
            self.registry.entries.try_lock().is_ok(),
            "consumer wake must happen outside the Registry lock"
        );
        let next = self.registry.begin("from-wake".into(), key()).unwrap();
        assert!(next.leader);
        self.registry.finished(&next.job);
        self.calls.fetch_add(1, Ordering::Relaxed);
    }
}

#[test]
fn cancel_and_ticket_drop_wake_consumers_outside_the_registry_lock() {
    for departure in [Departure::Cancel, Departure::Drop] {
        let registry = Arc::new(Registry::default());
        let ticket = registry.begin("old".into(), key()).unwrap();
        let job = ticket.job.clone();
        let subscriber = ticket.subscriber.clone();
        let wake = Arc::new(ReentrantWake {
            registry: registry.clone(),
            calls: AtomicUsize::new(0),
        });
        let waker = Waker::from(wake.clone());
        let mut waiting = Box::pin(job.wait("old", &subscriber.cancel));
        assert!(matches!(
            waiting.as_mut().poll(&mut Context::from_waker(&waker)),
            Poll::Pending
        ));
        if matches!(departure, Departure::Cancel) {
            registry.cancel("old").unwrap();
        }
        drop(ticket);
        assert_eq!(1, wake.calls.load(Ordering::Relaxed));
        assert_eq!(
            CANCELLED,
            tauri::async_runtime::block_on(waiting).unwrap_err()
        );
        registry.finished(&job);
        assert_eq!((0, 0), registry.counts());
    }
}
