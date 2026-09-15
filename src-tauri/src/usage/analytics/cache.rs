use super::{
    cancel::Check,
    contracts::ScanDiagnostics,
    reader::{MAX_FILE_INDEX_BYTES, ParsedLog, ReadContext, ReadError, ReadTarget},
    snapshot::Snapshot,
    stamp::{Guards, Stamp},
};
use crate::agent::AgentKind;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::File,
    path::{Path, PathBuf},
    sync::Arc,
};

const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_CACHE_FILES: usize = 4096;
const GUARD_BUDGET: usize = 512;

type CacheKey = (AgentKind, PathBuf);

pub(super) struct CachedFile {
    stamp: Stamp,
    guards: Guards,
    pub log: ParsedLog,
}

impl CachedFile {
    fn bytes(&self, path: &Path) -> usize {
        self.log.bytes() + entry_overhead(path)
    }
}

pub(super) enum ScanFile {
    Cached(Arc<CachedFile>),
    Streaming(Snapshot),
}

#[derive(Clone, Copy)]
pub(super) struct FileRequest<'a> {
    pub path: &'a Path,
    pub agent: AgentKind,
    pub check: Check<'a>,
}

#[derive(Clone)]
pub(super) struct FileCache {
    files: HashMap<CacheKey, Arc<CachedFile>>,
    order: VecDeque<CacheKey>,
    pub bytes: usize,
    pub budget: usize,
    pub index_budget: usize,
}

impl Default for FileCache {
    fn default() -> Self {
        Self {
            files: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            budget: MAX_CACHE_BYTES,
            index_budget: MAX_FILE_INDEX_BYTES,
        }
    }
}

impl FileCache {
    pub fn retain(&mut self, paths: &HashSet<PathBuf>) {
        self.files.retain(|(_, path), _| paths.contains(path));
        self.order.retain(|(_, path)| paths.contains(path));
        self.bytes = self
            .files
            .iter()
            .map(|((_, path), entry)| entry.bytes(path))
            .sum();
    }

    pub fn read(
        &mut self,
        request: FileRequest<'_>,
        metrics: &mut ScanDiagnostics,
    ) -> Result<Option<ScanFile>, String> {
        (request.check)()?;
        let key = (request.agent, request.path.to_path_buf());
        let Ok((file, stamp)) = Stamp::open(request.path) else {
            self.remove(&key);
            return Ok(None);
        };
        let previous = self.files.get(&key).cloned();
        if let Some(entry) = previous.as_ref().filter(|entry| {
            entry.stamp == stamp
                && entry.bytes(request.path) <= self.budget
                && entry.log.bytes() <= self.index_budget
        }) {
            metrics.cache_hits += 1;
            self.touch(&key);
            return Ok(Some(ScanFile::Cached(entry.clone())));
        }
        self.remove(&key);
        self.read_snapshot((file, stamp, previous), request, metrics)
            .map(|result| {
                if let Some(ScanFile::Cached(entry)) = &result {
                    self.insert(&key, entry.clone());
                }
                result
            })
    }

    fn read_snapshot(
        &self,
        source: (File, Stamp, Option<Arc<CachedFile>>),
        request: FileRequest<'_>,
        metrics: &mut ScanDiagnostics,
    ) -> Result<Option<ScanFile>, String> {
        let (file, stamp, previous) = source;
        let Ok(mut snapshot) = Snapshot::capture((file, stamp), metrics) else {
            return Ok(None);
        };
        let budget = self
            .index_budget
            .min(self.budget.saturating_sub(entry_overhead(request.path)));
        let mut context = ReadContext {
            agent: request.agent,
            check: request.check,
            metrics,
            target: ReadTarget::Index(budget),
        };
        let result = read_file(&mut snapshot, previous.as_deref(), &mut context).and_then(
            |(log, append)| {
                snapshot.validate(request, metrics)?;
                metrics.appended_files += u32::from(append);
                Ok(log)
            },
        );
        match result {
            Ok(log) => Ok(Some(ScanFile::Cached(Arc::new(CachedFile {
                stamp: snapshot.stamp,
                guards: snapshot.guards,
                log,
            })))),
            Err(ReadError::Capacity) => Ok(Some(ScanFile::Streaming(snapshot))),
            Err(ReadError::Io) => Ok(None),
            Err(ReadError::Stopped(error)) => Err(error),
        }
    }

    fn touch(&mut self, key: &CacheKey) {
        self.order.retain(|previous| previous != key);
        self.order.push_back(key.clone());
    }

    fn remove(&mut self, key: &CacheKey) {
        if let Some(entry) = self.files.remove(key) {
            self.bytes -= entry.bytes(&key.1);
        }
        self.order.retain(|previous| previous != key);
    }

    fn insert(&mut self, key: &CacheKey, entry: Arc<CachedFile>) {
        let bytes = entry.bytes(&key.1);
        if bytes > self.budget {
            return;
        }
        while self.bytes + bytes > self.budget || self.files.len() >= MAX_CACHE_FILES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            self.remove(&oldest);
        }
        self.bytes += bytes;
        self.files.insert(key.clone(), entry);
        self.touch(key);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.files.len()
    }
}

fn read_file(
    snapshot: &mut Snapshot,
    previous: Option<&CachedFile>,
    context: &mut ReadContext<'_>,
) -> Result<(ParsedLog, bool), ReadError> {
    let append = match previous {
        Some(previous) if snapshot.stamp.can_append(&previous.stamp) => previous
            .guards
            .matches(&mut snapshot.file, context.metrics)?,
        _ => false,
    };
    let mut log = if append {
        previous
            .expect("append requires prior snapshot")
            .log
            .clone()
    } else {
        ParsedLog::default()
    };
    log.read(&mut snapshot.file, snapshot.stamp.len, context)?;
    Ok((log, append))
}

fn entry_overhead(path: &Path) -> usize {
    size_of::<CachedFile>() + GUARD_BUDGET + path.as_os_str().len() * 2
}
