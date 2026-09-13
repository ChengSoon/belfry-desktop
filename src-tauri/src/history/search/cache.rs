use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::agent::AgentKind;
use crate::history::contracts::HistorySession;
use crate::history::{claude, codex};
use crate::terminal::AppError;

use super::{query, reader, SearchCancellation};

const MAX_CACHE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, PartialEq)]
struct Fingerprint {
    length: u64,
    modified: SystemTime,
}

struct CachedFile {
    fingerprint: Fingerprint,
    session: HistorySession,
    texts: Option<Vec<String>>,
    bytes: usize,
    skipped_lines: usize,
}

pub(super) struct FileCache {
    files: HashMap<PathBuf, CachedFile>,
    bytes: usize,
    budget: usize,
}

impl Default for FileCache {
    fn default() -> Self {
        Self {
            files: HashMap::new(),
            bytes: 0,
            budget: MAX_CACHE_BYTES,
        }
    }
}

pub(super) struct FileRequest<'a> {
    pub path: &'a Path,
    pub agent: AgentKind,
    pub needle: &'a str,
    pub cancel: &'a SearchCancellation,
}

pub(super) struct FileResult {
    pub session: HistorySession,
    pub snippet: Option<String>,
    pub indexed: bool,
    pub skipped_lines: usize,
}

impl FileCache {
    pub fn retain(&mut self, paths: &HashSet<PathBuf>) {
        self.files.retain(|path, _| paths.contains(path));
        self.bytes = self.files.values().map(|entry| entry.bytes).sum();
    }

    pub fn read(&mut self, request: FileRequest<'_>) -> Result<FileResult, AppError> {
        let fingerprint = fingerprint(request.path)?;
        if let Some(cached) = self.files.get(request.path) {
            if cached.fingerprint == fingerprint
                && (request.needle.is_empty() || cached.texts.is_some())
            {
                return Ok(cached_result(cached, request.needle));
            }
        }
        let session = read_session(&request)?;
        let scan = read_text(&request)?;
        let result = FileResult {
            session: session.clone(),
            snippet: scan.snippet,
            indexed: true,
            skipped_lines: scan.skipped_lines,
        };
        self.insert(
            request.path,
            CachedFile {
                fingerprint,
                session,
                bytes: if scan.texts.is_some() {
                    scan.text_bytes
                } else {
                    0
                },
                texts: scan.texts,
                skipped_lines: scan.skipped_lines,
            },
        );
        Ok(result)
    }

    fn insert(&mut self, path: &Path, entry: CachedFile) {
        if let Some(previous) = self.files.remove(path) {
            self.bytes -= previous.bytes;
        }
        while self.bytes + entry.bytes > self.budget {
            let Some(key) = self.files.keys().next().cloned() else {
                break;
            };
            if let Some(evicted) = self.files.remove(&key) {
                self.bytes -= evicted.bytes;
            }
        }
        self.bytes += entry.bytes;
        self.files.insert(path.to_path_buf(), entry);
    }
}

fn fingerprint(path: &Path) -> Result<Fingerprint, AppError> {
    let metadata = std::fs::metadata(path).map_err(|error| AppError::io(error.to_string()))?;
    Ok(Fingerprint {
        length: metadata.len(),
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    })
}

fn read_session(request: &FileRequest<'_>) -> Result<HistorySession, AppError> {
    match request.agent {
        AgentKind::Codex => codex::scan_file_checked(request.path, &|| request.cancel.check()),
        AgentKind::Claude => claude::scan_file_checked(request.path, &|| request.cancel.check()),
    }?
    .ok_or_else(|| AppError::invalid_argument("无法识别历史会话身份"))
}

fn cached_result(cached: &CachedFile, needle: &str) -> FileResult {
    let snippet = cached
        .texts
        .as_ref()
        .and_then(|texts| texts.iter().find_map(|text| query::excerpt(text, needle)));
    FileResult {
        session: cached.session.clone(),
        snippet,
        indexed: false,
        skipped_lines: cached.skipped_lines,
    }
}

fn read_text(request: &FileRequest<'_>) -> Result<reader::TextScan, AppError> {
    if request.needle.is_empty() {
        return Ok(reader::TextScan::default());
    }
    reader::scan(reader::ScanRequest {
        path: request.path,
        agent: request.agent,
        needle: request.needle,
        cancel: request.cancel,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::search::fixtures::{codex_log, Fixture};

    #[test]
    fn evicted_text_is_rebuilt_from_the_original_file() {
        let fixture = Fixture::new();
        let first = fixture.write(
            "codex/a.jsonl",
            &codex_log("a", "/work/a", &"a".repeat(150)),
        );
        let second = fixture.write(
            "codex/b.jsonl",
            &codex_log("b", "/work/b", &"b".repeat(150)),
        );
        let cancel = SearchCancellation::default();
        let mut cache = FileCache {
            budget: 200,
            ..Default::default()
        };
        let read = |cache: &mut FileCache, path: &Path| {
            cache
                .read(FileRequest {
                    path,
                    agent: AgentKind::Codex,
                    needle: "a",
                    cancel: &cancel,
                })
                .unwrap()
        };
        assert!(read(&mut cache, &first).indexed);
        assert!(!read(&mut cache, &first).indexed);
        read(&mut cache, &second);
        assert!(cache.bytes <= 200);
        assert_eq!(1, cache.files.len());
        let restored = read(&mut cache, &first);
        assert!(restored.indexed);
        assert!(restored.snippet.is_some());
        assert!(cache.bytes <= 200);
    }
}
