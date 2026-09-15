use super::{CodexScan, FileScan, QuotaSnapshot, sessions_dir};
use crate::usage::aggregate::UsageAccumulator;
use crate::usage::scan::{ScanTally, collect_jsonl_files, for_each_line, is_stale};
use std::{collections::HashMap, path::Path};

pub(super) struct ScanOptions<'a> {
    pub cutoff: Option<i64>,
    pub project_root: Option<&'a str>,
}

pub fn scan(
    accumulator: &mut UsageAccumulator,
    cutoff: Option<i64>,
    project_root: Option<&str>,
) -> CodexScan {
    let Some(root) = sessions_dir() else {
        return CodexScan {
            tally: ScanTally::default(),
            quota: None,
        };
    };
    scan_at(
        &root,
        accumulator,
        ScanOptions {
            cutoff,
            project_root,
        },
    )
}

pub(super) fn scan_at(
    root: &Path,
    accumulator: &mut UsageAccumulator,
    options: ScanOptions<'_>,
) -> CodexScan {
    let mut state = Scanner {
        options,
        sessions: HashMap::new(),
        quota: None,
        tally: ScanTally::default(),
    };
    for path in collect_jsonl_files(root) {
        state.file(&path, accumulator);
    }
    for session in state.sessions.values_mut() {
        session.flush(accumulator, state.options.cutoff);
    }
    CodexScan {
        tally: state.tally,
        quota: state.quota,
    }
}

struct Scanner<'a> {
    options: ScanOptions<'a>,
    sessions: HashMap<String, FileScan<'a>>,
    quota: Option<QuotaSnapshot>,
    tally: ScanTally,
}

impl Scanner<'_> {
    fn file(&mut self, path: &Path, accumulator: &mut UsageAccumulator) {
        if is_stale(path, self.options.cutoff) {
            self.tally.skipped += 1;
            return;
        }
        let identity = crate::history::codex::session_id_from_meta(path)
            .map(|id| format!("session:{id}"))
            .unwrap_or_else(|| format!("file:{}", path.display()));
        let file = self
            .sessions
            .entry(identity)
            .or_insert_with(|| FileScan::new(self.options.project_root));
        if for_each_line(
            path,
            &["\"session_meta\"", "\"turn_context\"", "token_count"],
            |line| {
                file.consume(line, accumulator, self.options.cutoff);
            },
        ) {
            self.tally.scanned += 1;
        } else {
            self.tally.skipped += 1;
        }
        if let Some(found) = &file.quota {
            if self
                .quota
                .as_ref()
                .is_none_or(|current| found.observed_at > current.observed_at)
            {
                self.quota = Some(found.clone());
            }
        }
    }
}
