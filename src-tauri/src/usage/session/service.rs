use super::{
    cache::SessionCache,
    contracts::{SessionStatistics, SessionStatisticsQuery},
    paths,
};
use crate::{
    agent::{AgentKind, AgentSessionRef},
    terminal::AppError,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const MAX_CACHED_SESSIONS: usize = 16;
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Clone, Eq, Hash, PartialEq)]
struct Key {
    agent: AgentKind,
    id: String,
    root: PathBuf,
}

struct Slot {
    used_at: Instant,
    cache: Arc<Mutex<CachedSession>>,
}

struct CachedSession {
    cache: SessionCache,
    discovered_at: Option<Instant>,
    hint: Option<String>,
    paths: paths::Resolved,
}

#[derive(Default)]
pub(crate) struct SessionStatisticsState {
    slots: Mutex<HashMap<Key, Slot>>,
}

impl SessionStatisticsState {
    pub fn read(&self, query: SessionStatisticsQuery) -> Result<SessionStatistics, AppError> {
        self.read_in(&paths::root(query.session.agent)?, query)
    }

    pub(super) fn read_in(
        &self,
        root: &Path,
        query: SessionStatisticsQuery,
    ) -> Result<SessionStatistics, AppError> {
        query
            .session
            .validate()
            .map_err(AppError::invalid_argument)?;
        let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let key = Key {
            agent: query.session.agent,
            id: query.session.id.clone(),
            root: root.clone(),
        };
        let slot = self.slot(key, query.session.clone())?;
        let mut cached = slot
            .lock()
            .map_err(|_| AppError::io("会话统计缓存不可用"))?;
        cached.refresh(&root, &query)
    }

    fn slot(
        &self,
        key: Key,
        session: AgentSessionRef,
    ) -> Result<Arc<Mutex<CachedSession>>, AppError> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| AppError::io("会话统计缓存不可用"))?;
        if let Some(slot) = slots.get_mut(&key) {
            slot.used_at = Instant::now();
            return Ok(slot.cache.clone());
        }
        if slots.len() >= MAX_CACHED_SESSIONS {
            let oldest = slots
                .iter()
                .min_by_key(|(_, slot)| slot.used_at)
                .map(|(key, _)| key.clone());
            if let Some(oldest) = oldest {
                slots.remove(&oldest);
            }
        }
        let cache = Arc::new(Mutex::new(CachedSession {
            cache: SessionCache::new(session),
            discovered_at: None,
            hint: None,
            paths: paths::Resolved::default(),
        }));
        slots.insert(
            key,
            Slot {
                used_at: Instant::now(),
                cache: cache.clone(),
            },
        );
        Ok(cache)
    }
}

impl CachedSession {
    fn refresh(
        &mut self,
        root: &Path,
        query: &SessionStatisticsQuery,
    ) -> Result<SessionStatistics, AppError> {
        if self.hint != query.transcript_path
            || self
                .discovered_at
                .is_none_or(|at| at.elapsed() >= DISCOVERY_INTERVAL)
        {
            self.paths = paths::resolve(root, &query.session, query.transcript_path.as_deref())?;
            self.hint = query.transcript_path.clone();
            self.discovered_at = Some(Instant::now());
        }
        // 每次读取都重验目录边界，防止已经缓存的路径被替换为外部符号链接。
        let paths = self
            .paths
            .paths
            .iter()
            .map(|path| paths::allowed(root, path))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let mut report = self.cache.refresh(&paths)?;
        if self.paths.limited {
            report.note = Some(
                [
                    report.note.unwrap_or_default(),
                    "日志发现达到数量上限，显示已识别部分".into(),
                ]
                .into_iter()
                .filter(|note| !note.is_empty())
                .collect::<Vec<_>>()
                .join("；"),
            );
        }
        Ok(report)
    }
}
