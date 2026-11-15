use std::{
    collections::HashMap,
    future::{Future, poll_fn},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    task::{Poll, Waker},
    time::{Duration, Instant},
};

use super::{
    errors::{canceled, error},
    validation,
};
use crate::terminal::AppError;

const TOMBSTONE_TTL: Duration = Duration::from_secs(120);
const MAX_TOMBSTONES: usize = 1024;

#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct Owner {
    pub root: String,
    pub ticket: Option<String>,
}
impl Owner {
    pub(super) fn ui(root: String) -> Self {
        Self { root, ticket: None }
    }
    pub(super) fn agent(root: String, ticket: String) -> Self {
        Self {
            root,
            ticket: Some(ticket),
        }
    }
}

#[derive(Default)]
pub(super) struct CancelSignal {
    canceled: AtomicBool,
    waker: Mutex<Option<Waker>>,
}
impl CancelSignal {
    pub(super) fn cancel(&self) {
        self.canceled.store(true, Ordering::Release);
        let waker = self.waker.lock().ok().and_then(|mut waker| waker.take());
        if let Some(waker) = waker {
            waker.wake();
        }
    }

    pub(super) fn check(&self) -> Result<(), AppError> {
        if self.canceled.load(Ordering::Acquire) {
            Err(canceled())
        } else {
            Ok(())
        }
    }

    /// Cancellation wakes the pending HTTP operation and drops its future/socket.
    pub(super) async fn run<F: Future>(&self, future: F) -> Result<F::Output, AppError> {
        let mut future = std::pin::pin!(future);
        poll_fn(|cx| {
            let Ok(mut waker) = self.waker.lock() else {
                return Poll::Ready(Err(canceled()));
            };
            *waker = Some(cx.waker().clone());
            if self.canceled.load(Ordering::Acquire) {
                return Poll::Ready(Err(canceled()));
            }
            // Never hold the mutex while the network future or its wake callback runs.
            drop(waker);
            match future.as_mut().poll(cx) {
                Poll::Ready(output) => Poll::Ready(self.check().map(|_| output)),
                Poll::Pending => Poll::Pending,
            }
        })
        .await
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    owner: Owner,
    id: String,
}

struct Entry {
    signal: Arc<CancelSignal>,
    connection: Option<(String, String)>,
}

#[derive(Default)]
struct State {
    active: HashMap<Key, Entry>,
    tombstones: HashMap<Key, Instant>,
    revoked: HashMap<String, Instant>,
    stopped: bool,
}
impl State {
    fn prune(&mut self) {
        self.tombstones
            .retain(|_, time| time.elapsed() < TOMBSTONE_TTL);
        self.revoked
            .retain(|_, time| time.elapsed() < TOMBSTONE_TTL);
    }
}

#[derive(Clone, Default)]
pub(super) struct Requests(Arc<Mutex<State>>);

pub(super) struct Lease {
    requests: Requests,
    key: Key,
    pub signal: Arc<CancelSignal>,
}

impl Requests {
    pub(super) fn begin(&self, owner: &Owner, id: &str) -> Result<Lease, AppError> {
        validation::request_id(id)?;
        let mut state = self.0.lock().map_err(|_| canceled())?;
        state.prune();
        let key = Key {
            owner: owner.clone(),
            id: id.into(),
        };
        if state.stopped
            || owner
                .ticket
                .as_ref()
                .is_some_and(|ticket| state.revoked.contains_key(ticket))
        {
            return Err(canceled());
        }
        if state.tombstones.contains_key(&key) {
            return Err(canceled());
        }
        if state.active.contains_key(&key) {
            return Err(error(
                "A2A_REQUEST_CONFLICT",
                "This A2A request ID is already in use.",
            ));
        }
        if state.active.len() >= 64
            || state
                .active
                .keys()
                .filter(|key| &key.owner == owner)
                .count()
                >= 8
            || state.tombstones.len() + state.active.len() >= MAX_TOMBSTONES
        {
            return Err(error(
                "A2A_REQUEST_LIMIT",
                "Too many A2A requests are pending. Wait for them to finish before starting another.",
            ));
        }
        let signal = Arc::new(CancelSignal::default());
        state.active.insert(
            key.clone(),
            Entry {
                signal: signal.clone(),
                connection: None,
            },
        );
        Ok(Lease {
            requests: self.clone(),
            key,
            signal,
        })
    }

    pub(super) fn cancel(&self, owner: &Owner, id: &str) -> Result<bool, AppError> {
        validation::request_id(id)?;
        let mut state = self.0.lock().map_err(|_| canceled())?;
        state.prune();
        let key = Key {
            owner: owner.clone(),
            id: id.into(),
        };
        if let Some(entry) = state.active.get(&key) {
            entry.signal.cancel();
            return Ok(true);
        }
        if !state.tombstones.contains_key(&key)
            && state.tombstones.len() + state.active.len() >= MAX_TOMBSTONES
        {
            return Err(error(
                "A2A_REQUEST_LIMIT",
                "The A2A cancellation registry is full. The cancellation was not accepted.",
            ));
        }
        // An early cancel is still authoritative if its request arrives later.
        state.tombstones.insert(key, Instant::now());
        Ok(false)
    }

    pub(super) fn invalidate_connection(&self, root: &str, id: &str) {
        if let Ok(state) = self.0.lock() {
            for entry in state.active.values() {
                if entry
                    .connection
                    .as_ref()
                    .is_some_and(|(r, i)| r == root && i == id)
                {
                    entry.signal.cancel();
                }
            }
        }
    }

    pub(super) fn invalidate_session(&self, ticket: &str) {
        if let Ok(mut state) = self.0.lock() {
            state.prune();
            for (key, entry) in &state.active {
                if key.owner.ticket.as_deref() == Some(ticket) {
                    entry.signal.cancel();
                }
            }
            if state.revoked.len() >= MAX_TOMBSTONES {
                // Fail closed until restart rather than forget a revoked generation.
                state.stopped = true;
                for entry in state.active.values() {
                    entry.signal.cancel();
                }
            } else {
                state.revoked.insert(ticket.into(), Instant::now());
            }
        }
    }

    pub(super) fn stop(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.stopped = true;
            for entry in state.active.values() {
                entry.signal.cancel();
            }
        }
    }
}

impl Lease {
    pub(super) fn bind(&self, root: &str, id: &str) -> Result<(), AppError> {
        self.signal.check()?;
        let mut state = self.requests.0.lock().map_err(|_| canceled())?;
        let entry = state.active.get_mut(&self.key).ok_or_else(canceled)?;
        entry.connection = Some((root.into(), id.into()));
        self.signal.check()
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.requests.0.lock() {
            if state
                .active
                .get(&self.key)
                .is_some_and(|entry| Arc::ptr_eq(&entry.signal, &self.signal))
            {
                state.active.remove(&self.key);
                state.prune();
                // Active requests reserve their completion tombstone when begun.
                if state.tombstones.len() < MAX_TOMBSTONES {
                    state.tombstones.insert(self.key.clone(), Instant::now());
                }
            }
        }
    }
}
