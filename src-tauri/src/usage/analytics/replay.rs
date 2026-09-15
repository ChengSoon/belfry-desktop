use super::{
    aggregate::AnalyticsAccumulator,
    cache::CachedFile,
    cancel::Check,
    contracts::AnalyticsBuckets,
    memory::{optional_string, table_bytes},
    range::UsagePeriod,
    records::Record,
};
use crate::usage::{
    aggregate::UsageAccumulator,
    codex::{FileScan, QuotaSnapshot},
    contracts::TokenTotals,
};
use std::{
    collections::{HashMap, hash_map::Entry},
    path::Path,
};

const MAX_STATE_BYTES: usize = 64 * 1024 * 1024;

pub(super) struct Replay<'a> {
    accumulator: UsageAccumulator,
    claude_seen: HashMap<(String, String), TokenTotals>,
    codex: HashMap<String, FileScan<'a>>,
    project_root: Option<&'a str>,
    claude_bytes: usize,
    codex_bytes: usize,
    state_budget: usize,
    pub quota: Option<QuotaSnapshot>,
}

impl<'a> Replay<'a> {
    pub fn new(period: UsagePeriod, project_root: Option<&'a str>) -> Self {
        Self {
            accumulator: UsageAccumulator::with_analytics(AnalyticsAccumulator::new(period)),
            claude_seen: HashMap::new(),
            codex: HashMap::new(),
            project_root,
            claude_bytes: 0,
            codex_bytes: 0,
            state_budget: MAX_STATE_BYTES,
            quota: None,
        }
    }

    #[cfg(test)]
    pub fn with_budget(mut self, budget: usize) -> Self {
        self.state_budget = budget;
        self
    }

    pub fn file(&mut self, source: (&Path, &CachedFile), check: Check<'_>) -> Result<(), String> {
        let (path, file) = source;
        let identity = Self::identity(path, file.log.session_id());
        for record in file.log.records() {
            check()?;
            self.record(&identity, record)?;
        }
        self.end_file(&identity)
    }

    pub fn identity(path: &Path, session: Option<&str>) -> String {
        session
            .map(|id| format!("session:{id}"))
            .unwrap_or_else(|| format!("file:{}", path.display()))
    }

    pub fn record(&mut self, identity: &str, record: &Record) -> Result<(), String> {
        match record {
            Record::Claude(record) => {
                self.claude_bytes += record.accumulate(
                    &mut self.accumulator,
                    &mut self.claude_seen,
                    self.project_root,
                );
            }
            Record::Codex(record) => {
                let scan = match self.codex.entry(identity.to_owned()) {
                    Entry::Occupied(entry) => entry.into_mut(),
                    Entry::Vacant(entry) => {
                        self.codex_bytes += entry.key().capacity();
                        entry.insert(FileScan::new(self.project_root))
                    }
                };
                let before = scan.heap_bytes();
                scan.consume_record(record, &mut self.accumulator, None);
                self.codex_bytes = self.codex_bytes - before + scan.heap_bytes();
            }
        }
        self.check_budget()
    }

    pub fn end_file(&mut self, identity: &str) -> Result<(), String> {
        if let Some(quota) = self
            .codex
            .get(identity)
            .and_then(|scan| scan.quota.as_ref())
        {
            if self
                .quota
                .as_ref()
                .is_none_or(|current| quota.observed_at > current.observed_at)
            {
                self.quota = Some(quota.clone());
            }
        }
        self.check_budget()
    }

    pub fn finish(mut self, check: Check<'_>) -> Result<AnalyticsBuckets, String> {
        self.check_budget()?;
        let fixed_bytes =
            self.retained_bytes() - self.codex_bytes - self.accumulator.analytics_heap_bytes();
        for session in self.codex.values_mut() {
            check()?;
            let before = session.heap_bytes();
            session.flush(&mut self.accumulator, None);
            self.codex_bytes = self.codex_bytes - before + session.heap_bytes();
            // flush 可能新建聚合桶；完成阶段也按实际保留状态检查。
            ensure_budget(
                fixed_bytes + self.codex_bytes + self.accumulator.analytics_heap_bytes(),
                self.state_budget,
            )?;
        }
        check()?;
        self.accumulator.finish_analytics()
    }

    pub fn retained_bytes(&self) -> usize {
        size_of::<Self>()
            + self.claude_bytes
            + self.codex_bytes
            + table_bytes::<((String, String), TokenTotals)>(self.claude_seen.capacity())
            + table_bytes::<(String, FileScan<'_>)>(self.codex.capacity())
            + self.accumulator.analytics_heap_bytes()
            + self
                .quota
                .as_ref()
                .map_or(0, |quota| optional_string(&quota.plan_type))
    }

    fn check_budget(&self) -> Result<(), String> {
        ensure_budget(self.retained_bytes(), self.state_budget)
    }
}

fn ensure_budget(bytes: usize, budget: usize) -> Result<(), String> {
    if bytes > budget {
        Err("用量统计保留的去重与聚合状态超过内存上限，无法完整统计".into())
    } else {
        Ok(())
    }
}
