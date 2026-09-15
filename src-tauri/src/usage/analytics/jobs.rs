use super::{cancel::Cancellation, contracts::AnalyticsReport};
use crate::usage::contracts::UsageQuery;
use std::{
    collections::HashMap,
    future::poll_fn,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    task::{Poll, Waker},
};

#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct QueryKey {
    window_days: Option<u32>,
    project_root: Option<String>,
}

impl QueryKey {
    pub fn new(query: &UsageQuery) -> Self {
        Self {
            window_days: query.window_days.filter(|days| *days > 0),
            project_root: query
                .project_root
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(ToOwned::to_owned),
        }
    }
}

type SharedResult = Result<Arc<AnalyticsReport>, String>;

#[derive(Default)]
struct Completion {
    result: Option<SharedResult>,
    waiters: HashMap<String, Waker>,
}

pub(super) struct Job {
    pub key: QueryKey,
    pub cancel: Cancellation,
    consumers: AtomicUsize,
    completion: Mutex<Completion>,
}

impl Job {
    pub fn new(key: QueryKey) -> Self {
        Self {
            key,
            cancel: Cancellation::default(),
            consumers: AtomicUsize::new(0),
            completion: Mutex::default(),
        }
    }

    pub fn attach(&self) {
        self.consumers.fetch_add(1, Ordering::AcqRel);
    }

    /// 成员变更由 Registry 锁串行化；这里只改状态，唤醒必须留到锁外。
    pub fn release(&self) {
        if self.consumers.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.cancel.cancel();
        }
    }

    pub fn pending(&self) -> bool {
        self.cancel.check().is_ok()
            && self
                .completion
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .result
                .is_none()
    }

    pub async fn wait(&self, id: &str, cancel: &Cancellation) -> SharedResult {
        poll_fn(|context| {
            let mut completion = self
                .completion
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if let Err(error) = cancel.check() {
                return Poll::Ready(Err(error));
            }
            if let Some(result) = &completion.result {
                return Poll::Ready(result.clone());
            }
            completion
                .waiters
                .insert(id.to_string(), context.waker().clone());
            Poll::Pending
        })
        .await
    }

    pub fn complete(&self, result: Result<AnalyticsReport, String>) {
        let waiters = {
            let mut completion = self
                .completion
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            completion.result = Some(result.map(Arc::new));
            std::mem::take(&mut completion.waiters)
        };
        for waker in waiters.into_values() {
            waker.wake();
        }
    }

    pub fn wake(&self, id: &str) {
        let waker = self
            .completion
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .waiters
            .remove(id);
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}
