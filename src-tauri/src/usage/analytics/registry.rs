use super::{
    cancel::{CANCELLED, Cancellation},
    jobs::{Job, QueryKey},
};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const MAX_REQUESTS: usize = 64;
const MAX_RUNNING_JOBS: usize = 8;
const MAX_CANCELLED_IDS: usize = 256;
const MAX_ID_BYTES: usize = 128;
const CANCEL_TTL: Duration = Duration::from_secs(30);

struct Subscriber {
    job: Arc<Job>,
    cancel: Cancellation,
}

#[derive(Default)]
struct Entries {
    active: HashMap<String, Arc<Subscriber>>,
    jobs: HashMap<QueryKey, Arc<Job>>,
    cancelled: VecDeque<(String, Instant)>,
    running: usize,
}

#[derive(Default)]
pub(super) struct Registry {
    entries: Mutex<Entries>,
    #[cfg(test)]
    handoff: handoff_tests::Hooks,
}

pub(super) struct Ticket {
    registry: Arc<Registry>,
    id: String,
    subscriber: Arc<Subscriber>,
    pub leader: bool,
    pub job: Arc<Job>,
}

impl Registry {
    pub fn begin(self: &Arc<Self>, id: String, key: QueryKey) -> Result<Ticket, String> {
        validate_id(&id)?;
        let mut entries = self.entries.lock().map_err(|_| "用量请求状态不可用")?;
        prune(&mut entries.cancelled);
        if entries
            .cancelled
            .iter()
            .any(|(cancelled, _)| cancelled == &id)
        {
            return Err(CANCELLED.into());
        }
        if entries.active.contains_key(&id) {
            return Err("用量请求 ID 已被使用".into());
        }
        if entries.active.len() >= MAX_REQUESTS {
            return Err("同时进行的用量请求过多，请稍后重试".into());
        }
        let (job, leader) = entries.job(key)?;
        #[cfg(test)]
        self.handoff.before_attach.run();
        job.attach();
        let subscriber = Arc::new(Subscriber {
            job: job.clone(),
            cancel: Cancellation::default(),
        });
        entries.active.insert(id.clone(), subscriber.clone());
        Ok(Ticket {
            registry: self.clone(),
            id,
            subscriber,
            leader,
            job,
        })
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let subscriber = {
            let mut entries = self.entries.lock().map_err(|_| "用量请求状态不可用")?;
            prune(&mut entries.cancelled);
            entries.cancelled.retain(|(previous, _)| previous != id);
            entries
                .cancelled
                .push_back((id.to_string(), Instant::now()));
            while entries.cancelled.len() > MAX_CANCELLED_IDS {
                entries.cancelled.pop_front();
            }
            entries.remove_subscriber(id)
        };
        #[cfg(test)]
        self.handoff.before_wake.run();
        if let Some(subscriber) = subscriber {
            subscriber.job.wake(id);
        }
        Ok(())
    }

    pub fn finished(&self, job: &Arc<Job>) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries
            .jobs
            .get(&job.key)
            .is_some_and(|current| Arc::ptr_eq(current, job))
        {
            entries.jobs.remove(&job.key);
        }
        entries.running -= 1;
    }

    fn release(&self, id: &str, subscriber: &Arc<Subscriber>) {
        let removed = {
            let mut entries = self
                .entries
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if entries
                .active
                .get(id)
                .is_some_and(|current| Arc::ptr_eq(current, subscriber))
            {
                entries.remove_subscriber(id)
            } else {
                None
            }
        };
        #[cfg(test)]
        self.handoff.before_wake.run();
        if let Some(subscriber) = removed {
            subscriber.job.wake(id);
        }
    }
}

impl Entries {
    fn remove_subscriber(&mut self, id: &str) -> Option<Arc<Subscriber>> {
        let subscriber = self.active.remove(id)?;
        subscriber.cancel.cancel();
        // 与 job.pending()/attach() 共用 Registry 锁，不能让新消费者接上已取消的 Job。
        subscriber.job.release();
        Some(subscriber)
    }

    fn job(&mut self, key: QueryKey) -> Result<(Arc<Job>, bool), String> {
        if let Some(job) = self.jobs.get(&key).filter(|job| job.pending()) {
            return Ok((job.clone(), false));
        }
        if self.running >= MAX_RUNNING_JOBS {
            return Err("用量扫描正在清理旧请求，请稍后重试".into());
        }
        let job = Arc::new(Job::new(key.clone()));
        self.jobs.insert(key, job.clone());
        self.running += 1;
        Ok((job, true))
    }
}

impl Ticket {
    pub async fn wait(&self) -> Result<Arc<super::contracts::AnalyticsReport>, String> {
        self.job.wait(&self.id, &self.subscriber.cancel).await
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        self.registry.release(&self.id, &self.subscriber);
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES {
        Err("无效的用量请求 ID".into())
    } else {
        Ok(())
    }
}

fn prune(ids: &mut VecDeque<(String, Instant)>) {
    while ids
        .front()
        .is_some_and(|(_, at)| at.elapsed() >= CANCEL_TTL)
    {
        ids.pop_front();
    }
}

#[cfg(test)]
impl Registry {
    pub fn counts(&self) -> (usize, usize) {
        let entries = self.entries.lock().unwrap();
        (entries.active.len(), entries.running)
    }
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "registry_handoff_tests.rs"]
mod handoff_tests;
