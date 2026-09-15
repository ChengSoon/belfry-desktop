use super::contracts::{AnalyticsBuckets, UsageBucket};
use super::memory::{optional_string, table_bytes};
use super::range::{DAY_SECONDS, UsagePeriod};
use crate::agent::AgentKind;
use crate::usage::contracts::TokenTotals;
use crate::usage::roots;
use std::collections::{HashMap, hash_map::Entry};

const MAX_BUCKETS: usize = 100_000;
const MAX_EXACT_TOKENS: u128 = 9_007_199_254_740_991;
const MAX_MODEL_BYTES: usize = 512;
const MAX_PATH_BYTES: usize = 32_768;

#[derive(Clone)]
pub struct UsageObservation<'a> {
    pub agent: AgentKind,
    pub model: &'a str,
    pub tokens: TokenTotals,
    pub at: Option<i64>,
    pub cwd: Option<&'a str>,
}

type BucketKey = (AgentKind, String, Option<i64>, Option<String>);

#[derive(Debug)]
pub struct AnalyticsAccumulator {
    period: UsagePeriod,
    buckets: HashMap<BucketKey, UsageBucket>,
    roots: HashMap<String, String>,
    undated_records: u64,
    exact_tokens: u128,
    error: Option<String>,
    heap_bytes: usize,
}

impl AnalyticsAccumulator {
    pub fn fail_at(&mut self, note: &str, at: Option<i64>) {
        if at.map_or(self.period.start.is_none(), |time| {
            self.period.contains(time)
        }) {
            self.error = Some(note.to_string());
        }
    }

    pub fn new(period: UsagePeriod) -> Self {
        Self {
            period,
            buckets: HashMap::new(),
            roots: HashMap::new(),
            undated_records: 0,
            exact_tokens: 0,
            error: None,
            heap_bytes: 0,
        }
    }

    pub fn record(&mut self, item: UsageObservation<'_>) {
        let count = token_count(item.tokens);
        if count == 0 || self.error.is_some() || !self.accept_date(item.at) {
            return;
        }
        if self.exact_tokens + count > MAX_EXACT_TOKENS {
            self.error = Some("用量超过可精确显示的范围，请缩小统计范围".into());
            return;
        }
        if item.model.len() > MAX_MODEL_BYTES
            || item.cwd.is_some_and(|path| path.len() > MAX_PATH_BYTES)
        {
            self.error = Some("日志中的模型名或项目路径过长，无法统计".into());
            return;
        }
        let project_root = self.project_root(item.cwd);
        let day = item.at.map(|at| at.div_euclid(DAY_SECONDS) * DAY_SECONDS);
        let key = (item.agent, item.model.to_string(), day, project_root);
        let Some(bucket) = self.bucket(key) else {
            return;
        };
        bucket.tokens.add(item.tokens);
        bucket.requests += 1;
        self.exact_tokens += count;
    }

    pub(crate) fn heap_bytes(&self) -> usize {
        self.heap_bytes
            + table_bytes::<(BucketKey, UsageBucket)>(self.buckets.capacity())
            + table_bytes::<(String, String)>(self.roots.capacity())
            + optional_string(&self.error)
    }

    fn project_root(&mut self, cwd: Option<&str>) -> Option<String> {
        cwd.filter(|path| !path.is_empty())
            .map(|path| match self.roots.entry(path.to_string()) {
                Entry::Occupied(entry) => entry.get().clone(),
                Entry::Vacant(entry) => {
                    let root = roots::resolve_root(path);
                    self.heap_bytes += entry.key().capacity() + root.capacity();
                    entry.insert(root).clone()
                }
            })
    }

    fn bucket(&mut self, key: BucketKey) -> Option<&mut UsageBucket> {
        if self.buckets.len() >= MAX_BUCKETS && !self.buckets.contains_key(&key) {
            self.error = Some("用量明细过多，请缩小统计范围后重试".into());
            return None;
        }
        Some(match self.buckets.entry(key) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                let (agent, model, day, project_root) = entry.key();
                let bucket = UsageBucket {
                    agent: *agent,
                    model: model.clone(),
                    day: *day,
                    project_name: project_root.as_deref().map(roots::display_name),
                    project_root: project_root.clone(),
                    tokens: TokenTotals::default(),
                    requests: 0,
                };
                self.heap_bytes += model.capacity()
                    + optional_string(project_root)
                    + bucket.model.capacity()
                    + optional_string(&bucket.project_root)
                    + optional_string(&bucket.project_name);
                entry.insert(bucket)
            }
        })
    }

    fn accept_date(&mut self, at: Option<i64>) -> bool {
        match at {
            Some(timestamp) => self.period.contains(timestamp),
            None => {
                self.undated_records += 1;
                self.period.start.is_none()
            }
        }
    }

    pub fn finish(self) -> Result<AnalyticsBuckets, String> {
        if let Some(error) = self.error {
            return Err(error);
        }
        let mut rows: Vec<_> = self.buckets.into_values().collect();
        rows.sort_by(|left, right| {
            left.day
                .unwrap_or(i64::MAX)
                .cmp(&right.day.unwrap_or(i64::MAX))
                .then_with(|| left.agent.command_name().cmp(right.agent.command_name()))
                .then_with(|| left.model.cmp(&right.model))
                .then_with(|| left.project_root.cmp(&right.project_root))
        });
        Ok(AnalyticsBuckets {
            rows,
            undated_records: self.undated_records,
        })
    }
}

fn token_count(tokens: TokenTotals) -> u128 {
    u128::from(tokens.input)
        + u128::from(tokens.cached_input)
        + u128::from(tokens.cache_write)
        + u128::from(tokens.output)
}
