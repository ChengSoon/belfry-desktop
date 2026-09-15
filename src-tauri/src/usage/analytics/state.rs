use super::{
    cache::FileCache,
    contracts::AnalyticsReport,
    jobs::{Job, QueryKey},
    range::UsagePeriod,
    registry::Registry,
    service::{self, ScanRequest},
    sources::SourceRoots,
};
use crate::usage::{contracts::UsageQuery, timestamp::now_epoch_seconds};
use std::{
    sync::{Arc, Mutex, TryLockError},
    time::Duration,
};

const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(5);
const MAX_QUERY_PATH_BYTES: usize = 32_768;

#[derive(Clone, Default)]
pub(crate) struct UsageAnalyticsState {
    cache: Arc<Mutex<FileCache>>,
    registry: Arc<Registry>,
    roots: Option<SourceRoots>,
}

impl UsageAnalyticsState {
    pub async fn query(
        &self,
        query: UsageQuery,
        request_id: Option<String>,
    ) -> Result<AnalyticsReport, String> {
        UsagePeriod::new(&query, now_epoch_seconds())?;
        if query
            .project_root
            .as_ref()
            .is_some_and(|path| path.len() > MAX_QUERY_PATH_BYTES)
        {
            return Err("统计项目路径过长".into());
        }
        let id = request_id.unwrap_or_else(|| ulid::Ulid::generate().to_string());
        let ticket = self.registry.begin(id, QueryKey::new(&query))?;
        if ticket.leader {
            self.start(ticket.job.clone(), query);
        }
        ticket.wait().await.map(|report| (*report).clone())
    }

    pub fn cancel(&self, request_id: &str) -> Result<(), String> {
        self.registry.cancel(request_id)
    }

    fn start(&self, job: Arc<Job>, query: UsageQuery) {
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            let worker = state.clone();
            let scan = job.clone();
            let result =
                tauri::async_runtime::spawn_blocking(move || worker.collect(&query, &scan))
                    .await
                    .unwrap_or_else(|error| Err(format!("用量扫描失败：{error}")));
            job.complete(result);
            state.registry.finished(&job);
        });
    }

    fn collect(&self, query: &UsageQuery, job: &Job) -> Result<AnalyticsReport, String> {
        loop {
            job.cancel.check()?;
            match self.cache.try_lock() {
                Ok(mut cache) => {
                    return service::refresh(
                        &mut cache,
                        ScanRequest {
                            query,
                            now: now_epoch_seconds(),
                            roots: &self.roots.clone().unwrap_or_default(),
                            check: &|| job.cancel.check(),
                        },
                    );
                }
                Err(TryLockError::WouldBlock) => std::thread::sleep(CANCEL_POLL_INTERVAL),
                Err(TryLockError::Poisoned(_)) => {
                    return Err("用量缓存状态不可用，请重启后重试".into());
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
