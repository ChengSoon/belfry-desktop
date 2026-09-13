use super::contracts::{AnalyticsBuckets, UsageBucket};
use super::range::{DAY_SECONDS, UsagePeriod};
use crate::agent::AgentKind;
use crate::usage::contracts::TokenTotals;
use crate::usage::roots;
use std::collections::HashMap;

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
        let project_root = item.cwd.filter(|path| !path.is_empty()).map(|path| {
            self.roots
                .entry(path.to_string())
                .or_insert_with(|| roots::resolve_root(path))
                .clone()
        });
        let day = item.at.map(|at| at.div_euclid(DAY_SECONDS) * DAY_SECONDS);
        let key = (
            item.agent,
            item.model.to_string(),
            day,
            project_root.clone(),
        );
        if self.buckets.len() >= MAX_BUCKETS && !self.buckets.contains_key(&key) {
            self.error = Some("用量明细过多，请缩小统计范围后重试".into());
            return;
        }
        let bucket = self.buckets.entry(key).or_insert_with(|| UsageBucket {
            agent: item.agent,
            model: item.model.to_string(),
            day,
            project_name: project_root.as_deref().map(roots::display_name),
            project_root,
            tokens: TokenTotals::default(),
            requests: 0,
        });
        bucket.tokens.add(item.tokens);
        bucket.requests += 1;
        self.exact_tokens += count;
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
