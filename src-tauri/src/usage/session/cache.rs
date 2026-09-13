use super::{aggregate::Accumulator, contracts::SessionStatistics, reader::Cursor};
use crate::{agent::AgentSessionRef, terminal::AppError};
use std::{collections::BTreeMap, path::PathBuf};

const READ_BUDGET_BYTES: u64 = 4 * 1024 * 1024;

pub(super) struct SessionCache {
    session: AgentSessionRef,
    accumulator: Accumulator,
    cursors: BTreeMap<PathBuf, Cursor>,
}

impl SessionCache {
    pub fn new(session: AgentSessionRef) -> Self {
        Self {
            accumulator: Accumulator::new(session.clone()),
            session,
            cursors: BTreeMap::new(),
        }
    }

    pub fn refresh(&mut self, paths: &[PathBuf]) -> Result<SessionStatistics, AppError> {
        let mut paths = paths.to_vec();
        paths.sort();
        paths.dedup();
        let changed =
            !self.cursors.keys().eq(paths.iter()) || self.cursors.values().any(Cursor::changed);
        if changed {
            self.reset(paths);
        }
        let mut budget = READ_BUDGET_BYTES;
        let mut unreadable = 0;
        for cursor in self.cursors.values_mut() {
            if budget == 0 {
                break;
            }
            match cursor.advance(budget, &mut self.accumulator) {
                Ok(count) => budget -= count,
                Err(_) => unreadable += 1,
            }
        }
        Ok(self.report(unreadable, budget == 0))
    }

    fn reset(&mut self, paths: Vec<PathBuf>) {
        self.accumulator = Accumulator::new(self.session.clone());
        self.cursors = paths
            .into_iter()
            .map(|path| (path.clone(), Cursor::new(path, self.session.clone())))
            .collect();
    }

    fn report(&self, unreadable: usize, exhausted: bool) -> SessionStatistics {
        let mut report = self.accumulator.report();
        report.source_files = self.cursors.len().saturating_sub(unreadable);
        report.scanned_bytes = self.cursors.values().map(|cursor| cursor.offset).sum();
        report.skipped_lines = self.cursors.values().map(|cursor| cursor.skipped).sum();
        report.pending = exhausted || self.cursors.values().any(Cursor::pending);
        let mut notes = report.note.take().into_iter().collect::<Vec<_>>();
        if self.cursors.is_empty() {
            notes.push("尚未找到此会话的本地日志，稍后自动重试".into());
        }
        if unreadable > 0 {
            notes.push("部分会话日志无法读取，显示可读取部分".into());
        }
        if report.skipped_lines > 0 {
            notes.push(format!(
                "跳过 {} 条损坏或超大记录，合计可能不完整",
                report.skipped_lines
            ));
        }
        report.note = (!notes.is_empty()).then(|| notes.join("；"));
        report
    }
}
