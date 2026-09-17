mod cache;
mod cancellation;
pub mod contracts;
mod query;
mod reader;
mod results;
mod text;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::agent::AgentKind;
use crate::history::scan;
use crate::terminal::AppError;
use cancellation::{SearchCancellation, SearchRegistry};
use contracts::{HistoryQuery, HistorySearchReport, HistorySearchRequest, SearchRoots};

#[derive(Default)]
pub struct HistoryIndex {
    cache: cache::FileCache,
}

#[derive(Default)]
pub struct HistorySearchState {
    index: Arc<Mutex<HistoryIndex>>,
    registry: SearchRegistry,
}

impl HistorySearchState {
    pub fn cancel(&self, request_id: &str) {
        self.registry.cancel(request_id);
    }

    pub async fn search(
        &self,
        request: HistorySearchRequest,
    ) -> Result<HistorySearchReport, AppError> {
        let cancel = self.registry.begin(request.request_id)?;
        let index = self.index.clone();
        let roots = SearchRoots {
            codex: scan::codex_sessions_root(),
            claude: scan::claude_sessions_root(),
            pi: scan::pi_sessions_root(),
        };
        tauri::async_runtime::spawn_blocking(move || {
            let mut index = index.lock().map_err(|_| AppError::io("历史索引暂不可用"))?;
            index.search(&request.query, &roots, &cancel)
        })
        .await
        .map_err(|error| AppError::io(error.to_string()))?
    }
}

impl HistoryIndex {
    fn search(
        &mut self,
        query: &HistoryQuery,
        roots: &SearchRoots,
        cancel: &SearchCancellation,
    ) -> Result<HistorySearchReport, AppError> {
        query::validate(query)?;
        cancel.check()?;
        let paths = source_files(roots, cancel)?;
        self.cache.retain(
            &paths
                .iter()
                .map(|(_, path)| path.clone())
                .collect::<HashSet<_>>(),
        );
        let mut results = results::SearchResults::default();
        let needle = query.text.trim().to_lowercase();
        for (agent, path) in paths {
            cancel.check()?;
            if query.agent.is_some_and(|selected| selected != agent) {
                continue;
            }
            results.report.scanned_files += 1;
            let file = self.cache.read(cache::FileRequest {
                path: &path,
                agent,
                needle: &needle,
                cancel,
            });
            let Ok(file) = file else {
                cancel.check()?;
                results.report.skipped_files += 1;
                continue;
            };
            results.add(file, &needle);
        }
        cancel.check()?;
        Ok(results.finish(query))
    }
}

fn source_files(
    roots: &SearchRoots,
    cancel: &SearchCancellation,
) -> Result<Vec<(AgentKind, std::path::PathBuf)>, AppError> {
    let mut paths = Vec::new();
    for (agent, root) in [
        (AgentKind::Codex, &roots.codex),
        (AgentKind::Claude, &roots.claude),
        (AgentKind::Pi, &roots.pi),
    ] {
        cancel.check()?;
        if let Some(root) = root {
            paths.extend(collect_source_files(root, agent, cancel)?);
        }
    }
    paths.sort_by(|left, right| left.1.cmp(&right.1));
    Ok(paths)
}

fn collect_source_files(
    root: &std::path::Path,
    agent: AgentKind,
    cancel: &SearchCancellation,
) -> Result<Vec<(AgentKind, std::path::PathBuf)>, AppError> {
    let mut paths = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        cancel.check()?;
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(AppError::io(format!(
                    "无法扫描历史目录 {}：{error}",
                    directory.display()
                )))
            }
        };
        for entry in entries {
            cancel.check()?;
            let entry = entry.map_err(|error| AppError::io(error.to_string()))?;
            let kind = entry
                .file_type()
                .map_err(|error| AppError::io(error.to_string()))?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "jsonl")
            {
                paths.push((agent, entry.path()));
            }
        }
    }
    Ok(paths)
}

#[cfg(test)]
mod text_tests;

#[cfg(test)]
mod index_tests;

#[cfg(test)]
mod fixtures;

#[cfg(test)]
mod boundary_tests;
