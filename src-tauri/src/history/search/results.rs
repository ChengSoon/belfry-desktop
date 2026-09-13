use std::collections::{BTreeMap, BTreeSet};

use super::cache::FileResult;
use super::contracts::{HistoryQuery, HistorySearchHit, HistorySearchReport};
use super::query;

#[derive(Default)]
pub(super) struct SearchResults {
    pub report: HistorySearchReport,
    hits: BTreeMap<String, HistorySearchHit>,
    projects: BTreeSet<String>,
}

impl SearchResults {
    pub fn add(&mut self, file: FileResult, needle: &str) {
        self.report.indexed_files += usize::from(file.indexed);
        self.report.skipped_lines += file.skipped_lines;
        if let Some(cwd) = &file.session.cwd {
            self.projects.insert(cwd.clone());
        }
        let snippet = file
            .snippet
            .or_else(|| query::excerpt(&file.session.title, needle));
        query::merge_hit(
            &mut self.hits,
            HistorySearchHit {
                session: file.session,
                snippet,
            },
        );
    }

    pub fn finish(mut self, query: &HistoryQuery) -> HistorySearchReport {
        self.report.hits = self
            .hits
            .into_values()
            .filter(|hit| {
                (query.text.trim().is_empty() || hit.snippet.is_some())
                    && query::matches(&hit.session, query)
            })
            .collect();
        self.report
            .hits
            .sort_by_key(|hit| std::cmp::Reverse(hit.session.last_active_at));
        self.report.projects = self.projects.into_iter().collect();
        self.report
    }
}
